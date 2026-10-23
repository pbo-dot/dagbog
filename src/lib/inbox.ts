// Indbakken: optagelser fra Optager-appen, der venter på at blive til en samtale.
import { createInboxKeys, importInboxPrivate, openInbox, sealForInbox, type InboxSealed } from './crypto';
import { vaultDelete, vaultGet, vaultKeysWithPrefix, vaultSet } from './db';

export interface InboxItem {
  id: string;
  startedAt: number;
  updatedAt: number;
  text: string;
  done: boolean; // false mens der stadig optages (eller hvis optageren blev lukket undervejs)
}

const PUBLIC = 'inboxPub';
const PREFIX = 'inbox:';

/** Optageren: er dagbogen sat op til at modtage optagelser? */
export async function inboxPublicKey(): Promise<JsonWebKey | undefined> {
  return vaultGet<JsonWebKey>(PUBLIC);
}

/** Optageren: gem (eller opdatér) en optagelse krypteret til dagbogen. */
export async function putInbox(publicJwk: JsonWebKey, item: InboxItem): Promise<void> {
  await vaultSet(PREFIX + item.id, await sealForInbox(publicJwk, item));
}

/**
 * Dagbogen: sørger for et nøglepar. Den private nøgle gemmes via `savePrivate`
 * (krypteret med dagbogens nøgle) og hentes med `loadPrivate`.
 */
export async function ensureInboxKeys(
  loadPrivate: () => Promise<string | undefined>,
  savePrivate: (pkcs8: string) => Promise<void>,
): Promise<CryptoKey> {
  const existing = await loadPrivate();
  if (existing && (await vaultGet(PUBLIC))) return importInboxPrivate(existing);
  const keys = await createInboxKeys();
  await savePrivate(keys.privatePkcs8);
  await vaultSet(PUBLIC, keys.publicJwk);
  return importInboxPrivate(keys.privatePkcs8);
}

/** Dagbogen: alle optagelser i indbakken, nyeste først. Ulæselige springes over. */
export async function readInbox(privateKey: CryptoKey): Promise<InboxItem[]> {
  const out: InboxItem[] = [];
  for (const k of await vaultKeysWithPrefix(PREFIX)) {
    try {
      const sealed = await vaultGet<InboxSealed>(k);
      if (sealed) out.push(await openInbox<InboxItem>(privateKey, sealed));
    } catch {
      // krypteret til en ældre nøgle (fx før en gendannelse): kan ikke læses
    }
  }
  return out.sort((a, b) => b.startedAt - a.startedAt);
}

export async function deleteInbox(id: string): Promise<void> {
  await vaultDelete(PREFIX + id);
}

/** Overdragelse fra listen over optagelser til "Ny samtale". */
let handoff: InboxItem | null = null;

export function openInboxItem(item: InboxItem) {
  handoff = item;
}

export function takeInboxItem(): InboxItem | null {
  const h = handoff;
  handoff = null;
  return h;
}
