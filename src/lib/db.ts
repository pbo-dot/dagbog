// Tynd IndexedDB-indpakning. "vault" rummer ukrypterede nøgledata (salt,
// pakkede nøgler) – "records" rummer kun krypterede poster.
import type { Sealed } from './crypto';

const DB_NAME = 'dagbog';
const VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('vault')) db.createObjectStore('vault');
        if (!db.objectStoreNames.contains('records')) db.createObjectStore('records');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name: 'vault' | 'records', mode: IDBTransactionMode) {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function vaultGet<T>(key: string): Promise<T | undefined> {
  return wrap((await store('vault', 'readonly')).get(key)) as Promise<T | undefined>;
}

export async function vaultSet(key: string, value: unknown): Promise<void> {
  await wrap((await store('vault', 'readwrite')).put(value, key));
}

export async function vaultDelete(key: string): Promise<void> {
  await wrap((await store('vault', 'readwrite')).delete(key));
}

export async function recordPut(key: string, value: Sealed): Promise<void> {
  await wrap((await store('records', 'readwrite')).put(value, key));
}

export async function recordDelete(key: string): Promise<void> {
  await wrap((await store('records', 'readwrite')).delete(key));
}

export async function recordAll(): Promise<Array<[string, Sealed]>> {
  const s = await store('records', 'readonly');
  const [keys, values] = await Promise.all([wrap(s.getAllKeys()), wrap(s.getAll())]);
  return keys.map((k, i) => [String(k), values[i] as Sealed]);
}

export async function wipeEverything(): Promise<void> {
  const db = await open();
  const tx = db.transaction(['vault', 'records'], 'readwrite');
  tx.objectStore('vault').clear();
  tx.objectStore('records').clear();
  await new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function requestPersistence(): Promise<void> {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
  } catch {
    /* ikke afgørende */
  }
}

export async function recordGet(key: string): Promise<Sealed | undefined> {
  return wrap((await store('records', 'readonly')).get(key)) as Promise<Sealed | undefined>;
}

/** Alle poster undtagen dem med et givent præfiks (fx fotos, der hentes ved behov). */
export async function recordAllExcept(prefix: string): Promise<Array<[string, Sealed]>> {
  const s = await store('records', 'readonly');
  const ranges = [IDBKeyRange.upperBound(prefix, true), IDBKeyRange.lowerBound(`${prefix}\uffff`, true)];
  const out: Array<[string, Sealed]> = [];
  for (const r of ranges) {
    const [keys, values] = await Promise.all([wrap(s.getAllKeys(r)), wrap(s.getAll(r))]);
    keys.forEach((k, i) => out.push([String(k), values[i] as Sealed]));
  }
  return out;
}

export async function recordKeysWithPrefix(prefix: string): Promise<string[]> {
  const s = await store('records', 'readonly');
  const keys = await wrap(s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)));
  return keys.map(String);
}
