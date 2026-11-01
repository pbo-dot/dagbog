// Indbakken: gamle optagelser fra DB-appen (ikke længere i brug), der stadig venter på at
// blive til en samtale. Der laves ingen ny nøgle; findes der ingen, er indbakken tom.
import { importInboxPrivate, openInbox, type InboxSealed } from './crypto';
import { vaultDelete, vaultGet, vaultKeysWithPrefix } from './db';

export interface InboxItem {
  id: string;
  startedAt: number;
  updatedAt: number;
  text: string;
  done: boolean; // false mens der stadig optages (eller hvis optageren blev lukket undervejs)
}

const PREFIX = 'inbox:';

/** Dagbogen: den gemte private nøgle til indbakken, eller null (så er indbakken tom). */
export async function loadInboxKey(loadPrivate: () => Promise<string | undefined>): Promise<CryptoKey | null> {
  const existing = await loadPrivate();
  return existing ? importInboxPrivate(existing) : null;
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
