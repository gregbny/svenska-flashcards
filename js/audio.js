/**
 * Lecture audio depuis IndexedDB.
 */

import { getAudioBlob } from './db.js';

let _audioEl = null;
let _lastObjectUrl = null;

function getEl() {
  if (!_audioEl) _audioEl = new Audio();
  return _audioEl;
}

export async function playCardAudio(card) {
  if (!card?.audio_file) return;

  const blob = await getAudioBlob(card.audio_file);
  if (!blob) return;

  const el = getEl();
  el.pause();

  if (_lastObjectUrl) {
    URL.revokeObjectURL(_lastObjectUrl);
    _lastObjectUrl = null;
  }

  _lastObjectUrl = URL.createObjectURL(blob);
  el.src = _lastObjectUrl;
  el.play().catch(() => {});
}
