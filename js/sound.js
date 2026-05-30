/**
 * Sons synthétisés via Web Audio API (pas d'asset à charger).
 * Mute persistant via localStorage.
 */

const LS_MUTE = 'svenska.mute.v1';

let _ctx = null;
let _muted = localStorage.getItem(LS_MUTE) === '1';

function ctx() {
  if (!_ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    _ctx = new C();
  }
  // iOS: certains contextes démarrent "suspended"
  if (_ctx.state === 'suspended') _ctx.resume().catch(() => {});
  return _ctx;
}

export function isMuted() { return _muted; }

export function toggleMute() {
  _muted = !_muted;
  localStorage.setItem(LS_MUTE, _muted ? '1' : '0');
  return _muted;
}

function tone(freq, startOffset, duration, { type = 'sine', gain = 0.18 } = {}) {
  const ac = ctx();
  if (!ac) return;
  const t0 = ac.currentTime + startOffset;
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(ac.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
}

/**
 * Retour haptique. Indépendant du mute (mute = son, pas vibration).
 * No-op silencieux là où non supporté (ex: Safari iOS).
 */
function vibrate(pattern) {
  if (navigator.vibrate) {
    try { navigator.vibrate(pattern); } catch { /* ignore */ }
  }
}

export function playCorrect() {
  vibrate(15); // petit "tick"
  if (_muted) return;
  // Petit "ding" ascendant : E5 → A5
  tone(659.25, 0, 0.12);
  tone(880.00, 0.08, 0.18);
}

export function playWrong() {
  vibrate([35, 40, 35]); // double buzz
  if (_muted) return;
  // Buzz grave descendant
  tone(220, 0, 0.18, { type: 'sawtooth', gain: 0.1 });
  tone(180, 0.08, 0.22, { type: 'sawtooth', gain: 0.08 });
}

export function playComplete() {
  vibrate([20, 40, 20, 40, 50]); // petite fanfare
  if (_muted) return;
  // Triomphe : C5 → E5 → G5
  tone(523.25, 0, 0.15);
  tone(659.25, 0.12, 0.15);
  tone(783.99, 0.24, 0.35, { gain: 0.22 });
}
