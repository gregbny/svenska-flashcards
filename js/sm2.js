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
    // "hard" : on ne remet PLUS tout à zéro (trop punitif, casse le
    // sentiment de progression). On recule d'un seul cran et on raccourcit
    // l'intervalle, sans jamais retomber sous reps=1 une fois la carte vue.
    // La carte repasse quand même dans la même session : c'est session.js
    // (rateCard → _requeue) qui s'en charge, indépendamment de `due`.
    s.lapses = (s.lapses ?? 0) + 1;
    s.reps = Math.max(1, s.reps - 1);
    s.ease = Math.max(1.3, s.ease - 0.2);
    s.interval = Math.max(1, Math.round((s.interval || 1) * 0.5));
    s.due = new Date(now + s.interval * 86_400_000).toISOString();
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
