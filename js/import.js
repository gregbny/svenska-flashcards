/**
 * Import du zip audio dans IndexedDB via JSZip.
 */

import { putAudio, setMeta } from './db.js';

const JSZIP_URL = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
const AUDIO_EXTS = new Set(['mp3', 'ogg', 'm4a', 'aac', 'wav', 'opus', 'flac']);

async function ensureJSZip() {
  if (window.JSZip) return window.JSZip;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = JSZIP_URL;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
  return window.JSZip;
}

function basename(path) {
  return path.split('/').pop();
}

function ext(name) {
  return name.split('.').pop().toLowerCase();
}

export async function runImport(file, onProgress) {
  const JSZip = await ensureJSZip();
  const zip = await JSZip.loadAsync(file);

  const entries = Object.values(zip.files).filter(
    (e) => !e.dir && AUDIO_EXTS.has(ext(e.name))
  );

  const total = entries.length;
  if (total === 0) throw new Error('Aucun fichier audio trouvé dans le zip.');

  let done = 0;
  for (const entry of entries) {
    const blob = await entry.async('blob');
    await putAudio(basename(entry.name), blob);
    done += 1;
    onProgress(done, total, 'Import audio…');
  }

  await setMeta('audioImported', true);
}
