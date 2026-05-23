/**
 * IndexedDB wrapper — Svenska Flashcards.
 *
 * Stores :
 *   - cards  : { id, swedish, english, audio_file, order }
 *   - audio  : { name, blob }
 *   - meta   : { key, value }
 */

const DB_NAME = 'svenska';
const DB_VERSION = 1;

let _db = null;

export function initDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('cards')) {
        const cards = db.createObjectStore('cards', { keyPath: 'id' });
        cards.createIndex('by_order', 'order', { unique: false });
      }
      if (!db.objectStoreNames.contains('audio')) {
        db.createObjectStore('audio', { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { _db = e.target.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return _db.transaction(storeName, mode).objectStore(storeName);
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function getCardCount() {
  return wrap(tx('cards').count());
}

export function getAudioBlob(name) {
  return wrap(tx('audio').get(name)).then((r) => r?.blob ?? null);
}

export function putAudio(name, blob) {
  return wrap(tx('audio', 'readwrite').put({ name, blob }));
}

export async function bulkPutCards(cards, { chunkSize = 500 } = {}) {
  // Chunké pour éviter qu'une seule transaction monopolise IDB
  // pendant des secondes (8000+ puts en un coup peut geler les autres
  // lectures pendant que la transaction reste ouverte).
  for (let i = 0; i < cards.length; i += chunkSize) {
    const slice = cards.slice(i, i + chunkSize);
    const store = tx('cards', 'readwrite');
    await Promise.all(slice.map((c) => wrap(store.put(c))));
    // Laisse l'event loop respirer entre les chunks
    await new Promise((r) => setTimeout(r, 0));
  }
}

export function getAllCards() {
  return new Promise((resolve, reject) => {
    const req = tx('cards').getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function setMeta(key, value) {
  return wrap(tx('meta', 'readwrite').put({ key, value }));
}

export function getMeta(key) {
  return wrap(tx('meta').get(key)).then((r) => r?.value ?? null);
}

export async function hasAudioImported() {
  return (await getMeta('audioImported')) === true;
}
