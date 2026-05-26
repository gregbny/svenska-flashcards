/**
 * Logique de session quotidienne.
 *
 * État persisté en localStorage sous la clé 'svenska.state.v1' :
 *   {
 *     cardStates:      { [cardId]: SM2State },
 *     dailyLog:        { "YYYY-MM-DD": { done, new, correct } },
 *     streak:          number,
 *     lastSessionDate: "YYYY-MM-DD" | null,
 *   }
 */

import { getAllCards } from './db.js';
import { DEFAULT_STATE, sm2Apply, isDue } from './sm2.js';
import { buildExercise } from './exercises.js';

const LS_KEY = 'svenska.state.v1';
const PRIORITY_LIMIT = 2000;
const CEFR_ORDER = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };

// ─── Persistence ────────────────────────────────────────────────
function loadState() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function saveState(s) {
  localStorage.setItem(LS_KEY, JSON.stringify(s));
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function ensureState(s) {
  return {
    cardStates: {},
    dailyLog: {},
    streak: 0,
    lastSessionDate: null,
    freezes: 0,
    freezeEarnedAtStreak: 0,
    ...s,
    // garde-fou : s peut être null ou ne pas contenir xp (anciennes sauvegardes)
    xp: { total: 0, byDay: {}, ...(s?.xp || {}) },
  };
}

const FREEZE_MAX = 2;
const FREEZE_EARN_EVERY = 7; // un freeze tous les 7 jours de streak

const XP_BY_RATING = { hard: 5, good: 10, easy: 15 };
const XP_DAILY_GOAL_BONUS = 25;

// ─── Module state ───────────────────────────────────────────────
let _queue = [];
let _index = 0;
let _requeue = new Set();
let _meta = { done: 0, total: 0, newSeen: 0, correct: 0, xpGained: 0 };
let _globalState = null;
let _allCards = []; // pool complet pour les distracteurs
let _currentExercise = null;

// ─── Session bootstrap ──────────────────────────────────────────
export async function startSession({ target = 25, maxNew = 10 } = {}) {
  _globalState = ensureState(loadState());

  const allCards = await getAllCards();
  _allCards = allCards;
  const now = Date.now();
  const { cardStates } = _globalState;

  // Split into known (due) vs new
  const due = [];
  const newCards = [];
  for (const card of allCards) {
    const cs = cardStates[card.id];
    if (!cs) {
      newCards.push(card);
    } else if (isDue(cs, now)) {
      due.push(card);
    }
  }

  // Sort new cards by learner priority:
  //   1) CEFR level (A1 < A2 < B1 < B2 < C1 < C2 < unknown)
  //   2) Kelly frequency rank (lower = more frequent)
  //   3) Memrise level + deck order as final tiebreakers
  newCards.sort((a, b) => {
    const ca = CEFR_ORDER[a.cefr] ?? 99;
    const cb = CEFR_ORDER[b.cefr] ?? 99;
    if (ca !== cb) return ca - cb;
    const fa = a.freq_rank ?? Infinity;
    const fb = b.freq_rank ?? Infinity;
    if (fa !== fb) return fa - fb;
    const la = a.level ?? Infinity;
    const lb = b.level ?? Infinity;
    if (la !== lb) return la - lb;
    return (a.order ?? Infinity) - (b.order ?? Infinity);
  });

  const reviewSlots = Math.max(0, target - maxNew);
  const reviews = due.slice(0, reviewSlots);
  const fresh = newCards.slice(0, maxNew);

  _queue = shuffle([...reviews, ...fresh]);
  _index = 0;
  _requeue.clear();
  _meta = { done: 0, total: _queue.length, newSeen: fresh.length, correct: 0, xpGained: 0, goalBonus: false };
  _currentExercise = null;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Card access ────────────────────────────────────────────────
export function currentCard() {
  return _queue[_index] ?? null;
}

/**
 * Construit (et cache) l'exercice pour la carte courante.
 * Le cache est invalidé à chaque rateCard().
 */
export function currentExercise() {
  if (_currentExercise) return _currentExercise;
  const card = currentCard();
  if (!card) return null;
  const cs = _globalState.cardStates[card.id];
  _currentExercise = buildExercise(card, cs, _allCards);
  return _currentExercise;
}

export function peekNextCard() {
  return _queue[_index + 1] ?? null;
}

/**
 * Compteurs pour le home (avant d'avoir démarré une session).
 * - newAvailable : cartes jamais vues, plafonnées à maxNew (par défaut 10)
 * - reviewsDue   : cartes dues aujourd'hui
 */
/**
 * Stats de maîtrise : combien de cartes parmi les `limit` plus fréquentes
 * sont considérées comme apprises (reps ≥ 3 dans SM-2 ≈ intervalle ≥ 15j).
 */
export async function masteryStats({ limit = 2000 } = {}) {
  const gs = _globalState ?? ensureState(loadState());
  const allCards = await getAllCards();
  // Top N par fréquence (freq_rank ascendant) parmi les cartes ayant un rank défini
  const ranked = allCards
    .filter((c) => Number.isFinite(c.freq_rank))
    .sort((a, b) => a.freq_rank - b.freq_rank)
    .slice(0, limit);
  let mastered = 0;
  for (const c of ranked) {
    const s = gs.cardStates?.[c.id];
    if (s && (s.reps ?? 0) >= 3) mastered += 1;
  }
  return { mastered, total: ranked.length };
}

export async function masteryByCefr() {
  const gs = _globalState ?? ensureState(loadState());
  const buckets = {}; // { A1: {mastered, total, seen}, ... }
  const allCards = await getAllCards();
  for (const c of allCards) {
    const lvl = c.cefr;
    if (!lvl) continue;
    const b = buckets[lvl] || (buckets[lvl] = { mastered: 0, total: 0, seen: 0 });
    b.total += 1;
    const s = gs.cardStates?.[c.id];
    if (s) {
      b.seen += 1;
      if ((s.reps ?? 0) >= 3) b.mastered += 1;
    }
  }
  return buckets;
}

export async function totalSeen() {
  const gs = _globalState ?? ensureState(loadState());
  return Object.keys(gs.cardStates ?? {}).length;
}

export async function homeCounters({ maxNew = 10 } = {}) {
  const gs = _globalState ?? ensureState(loadState());
  const allCards = await getAllCards();
  const now = Date.now();
  let newRaw = 0, due = 0;
  for (const c of allCards) {
    const s = gs.cardStates?.[c.id];
    if (!s) newRaw += 1;
    else if (isDue(s, now)) due += 1;
  }
  return { newAvailable: Math.min(newRaw, maxNew), reviewsDue: due };
}

// ─── Rating ─────────────────────────────────────────────────────
export async function rateCard(rating) {
  const card = currentCard();
  if (!card) return;

  const prev = _globalState.cardStates[card.id] ?? { ...DEFAULT_STATE };
  const next = sm2Apply(prev, rating, Date.now());
  _globalState.cardStates[card.id] = next;

  _meta.done += 1;
  if (rating !== 'hard') _meta.correct += 1;

  if (rating === 'hard' && !_requeue.has(card.id)) {
    // Push back at a random position in the remaining queue
    _requeue.add(card.id);
    const insertAt = _index + 1 + Math.floor(Math.random() * Math.max(1, _queue.length - _index - 1));
    _queue.splice(insertAt, 0, card);
    _meta.total += 1;
  }

  _index += 1;
  _currentExercise = null;

  const xpGained = _awardXP(rating);
  _updateDailyLog(rating);
  _updateStreak();
  saveState(_globalState);
  return { xpGained };
}

/**
 * Crédite l'XP pour la note donnée + un bonus unique quand
 * on franchit l'objectif quotidien (25 cartes).
 * Retourne l'XP total gagné par ce call (utile pour le floater UI).
 */
function _awardXP(rating) {
  const today = todayStr();
  let gained = XP_BY_RATING[rating] ?? 0;

  // Bonus quand on franchit le seuil de l'objectif quotidien
  const doneBefore = _meta.done - 1;
  const doneAfter = _meta.done;
  if (!_meta.goalBonus && doneBefore < 25 && doneAfter >= 25) {
    gained += XP_DAILY_GOAL_BONUS;
    _meta.goalBonus = true;
  }

  _globalState.xp.total = (_globalState.xp.total ?? 0) + gained;
  _globalState.xp.byDay[today] = (_globalState.xp.byDay[today] ?? 0) + gained;
  _meta.xpGained += gained;
  return gained;
}

function _updateDailyLog(rating) {
  const today = todayStr();
  const log = _globalState.dailyLog[today] ?? { done: 0, new: 0, correct: 0 };
  log.done += 1;
  if (rating !== 'hard') log.correct += 1;
  _globalState.dailyLog[today] = log;
}

function _updateStreak() {
  const today = todayStr();
  const last = _globalState.lastSessionDate;

  if (!last) {
    _globalState.streak = 1;
  } else if (last === today) {
    // même jour, rien à faire
  } else {
    const diff = daysBetween(last, today);
    if (diff === 1) {
      _globalState.streak += 1;
    } else if (diff >= 2 && (_globalState.freezes ?? 0) > 0) {
      // Trou rattrapé par un freeze : on consomme 1 freeze par jour manqué
      // (jusqu'au stock dispo, ensuite reset).
      const gaps = diff - 1;
      const used = Math.min(gaps, _globalState.freezes);
      _globalState.freezes -= used;
      if (used === gaps) {
        _globalState.streak += 1; // un jour de pratique aujourd'hui = +1
      } else {
        _globalState.streak = 1;  // pas assez de freezes pour combler
      }
    } else {
      _globalState.streak = 1;
    }
  }

  // Earn un freeze à chaque palier de 7 jours, capé à FREEZE_MAX
  const earnedAt = _globalState.freezeEarnedAtStreak ?? 0;
  if (_globalState.streak >= earnedAt + FREEZE_EARN_EVERY) {
    _globalState.freezeEarnedAtStreak = _globalState.streak - (_globalState.streak % FREEZE_EARN_EVERY);
    if ((_globalState.freezes ?? 0) < FREEZE_MAX) {
      _globalState.freezes = (_globalState.freezes ?? 0) + 1;
    }
  }

  _globalState.lastSessionDate = today;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86_400_000);
}

// ─── Stats ──────────────────────────────────────────────────────
export function sessionStats() {
  // Lazy load depuis localStorage si aucune session active (ex: écran home après reload)
  const gs = _globalState ?? ensureState(loadState());

  const today = todayStr();
  const log = gs?.dailyLog?.[today] ?? { done: 0, correct: 0 };
  const cs = gs?.cardStates ?? {};
  const now = Date.now();

  const reviewsDue = Object.values(cs).filter((s) => isDue(s, now)).length;

  return {
    streak: gs?.streak ?? 0,
    doneToday: log.done,
    newAvailable: 0,       // computed lazily by startSession, left simple here
    reviewsDue,
    sessionDone: _meta.done,
    sessionTotal: _meta.total,
    sessionNew: _meta.newSeen,
    sessionCorrect: _meta.correct,
    sessionXP: _meta.xpGained,
    xpTotal: gs?.xp?.total ?? 0,
    xpToday: gs?.xp?.byDay?.[today] ?? 0,
    freezes: gs?.freezes ?? 0,
  };
}
