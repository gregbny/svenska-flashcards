/**
 * Algorithme SM-2 (SuperMemo 2).
 */

export const DEFAULT_STATE = {
  reps: 0,
  interval: 0,
  ease: 2.5,
  due: null,
  lapses: 0,
};

export function ratingToQuality(rating) {
  return { hard: 2, good: 4, easy: 5 }[rating] ?? 3;
}

export function sm2Apply(state, rating, now = Date.now()) {
  const q = ratingToQuality(rating);
  const s = { ...state };

  if (q < 3) {
    s.reps = 0;
    s.interval = 0;
    s.lapses += 1;
    // due reste null → la carte repassera dans la même session
    s.due = null;
  } else {
    s.reps += 1;
    if (s.reps === 1) {
      s.interval = 1;
    } else if (s.reps === 2) {
      s.interval = 6;
    } else {
      s.interval = Math.round(s.interval * s.ease);
    }
    s.ease = Math.max(1.3, s.ease + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    s.due = new Date(now + s.interval * 86_400_000).toISOString();
  }

  return s;
}

export function isDue(state, now = Date.now()) {
  if (!state.due) return true;
  return new Date(state.due).getTime() <= now;
}
