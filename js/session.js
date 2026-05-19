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

const LS_KEY = 'svenska.state.v1';
const PRIORITY_LIMIT = 2000;

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
    ...s,
  };
}

// ─── Module state ───────────────────────────────────────────────
let _queue = [];
let _index = 0;
let _requeue = new Set();
let _meta = { done: 0, total: 0, newSeen: 0, correct: 0 };
let _globalState = null;

// ─── Session bootstrap ──────────────────────────────────────────
export async function startSession({ target = 25, maxNew = 10 } = {}) {
  _globalState = ensureState(loadState());

  const allCards = await getAllCards();
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

  // Sort new cards: priority to the first PRIORITY_LIMIT by deck order
  newCards.sort((a, b) => (a.order ?? Infinity) - (b.order ?? Infinity));

  const reviewSlots = Math.max(0, target - maxNew);
  const reviews = due.slice(0, reviewSlots);
  const fresh = newCards.slice(0, maxNew);

  _queue = shuffle([...reviews, ...fresh]);
  _index = 0;
  _requeue.clear();
  _meta = { done: 0, total: _queue.length, newSeen: fresh.length, correct: 0 };
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

  _updateDailyLog(rating);
  _updateStreak();
  saveState(_globalState);
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
    // same day, no change
  } else {
    const diff = daysBetween(last, today);
    _globalState.streak = diff === 1 ? _globalState.streak + 1 : 1;
  }
  _globalState.lastSessionDate = today;
}

function daysBetween(a, b) {
  return Math.round((new Date(b) - new Date(a)) / 86_400_000);
}

// ─── Stats ──────────────────────────────────────────────────────
export function sessionStats() {
  const today = todayStr();
  const log = _globalState?.dailyLog?.[today] ?? { done: 0, correct: 0 };
  const cs = _globalState?.cardStates ?? {};
  const now = Date.now();

  const reviewsDue = Object.values(cs).filter((s) => isDue(s, now)).length;

  return {
    streak: _globalState?.streak ?? 0,
    doneToday: log.done,
    newAvailable: 0,       // computed lazily by startSession, left simple here
    reviewsDue,
    sessionDone: _meta.done,
    sessionTotal: _meta.total,
    sessionNew: _meta.newSeen,
    sessionCorrect: _meta.correct,
  };
}
