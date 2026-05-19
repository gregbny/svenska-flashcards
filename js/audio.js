/**
 * Lecture audio depuis IndexedDB.
 *
 * iOS Safari spec :
 *   - audio.play() doit être déclenché dans un user gesture
 *   - Une fois l'élément <audio> "unlocké" (1 play() réussi en gesture),
 *     il peut être joué async sans restriction
 *   - Un await avant play() casse la chaîne de gesture → toujours unlock d'abord
 */

import { getAudioBlob } from './db.js';

let _audioEl = null;
let _lastObjectUrl = null;
let _unlocked = false;

function getEl() {
  if (!_audioEl) {
    _audioEl = new Audio();
    _audioEl.preload = 'auto';
    _audioEl.playsInline = true;
  }
  return _audioEl;
}

/**
 * À appeler SYNCHRONIQUEMENT depuis un user gesture (clic).
 * Joue un silence pour débloquer l'élément audio sur iOS.
 */
export function unlockAudio() {
  if (_unlocked) return;
  const el = getEl();
  // MP3 silencieux d'environ 0.1s, base64 inlined
  el.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA==';
  el.muted = true;
  el.play()
    .then(() => {
      el.pause();
      el.currentTime = 0;
      el.muted = false;
      _unlocked = true;
    })
    .catch(() => {
      // Reste à false → on retentera
    });
}

export async function playCardAudio(card) {
  if (!card?.audio_file) return;

  const blob = await getAudioBlob(card.audio_file);
  if (!blob) return;

  const el = getEl();
  try {
    el.pause();
  } catch {}

  if (_lastObjectUrl) {
    URL.revokeObjectURL(_lastObjectUrl);
    _lastObjectUrl = null;
  }

  _lastObjectUrl = URL.createObjectURL(blob);
  el.src = _lastObjectUrl;
  el.muted = false;
  try {
    await el.play();
  } catch (err) {
    console.warn('audio.play() failed', err);
  }
}
