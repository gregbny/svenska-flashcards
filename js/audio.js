/**
 * Lecture audio depuis IndexedDB.
 *
 * iOS Safari spec :
 *   - Le premier play() doit être déclenché dans un user gesture
 *   - Une fois l'élément <audio> "unlocké" (1 play() réussi en gesture),
 *     il peut être joué async sans restriction
 *   - Changer .src puis play() rapidement déclenche parfois "AbortError"
 *     (interrupted by new load request) — on l'ignore silencieusement
 *   - On précharge le blob de la carte AVANT que l'utilisateur ait à
 *     l'entendre pour rendre le play() quasi-synchrone
 */

import { getAudioBlob } from './db.js';

let _audioEl = null;
let _unlocked = false;
let _unlockPromise = null;

// Cache d'objectURL : { [audio_file_name]: objectURL }
const _urlCache = new Map();
// LRU léger : on garde les N derniers
const URL_CACHE_MAX = 8;

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
 * Retourne une promesse qui résout quand le unlock est terminé.
 */
export function unlockAudio() {
  if (_unlocked) return Promise.resolve(true);
  if (_unlockPromise) return _unlockPromise;

  const el = getEl();
  el.src = 'data:audio/wav;base64,UklGRiYAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQIAAACAgA==';
  el.muted = true;

  _unlockPromise = el.play()
    .then(() => {
      try { el.pause(); } catch {}
      el.currentTime = 0;
      el.muted = false;
      _unlocked = true;
      return true;
    })
    .catch(() => {
      _unlockPromise = null;
      return false;
    });

  return _unlockPromise;
}

async function getOrCreateUrl(audioFile) {
  const cached = _urlCache.get(audioFile);
  if (cached) return cached;

  const blob = await getAudioBlob(audioFile);
  if (!blob) return null;

  const url = URL.createObjectURL(blob);
  _urlCache.set(audioFile, url);

  // Eviction LRU naïve
  if (_urlCache.size > URL_CACHE_MAX) {
    const firstKey = _urlCache.keys().next().value;
    const firstUrl = _urlCache.get(firstKey);
    URL.revokeObjectURL(firstUrl);
    _urlCache.delete(firstKey);
  }

  return url;
}

/**
 * Précharge l'audio d'une carte (objectURL prêt). Non-bloquant.
 * À appeler dès qu'on connaît la prochaine carte.
 */
export function prefetchCardAudio(card) {
  if (!card?.audio_file) return;
  // fire-and-forget
  getOrCreateUrl(card.audio_file).catch(() => {});
}

export async function playCardAudio(card, { rate = 1 } = {}) {
  if (!card?.audio_file) return;

  const url = await getOrCreateUrl(card.audio_file);
  if (!url) return;

  const el = getEl();

  // Ne PAS pause() : sur iOS ça interrompt le load et provoque AbortError.
  // On change juste la src et on relance.
  if (el.src !== url) {
    el.src = url;
  } else {
    // Même src : on rejoue depuis le début
    try { el.currentTime = 0; } catch {}
  }
  el.muted = false;
  try { el.playbackRate = rate; el.preservesPitch = true; } catch {}

  try {
    await el.play();
  } catch (err) {
    // AbortError = play interrompu par un autre load (changement rapide de carte)
    if (err && err.name === 'AbortError') return;
    // NotAllowedError = unlock perdu, on retente
    if (err && err.name === 'NotAllowedError') {
      _unlocked = false;
      _unlockPromise = null;
    }
    console.warn('audio.play() failed', err.name || err);
  }
}
