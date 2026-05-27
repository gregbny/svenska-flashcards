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

/**
 * Télécharge un zip distant en streaming avec barre de progression,
 * puis l'importe comme un fichier local.
 *
 * onProgress(done, total, label):
 *  - phase download : label="Téléchargement…", done/total en octets
 *  - phase import   : label="Import audio…",   done/total en fichiers
 */
export async function fetchAndImport(url, onProgress) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get('content-length')) || 0;

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received, total, 'Téléchargement…');
  }
  const blob = new Blob(chunks, { type: 'application/zip' });
  await runImport(blob, onProgress);
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
