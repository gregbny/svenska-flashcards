/**
 * Svenska Flashcards — entry point.
 *
 * Ce fichier orchestre les écrans et l'état global.
 * La logique métier est répartie dans les modules : db, sm2, session, audio, import.
 *
 * --- ÉTAT D'IMPLÉMENTATION ---
 * UI:               ✅ complète (index.html + styles.css)
 * Navigation:       ✅ implémentée ici
 * Logique métier:   🚧 stubs — à implémenter par Sonnet
 */

import { ui } from './ui.js';
import { initDB, hasAudioImported, bulkPutCards, getCardCount, getMeta, setMeta } from './db.js';
import { startSession, currentCard, currentExercise, peekNextCard, rateCard, sessionStats, homeCounters, masteryStats, masteryByCefr, totalSeen } from './session.js';
import { runImport } from './import.js';
import { playCardAudio, unlockAudio, prefetchCardAudio } from './audio.js';
import { playCorrect, playWrong, playComplete, toggleMute, isMuted } from './sound.js';

const DEFAULT_GOAL_DATE = '2026-07-20';
const DAILY_TARGET = 25;

async function getGoalDate() {
  const v = await getMeta('goalDate');
  return v || DEFAULT_GOAL_DATE;
}

const state = {
  flipped: false,
  importing: false,
  answered: false, // pour MC/Listen
};

// ───────────────────────── Bootstrap ─────────────────────────
async function boot() {
  ui.show('loading');

  await initDB();
  await registerSW();

  // Toujours re-synchroniser cards.json (upsert par id) pour propager les corrections.
  // L'état SM-2 vit en localStorage, il n'est pas écrasé.
  await loadCardsJson();

  const audioReady = await hasAudioImported();
  if (!audioReady) {
    showSetup();
  } else {
    showHome();
  }
}

async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('./sw.js');
  } catch (e) {
    console.warn('SW registration failed', e);
  }
}

async function loadCardsJson({ force = false } = {}) {
  // Fast path : si on a déjà des cartes en IDB et qu'on ne force pas,
  // on saute toute la phase fetch + bulkPut (gain : ~plusieurs secondes
  // au boot). La propagation des corrections est gérée via le refresh
  // en arrière-plan ci-dessous.
  if (!force) {
    const existing = await getCardCount();
    if (existing > 0) {
      // Refresh non-bloquant : on déclenchera un upsert si le contenu
      // distant a changé, sans retarder l'écran home.
      scheduleBackgroundRefresh();
      return;
    }
  }

  let deckCards = [];
  try {
    const res = await fetch('./cards.json');
    if (res.ok) {
      const raw = await res.json();
      // Ajoute le champ `order` (position dans le deck = fréquence décroissante)
      deckCards = raw.map((c, i) => ({ ...c, order: i }));
    }
  } catch {
    // Pas de cards.json en local — ignoré
  }

  // Pack voyage : mots/phrases curated, fusionnés en tête de file
  let travelCards = [];
  try {
    const res = await fetch('./travel.json');
    if (res.ok) {
      const raw = await res.json();
      // Index audio_file par texte suédois pour réutiliser quand dispo.
      // On indexe aussi la forme "sans article" (en/ett/att) car le deck
      // stocke souvent "en bank" alors que le pack voyage a "en bank" ou "bank".
      const audioBySv = new Map();
      const STRIP_PREFIX = /^(en|ett|att)\s+/i;
      const STRIP_TRAILING = /[?!.,]+$/;
      const norm = (s) => s.trim().toLowerCase().replace(STRIP_TRAILING, '').replace(STRIP_PREFIX, '');
      for (const c of deckCards) {
        if (!c.audio_file || !c.swedish) continue;
        audioBySv.set(c.swedish, c.audio_file);
        const stripped = norm(c.swedish);
        if (stripped !== c.swedish.toLowerCase()) {
          if (!audioBySv.has(stripped)) audioBySv.set(stripped, c.audio_file);
        }
      }
      const lookupAudio = (sv) =>
        audioBySv.get(sv) ?? audioBySv.get(sv.toLowerCase()) ?? audioBySv.get(norm(sv)) ?? null;
      travelCards = raw.map((c, i) => ({
        id: -1000 - i,           // négatifs pour ne pas clasher avec les IDs Anki
        swedish: c.swedish,
        english: c.english,
        alternatives: null,
        audio_file: lookupAudio(c.swedish),
        level: 0,
        pos: 'travel',
        gender: null,
        example: null,
        phonetic: null,
        freq_rank: -1000 + i,    // ultra-prioritaire dans le tri par fréquence
        cefr: 'A1',
        pack: 'travel',
        order: -1000 + i,
      }));
    }
  } catch {
    // Pas de travel.json — ignoré
  }

  const merged = [...deckCards, ...travelCards];
  if (merged.length) {
    await bulkPutCards(merged);
    // Note le hash courant pour le futur diff non-bloquant
    const last = deckCards[deckCards.length - 1];
    const sig = `v2:${deckCards.length}:${deckCards[0]?.id ?? ''}:${last?.id ?? ''}:${travelCards.length}`;
    await setMeta('cardsSig', sig);
  }
}

/**
 * Refresh des cartes en arrière-plan, sans bloquer l'UI.
 * Détecte un changement de contenu via une signature légère
 * (count + premier/dernier id). Si différent, re-bulkPut.
 *
 * Cas particulier : si la signature n'a jamais été stockée (premier
 * lancement après l'introduction de ce mécanisme), on la *seed*
 * sans re-bulkPut. Sinon, tous les users existants déclencheraient
 * un upsert massif au boot et l'app paraîtrait gelée le temps que
 * la transaction IDB se termine.
 */
function scheduleBackgroundRefresh() {
  const run = async () => {
    try {
      const [deckRes, travelRes] = await Promise.all([
        fetch('./cards.json').catch(() => null),
        fetch('./travel.json').catch(() => null),
      ]);
      if (!deckRes || !deckRes.ok) return;
      const deckRaw = await deckRes.json();
      const travelRaw = (travelRes && travelRes.ok) ? await travelRes.json() : [];

      const lastDeck = deckRaw[deckRaw.length - 1];
      const sig = `v2:${deckRaw.length}:${deckRaw[0]?.id ?? ''}:${lastDeck?.id ?? ''}:${travelRaw.length}`;

      const prev = await getMeta('cardsSig');
      if (!prev) {
        // Migration : on se contente d'enregistrer la signature actuelle.
        // Les corrections futures déclencheront un vrai refresh.
        await setMeta('cardsSig', sig);
        return;
      }
      if (prev === sig) return; // contenu inchangé

      // Contenu modifié → on relance le chemin complet (forcé)
      await loadCardsJson({ force: true });
    } catch (err) {
      console.warn('background card refresh failed', err);
    }
  };
  // Démarre bien après le boot pour ne JAMAIS concurrencer un
  // premier "Commencer la session" qui aurait besoin de lire IDB.
  setTimeout(run, 15000);
}

// ───────────────────────── Setup screen ─────────────────────────
function showSetup() {
  ui.show('setup');
  renderInstallHint();

  const input = document.getElementById('audio-zip-input');
  input.onchange = async (e) => {
    const file = e.target.files?.[0];
    if (!file || state.importing) return;
    state.importing = true;
    document.getElementById('import-progress').classList.remove('hidden');

    try {
      await runImport(file, (done, total, label) => {
        document.getElementById('import-label').textContent = label || 'Extraction…';
        document.getElementById('import-count').textContent = `${done} / ${total}`;
        const pct = total ? Math.round((done / total) * 100) : 0;
        document.getElementById('import-bar').style.width = `${pct}%`;
      });
      showHome();
    } catch (err) {
      alert('Erreur pendant l\'import : ' + err.message);
    } finally {
      state.importing = false;
    }
  };

  document.getElementById('skip-audio-btn').onclick = () => {
    if (confirm('Continuer sans audio ? Tu pourras toujours l\'importer plus tard.')) {
      showHome();
    }
  };
}

// ───────────────────────── Home screen ─────────────────────────
async function showHome() {
  ui.show('home');

  // TODO(Sonnet): lire les vraies valeurs depuis la session / localStorage
  const stats = sessionStats();
  const [counters, mastery] = await Promise.all([
    homeCounters({ maxNew: 10 }),
    masteryStats({ limit: 2000 }),
  ]);
  document.getElementById('mastery-count').textContent = `${mastery.seen} vues · ${mastery.mastered} maîtrisées`;
  document.getElementById('mastery-bar').style.width =
    `${Math.round((mastery.progress ?? 0) * 100)}%`;
  document.getElementById('streak-count').textContent = stats.streak ?? 0;
  const freezes = stats.freezes ?? 0;
  document.getElementById('freeze-badge').classList.toggle('hidden', freezes === 0);
  document.getElementById('freeze-count').textContent = freezes;
  document.getElementById('today-progress').textContent = `${stats.doneToday ?? 0} / ${DAILY_TARGET}`;
  document.getElementById('today-bar').style.width = `${Math.round(((stats.doneToday ?? 0) / DAILY_TARGET) * 100)}%`;
  document.getElementById('new-count').textContent = counters.newAvailable;
  document.getElementById('review-count').textContent = counters.reviewsDue;
  document.getElementById('days-left').textContent = await daysUntilDepart();
  document.getElementById('xp-total').textContent = stats.xpTotal ?? 0;

  document.getElementById('account-btn').onclick = () => showAccount();

  // Mute toggle
  const muteBtn = document.getElementById('mute-btn');
  const renderMute = () => muteBtn.textContent = isMuted() ? '🔇' : '🔊';
  renderMute();
  muteBtn.onclick = () => { toggleMute(); renderMute(); };

  document.getElementById('start-session-btn').onclick = () => {
    unlockAudio(); // doit être dans le user gesture, sync
    beginStudy();
  };
}

function renderInstallHint() {
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return; // déjà installée

  const hint = document.getElementById('install-hint');
  if (!hint) return;
  hint.classList.remove('hidden');

  const ua = navigator.userAgent;
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const target = isIOS ? 'ios' : isAndroid ? 'android' : 'desktop';
  document.getElementById(`install-hint-${target}`).classList.remove('hidden');
}

async function daysUntilDepart() {
  const g = await getGoalDate();
  const target = new Date(`${g}T00:00:00`);
  const now = new Date();
  return Math.max(0, Math.ceil((target - now) / 86400000));
}

const CEFR_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const CEFR_COLOR = { A1: 'bg-duo-green', A2: 'bg-duo-green', B1: 'bg-duo-blue', B2: 'bg-duo-blue', C1: 'bg-duo-orange', C2: 'bg-duo-orange' };

async function showAccount() {
  ui.show('account');

  const [stats, mastery, byCefr, seen, goal] = await Promise.all([
    Promise.resolve(sessionStats()),
    masteryStats({ limit: 2000 }),
    masteryByCefr(),
    totalSeen(),
    getGoalDate(),
  ]);

  document.getElementById('account-xp').textContent = stats.xpTotal ?? 0;
  document.getElementById('account-streak').textContent = stats.streak ?? 0;
  document.getElementById('account-seen').textContent = seen;
  document.getElementById('account-mastery-count').textContent = `${mastery.seen} vues · ${mastery.mastered} maîtrisées / ${mastery.total || 2000}`;
  document.getElementById('account-mastery-bar').style.width =
    `${Math.round((mastery.progress ?? 0) * 100)}%`;

  const goalInput = document.getElementById('account-goal-date');
  goalInput.value = goal;
  const refreshDays = async () => {
    document.getElementById('account-days-left').textContent = await daysUntilDepart();
  };
  refreshDays();
  goalInput.onchange = async () => {
    const v = goalInput.value;
    if (!v) return;
    await setMeta('goalDate', v);
    refreshDays();
  };

  const rows = document.getElementById('account-cefr-rows');
  rows.innerHTML = '';
  for (const lvl of CEFR_ORDER) {
    const b = byCefr[lvl];
    if (!b) continue;
    const pct = Math.round((b.progress ?? 0) * 100);
    const div = document.createElement('div');
    div.innerHTML = `
      <div class="flex justify-between text-xs mb-1">
        <span class="font-bold">${lvl}</span>
        <span class="text-duo-ink/60 tabular-nums">${b.seen} vues · ${b.mastered} OK / ${b.total} · ${pct}%</span>
      </div>
      <div class="h-2 bg-duo-border rounded-full overflow-hidden">
        <div class="h-full ${CEFR_COLOR[lvl]}" style="width:${pct}%"></div>
      </div>
    `;
    rows.appendChild(div);
  }

  document.getElementById('account-back-btn').onclick = () => showHome();
  document.getElementById('account-reset-btn').onclick = async () => {
    if (!confirm('Réinitialiser toutes les données ? Cette action est irréversible.')) return;
    const dbs = await (indexedDB.databases?.() ?? Promise.resolve([]));
    for (const d of dbs) indexedDB.deleteDatabase(d.name);
    localStorage.clear();
    location.reload();
  };
}

// ───────────────────────── Study screen ─────────────────────────
async function beginStudy() {
  // unlockAudio() a été appelé sync dans le gesture du bouton.
  // On attend la fin du unlock avant de lancer la 1re carte.
  await unlockAudio();
  await startSession({ target: DAILY_TARGET, maxNew: 10 });
  ui.show('study');

  document.getElementById('quit-session-btn').onclick = () => {
    if (confirm('Quitter la session ?')) showHome();
  };
  document.getElementById('flip-btn').onclick = flipCard;
  document.getElementById('card').onclick = flipCard;
  document.getElementById('audio-btn').onclick = (e) => {
    e.stopPropagation();
    const c = currentCard();
    if (c) playCardAudio(c);
  };
  document.getElementById('mc-audio-btn').onclick = () => {
    const c = currentCard();
    if (c) playCardAudio(c);
  };
  document.getElementById('listen-audio-btn').onclick = () => {
    const c = currentCard();
    if (c) playCardAudio(c);
  };
  document.getElementById('listen-slow-btn').onclick = () => {
    const c = currentCard();
    if (c) playCardAudio(c, { rate: 0.7 });
  };
  document.getElementById('enett-audio-btn').onclick = () => {
    const c = currentCard();
    if (c) playCardAudio(c);
  };
  document.getElementById('continue-btn').onclick = advance;

  document.querySelectorAll('[data-rating]').forEach((btn) => {
    btn.onclick = async () => {
      const r = btn.dataset.rating;
      // Son immédiat selon la note (good/easy = correct, hard = wrong)
      if (r === 'hard') playWrong(); else playCorrect();
      const res = await rateCard(r);
      showXpFloater(res?.xpGained);
      advance();
    };
  });

  renderExercise();
}

function setMode(mode) {
  const modes = {
    flash:   'card',
    mc:      'exercise-mc',
    listen:  'exercise-listen',
    reverse: 'exercise-reverse',
    enett:   'exercise-enett',
  };
  for (const [m, id] of Object.entries(modes)) {
    const el = document.getElementById(id);
    el.classList.toggle('hidden', m !== mode);
    if (m !== 'flash') el.classList.toggle('flex', m === mode);
  }

  // Bottom action bar : seul le bon bouton visible
  document.getElementById('flip-btn').classList.toggle('hidden', mode !== 'flash');
  document.getElementById('feedback-buttons').classList.add('hidden');
  document.getElementById('continue-btn').classList.add('hidden');
}

function renderExercise() {
  const ex = currentExercise();
  if (!ex) return finishSession();

  state.answered = false;
  updateSessionBar();

  // Prefetch audio de la prochaine carte (non-bloquant)
  const next = peekNextCard();
  if (next) prefetchCardAudio(next);

  setMode(ex.mode);
  // Badge pack voyage
  document.getElementById('pack-badge').classList.toggle('hidden', ex.card.pack !== 'travel');

  if (ex.mode === 'flash') renderFlash(ex.card);
  else if (ex.mode === 'mc') renderMC(ex);
  else if (ex.mode === 'listen') renderListen(ex);
  else if (ex.mode === 'reverse') renderReverse(ex);
  else if (ex.mode === 'enett') renderEnett(ex);
}

function renderFlash(c) {
  state.flipped = false;
  document.getElementById('card-front').classList.remove('hidden');
  document.getElementById('card-front').classList.add('flex');
  document.getElementById('card-back').classList.add('hidden');
  document.getElementById('card-back').classList.remove('flex');
  document.getElementById('feedback-buttons').classList.add('hidden');
  document.getElementById('flip-btn').classList.remove('hidden');

  document.getElementById('card-swedish').textContent = c.swedish;
  document.getElementById('card-swedish-small').textContent = c.swedish;
  document.getElementById('card-english').textContent = c.english;

  const metaParts = [c.pos, c.gender].filter(Boolean);
  toggleField('card-meta', metaParts.join(' · '));

  const enr = c.enrichment || {};
  renderConjugation(c, enr.conjugation);
  toggleField('card-example-sv', enr.example_sv);
  toggleField('card-example-fr', enr.example_fr);

  // Fallback to raw fields only if enrichment absent
  toggleField('card-alternatives', enr.conjugation ? null : c.alternatives);
  toggleField('card-example', enr.example_sv ? null : c.example);

  playCardAudio(c).catch(() => {});
}

function renderMC(ex) {
  document.getElementById('mc-swedish').textContent = ex.card.swedish;
  renderOptions(document.getElementById('mc-options'), ex);
  playCardAudio(ex.card).catch(() => {});
}

function renderListen(ex) {
  renderOptions(document.getElementById('listen-options'), ex);
  // Joue l'audio automatiquement à l'affichage
  playCardAudio(ex.card).catch(() => {});
}

function renderReverse(ex) {
  document.getElementById('reverse-english').textContent = ex.promptText;
  renderOptions(document.getElementById('reverse-options'), ex);
  // Pas d'audio auto en reverse : on teste le rappel sans indice
}

function renderEnett(ex) {
  document.getElementById('enett-noun').textContent = ex.promptText;
  document.getElementById('enett-english').textContent = ex.card.english;
  renderOptions(document.getElementById('enett-options'), ex);
  playCardAudio(ex.card).catch(() => {});
}

function renderOptions(container, ex) {
  container.innerHTML = '';
  ex.options.forEach((text, i) => {
    const btn = document.createElement('button');
    btn.className = 'opt-btn';
    btn.textContent = text;
    btn.onclick = () => handleAnswer(ex, i, btn, container);
    container.appendChild(btn);
  });
}

async function handleAnswer(ex, chosenIndex, btn, container) {
  if (state.answered) return;
  state.answered = true;

  const correct = chosenIndex === ex.correctIndex;
  const buttons = container.querySelectorAll('.opt-btn');

  buttons.forEach((b, i) => {
    b.disabled = true;
    if (i === ex.correctIndex) b.classList.add('opt-correct');
    else if (i === chosenIndex && !correct) b.classList.add('opt-wrong');
    else b.classList.add('opt-faded');
  });

  if (correct) playCorrect(); else playWrong();

  // Si la réponse est mauvaise, on (re)joue l'audio Suédois pour aider à mémoriser
  if (!correct) {
    setTimeout(() => playCardAudio(ex.card).catch(() => {}), 400);
  }

  document.getElementById('continue-btn').classList.remove('hidden');
  document.getElementById('continue-btn').classList.toggle('btn-green', correct);
  document.getElementById('continue-btn').classList.toggle('btn-red', !correct);

  // Stocke la rating à appliquer au prochain advance()
  state.pendingRating = correct ? 'good' : 'hard';
}

function showXpFloater(amount) {
  if (!amount) return;
  const host = document.getElementById('xp-floater-host');
  if (!host) return;
  const el = document.createElement('div');
  el.className = 'xp-floater';
  el.textContent = `+${amount} XP`;
  host.appendChild(el);
  setTimeout(() => el.remove(), 1200);
}

function renderConjugation(card, conj) {
  const el = document.getElementById('card-conjugation');
  if (!conj || !conj.present) {
    el.classList.add('hidden');
    return;
  }
  const rows = [
    ['présent ', conj.present,   'jag '],
    ['prétérit', conj.preterite, 'jag '],
    ['supin   ', conj.supine,    'har '],
  ].filter(([, v]) => v);
  el.innerHTML = rows
    .map(([label, form, pronoun]) =>
      `<div><span class="text-duo-ink/40">${label}</span> · <span class="font-bold">${pronoun}${form}</span></div>`
    )
    .join('');
  el.classList.remove('hidden');
}

function toggleField(id, value) {
  const el = document.getElementById(id);
  if (value) {
    el.textContent = value;
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
  }
}

function flipCard() {
  if (state.flipped) return;
  state.flipped = true;
  const card = document.getElementById('card');
  card.classList.add('flipping');
  setTimeout(() => card.classList.remove('flipping'), 300);

  setTimeout(() => {
    document.getElementById('card-front').classList.add('hidden');
    document.getElementById('card-front').classList.remove('flex');
    document.getElementById('card-back').classList.remove('hidden');
    document.getElementById('card-back').classList.add('flex');
    document.getElementById('feedback-buttons').classList.remove('hidden');
    document.getElementById('feedback-buttons').classList.add('grid');
    document.getElementById('flip-btn').classList.add('hidden');
  }, 150);
}

async function advance() {
  // Pour MC/Listen, on applique le rating différé au moment du "Continuer"
  if (state.pendingRating) {
    const r = state.pendingRating;
    state.pendingRating = null;
    const res = await rateCard(r);
    showXpFloater(res?.xpGained);
  }
  renderExercise();
}

function updateSessionBar() {
  const s = sessionStats();
  const done = s.sessionDone ?? 0;
  const total = s.sessionTotal ?? DAILY_TARGET;
  document.getElementById('session-progress').textContent = `${done}/${total}`;
  document.getElementById('session-bar').style.width = `${Math.round((done / total) * 100)}%`;
}

// ───────────────────────── Done screen ─────────────────────────
function finishSession() {
  ui.show('done');
  const s = sessionStats();
  document.getElementById('recap-total').textContent = s.sessionDone ?? 0;
  document.getElementById('recap-new').textContent = s.sessionNew ?? 0;
  const acc = s.sessionTotal ? Math.round(((s.sessionCorrect ?? 0) / s.sessionTotal) * 100) : 0;
  document.getElementById('recap-accuracy').textContent = `${acc}%`;
  document.getElementById('recap-streak').textContent = s.streak ?? 0;
  document.getElementById('recap-xp').textContent = `+${s.sessionXP ?? 0}`;

  playComplete();

  document.getElementById('back-home-btn').onclick = showHome;
}

boot();
