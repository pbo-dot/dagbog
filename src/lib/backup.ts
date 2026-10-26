// Låst kopi af hele dagbogen (til Google Drev eller en fil på telefonen).
// Kopien er en ekstra krypteret pakke af de allerede krypterede poster, så
// hverken Google eller andre kan se noget, heller ikke hvilke dage der er skrevet.
// Den åbnes med den kode, der gjaldt, da kopien blev taget.
import { openJSON, sealJSON, unwrapWithPin, type PinWrap, type Sealed } from './crypto';
import { recordAll, recordPut, vaultGet, vaultKeysWithPrefix, vaultSet, wipeEverything } from './db';
import type { PinKind } from './store';

export interface BackupFile {
  app: 'dagbog-kopi';
  version: 1;
  createdAt: string;
  pin: PinWrap;
  pinKind: PinKind;
  data: Sealed;
}

interface Inner {
  records: Array<[string, Sealed]>;
  vault: Array<[string, unknown]>;
  theme: string | null;
}

/** Nøgler i "vault", der kommer med (Face ID og fejlforsøg hører til telefonen). */
const VAULT_KEYS = ['inboxPub'];
const VAULT_PREFIXES = ['inbox:'];

/** Fx "dagbog-kopi-2026-10-26-0957.json" (dato og klokkeslæt, så intet overskrives). */
export function backupName(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `dagbog-kopi-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

export async function makeBackup(dek: CryptoKey): Promise<BackupFile> {
  const pin = await vaultGet<PinWrap>('pin');
  const pinKind = await vaultGet<PinKind>('pinKind');
  if (!pin) throw new Error('Ingen dagbog fundet');
  const vault: Array<[string, unknown]> = [];
  for (const k of VAULT_KEYS) {
    const v = await vaultGet(k);
    if (v !== undefined) vault.push([k, v]);
  }
  for (const prefix of VAULT_PREFIXES) {
    for (const k of await vaultKeysWithPrefix(prefix)) vault.push([k, await vaultGet(k)]);
  }
  let theme: string | null = null;
  try {
    theme = localStorage.getItem('dagbog-theme');
  } catch {
    /* ikke afgørende */
  }
  const inner: Inner = { records: await recordAll(), vault, theme };
  return {
    app: 'dagbog-kopi',
    version: 1,
    createdAt: new Date().toISOString(),
    pin,
    pinKind: pinKind ?? { kind: 'digits', length: 6 },
    data: await sealJSON(dek, inner),
  };
}

export function parseBackupFile(text: string): BackupFile {
  let d: BackupFile;
  try {
    d = JSON.parse(text);
  } catch {
    throw new Error('Filen kan ikke læses.');
  }
  if (d?.app !== 'dagbog-kopi' || !d.pin || !d.data) throw new Error('Filen er ikke en kopi fra Dagbog.');
  return d;
}

/** Åbner kopien med koden. Kaster "Forkert kode", hvis den ikke passer. */
export async function openBackup(file: BackupFile, pin: string): Promise<{ dek: CryptoKey; inner: Inner }> {
  let dek: CryptoKey;
  try {
    dek = await unwrapWithPin(file.pin, pin);
  } catch {
    throw new Error('Forkert kode');
  }
  return { dek, inner: await openJSON<Inner>(dek, file.data) };
}

/** Erstatter alt på telefonen med kopien. */
export async function writeBackup(file: BackupFile, inner: Inner): Promise<void> {
  await wipeEverything();
  await vaultSet('pin', file.pin);
  await vaultSet('pinKind', file.pinKind);
  for (const [k, v] of inner.vault) await vaultSet(k, v);
  for (const [k, v] of inner.records) await recordPut(k, v);
  try {
    if (inner.theme) localStorage.setItem('dagbog-theme', inner.theme);
  } catch {
    /* ikke afgørende */
  }
}
