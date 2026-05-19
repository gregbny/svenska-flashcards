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
import { initDB, hasAudioImported, getCardCount, bulkPutCards } from './db.js';
import { startSession, currentCard, rateCard, sessionStats } from './session.js';
import { runImport } from './import.js';
import { playCardAudio, unlockAudio } from './audio.js';

const DEPART_DATE = new Date('2026-07-20T00:00:00');
const DAILY_TARGET = 25;

const state = {
  flipped: false,
  importing: false,
};

// ───────────────────────── Bootstrap ─────────────────────────
async function boot() {
  ui.show('loading');

  await initDB();
  await registerSW();

  const cardCount = await getCardCount();
  if (cardCount === 0) {
    // cards.json pas encore chargé en base → le faire
    await loadCardsJson();
  }

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

async function loadCardsJson() {
  try {
    const res = await fetch('./cards.json');
    if (!res.ok) return; // pas encore extrait — l'app fonctionne sans
    const raw = await res.json();
    // Ajoute le champ `order` (position dans le deck = fréquence décroissante)
    const cards = raw.map((c, i) => ({ ...c, order: i }));
    await bulkPutCards(cards);
  } catch {
    // Pas de cards.json en local (GitHub Pages sans extraction) — ignoré silencieusement
  }
}

// ───────────────────────── Setup screen ─────────────────────────
function showSetup() {
  ui.show('setup');

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
  const stats = await sessionStats();
  document.getElementById('streak-count').textContent = stats.streak ?? 0;
  document.getElementById('today-progress').textContent = `${stats.doneToday ?? 0} / ${DAILY_TARGET}`;
  document.getElementById('today-bar').style.width = `${Math.round(((stats.doneToday ?? 0) / DAILY_TARGET) * 100)}%`;
  document.getElementById('new-count').textContent = stats.newAvailable ?? 0;
  document.getElementById('review-count').textContent = stats.reviewsDue ?? 0;
  document.getElementById('days-left').textContent = daysUntilDepart();

  document.getElementById('start-session-btn').onclick = () => {
    unlockAudio(); // doit être dans le user gesture, sync
    beginStudy();
  };
}

function daysUntilDepart() {
  const now = new Date();
  return Math.max(0, Math.ceil((DEPART_DATE - now) / 86400000));
}

// ───────────────────────── Study screen ─────────────────────────
async function beginStudy() {
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

  document.querySelectorAll('[data-rating]').forEach((btn) => {
    btn.onclick = async () => {
      await rateCard(btn.dataset.rating);
      advance();
    };
  });

  renderCard();
}

function renderCard() {
  const c = currentCard();
  if (!c) return finishSession();

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

  const phon = document.getElementById('card-phonetic');
  if (c.phonetic) {
    phon.textContent = c.phonetic;
    phon.classList.remove('hidden');
  } else {
    phon.classList.add('hidden');
  }

  updateSessionBar();
  playCardAudio(c).catch(() => {});
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

function advance() {
  renderCard();
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

  document.getElementById('back-home-btn').onclick = showHome;
}

boot();
