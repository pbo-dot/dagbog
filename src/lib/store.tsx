import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  createDek, enrollBiometrics, openJSON, sealJSON, unwrapWithBiometrics, unwrapWithPin, wrapWithPin,
  type BioWrap, type PinWrap,
} from './crypto';
import { deleteInbox, ensureInboxKeys, readInbox, type InboxItem } from './inbox';
import { clearPhotoCache } from './photos';
import { recordAllExcept, recordDelete, recordGet, recordKeysWithPrefix, recordPut, requestPersistence, vaultDelete, vaultGet, vaultSet, wipeEverything } from './db';
import {
  DEFAULT_SETTINGS, type Conversation, type Draft, type Routine, type Entry, type Meta, type MonthChapter, type Pattern, type Person, type Photo, type Settings, type WeekSummary,
} from './types';

export interface Data {
  entries: Record<string, Entry>;
  weeks: Record<string, WeekSummary>;
  months: Record<string, MonthChapter>;
  people: Record<string, Person>;
  patterns: Record<string, Pattern>;
  conversations: Record<string, Conversation>;
  routines: Record<string, Routine>;
  settings: Settings;
  meta: Meta;
  draft: Draft | null;
}

type Collection = 'entries' | 'weeks' | 'months' | 'people' | 'patterns' | 'conversations' | 'routines';
const COLLECTIONS: Collection[] = ['entries', 'weeks', 'months', 'people', 'patterns', 'conversations', 'routines'];

const emptyData = (): Data => ({
  entries: {}, weeks: {}, months: {}, people: {}, patterns: {}, conversations: {}, routines: {},
  settings: structuredClone(DEFAULT_SETTINGS),
  meta: { skipped: [] },
  draft: null,
});

export type Status = 'loading' | 'setup' | 'locked' | 'unlocked';

export interface PinKind {
  kind: 'digits' | 'text';
  length: number;
}

interface Failures {
  count: number;
  until: number;
}

interface StoreApi {
  status: Status;
  data: Data;
  hasBio: boolean;
  pinKind: PinKind;
  setup(pin: string, kind: PinKind): Promise<void>;
  unlockPin(pin: string): Promise<void>;
  unlockBio(): Promise<void>;
  lock(): void;
  changePin(oldPin: string, newPin: string, kind: PinKind): Promise<void>;
  enableBio(): Promise<void>;
  disableBio(): Promise<void>;
  put<C extends Collection>(c: C, id: string, value: Data[C][string]): Promise<void>;
  remove(c: Collection, id: string): Promise<void>;
  saveSettings(s: Settings): Promise<void>;
  saveMeta(m: Meta): Promise<void>;
  saveDraft(d: Draft | null): Promise<void>;
  replaceAll(d: Partial<Data>, photos?: Record<string, Photo>): Promise<void>;
  putPhoto(p: Photo): Promise<void>;
  getPhoto(id: string): Promise<Photo | undefined>;
  removePhoto(id: string): Promise<void>;
  allPhotos(): Promise<Record<string, Photo>>;
  wipe(): Promise<void>;
  /** Optagelser fra Optager-appen, der venter. */
  inbox: InboxItem[];
  refreshInbox(): Promise<void>;
  removeInbox(id: string): Promise<void>;
}

const Ctx = createContext<StoreApi | null>(null);

export function useStore(): StoreApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider mangler');
  return v;
}

export function useData(): Data {
  return useStore().data;
}

function settingsWithDefaults(s: Partial<Settings>): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    ai: { ...DEFAULT_SETTINGS.ai, ...s.ai },
    reminder: { ...DEFAULT_SETTINGS.reminder, ...s.reminder },
  };
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<Data>(emptyData);
  const [hasBio, setHasBio] = useState(false);
  const [pinKind, setPinKind] = useState<PinKind>({ kind: 'digits', length: 6 });
  const keyRef = useRef<CryptoKey | null>(null);
  const inboxKeyRef = useRef<CryptoKey | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);

  /** Sætter nøgleparret til Optager-appen op (første gang) og læser indbakken. */
  const openInboxFor = useCallback(async (key: CryptoKey) => {
    try {
      const priv = await ensureInboxKeys(
        async () => {
          const sealed = await recordGet('inboxkey');
          return sealed ? (await openJSON<{ pkcs8: string }>(key, sealed)).pkcs8 : undefined;
        },
        async (pkcs8) => recordPut('inboxkey', await sealJSON(key, { pkcs8 })),
      );
      inboxKeyRef.current = priv;
      setInbox(await readInbox(priv));
    } catch (e) {
      console.error('Indbakken kunne ikke åbnes', e);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const pin = await vaultGet<PinWrap>('pin');
      setHasBio(!!(await vaultGet<BioWrap>('bio')));
      const k = await vaultGet<PinKind>('pinKind');
      if (k) setPinKind(k);
      setStatus(pin ? 'locked' : 'setup');
    })();
  }, []);

  const load = useCallback(async (key: CryptoKey) => {
    const d = emptyData();
    // Fotos indlæses ikke her, men først når de skal vises
    for (const [k, sealed] of await recordAllExcept('photo:')) {
      // Nøgler er "samling:id" eller bare "settings", "meta" og "draft" (uden kolon)
      const sep = k.indexOf(':');
      const kind = sep < 0 ? k : k.slice(0, sep);
      const id = sep < 0 ? '' : k.slice(sep + 1);
      try {
        const value = await openJSON<unknown>(key, sealed);
        if ((COLLECTIONS as string[]).includes(kind)) {
          (d[kind as Collection] as Record<string, unknown>)[id] = value;
        } else if (kind === 'settings') d.settings = settingsWithDefaults(value as Partial<Settings>);
        else if (kind === 'meta') d.meta = { ...(value as Meta), skipped: (value as Meta).skipped ?? [] };
        else if (kind === 'draft') d.draft = value as Draft;
      } catch (e) {
        console.error('Kunne ikke dekryptere', k, e);
      }
    }
    keyRef.current = key;
    setData(d);
    setStatus('unlocked');
    await openInboxFor(key);
  }, [openInboxFor]);

  const write = useCallback(async (k: string, value: unknown) => {
    const key = keyRef.current;
    if (!key) throw new Error('Låst');
    await recordPut(k, await sealJSON(key, value));
  }, []);

  const checkFailures = async () => {
    const f = (await vaultGet<Failures>('failures')) ?? { count: 0, until: 0 };
    if (f.until > Date.now()) {
      const s = Math.ceil((f.until - Date.now()) / 1000);
      throw new Error(`For mange forsøg. Prøv igen om ${s} sek.`);
    }
    return f;
  };

  const api: StoreApi = useMemo(() => ({
    status,
    data,
    hasBio,
    pinKind,

    async setup(pin, kind) {
      const dek = await createDek();
      await vaultSet('pin', await wrapWithPin(dek, pin));
      await vaultSet('pinKind', kind);
      setPinKind(kind);
      keyRef.current = dek;
      const d = emptyData();
      await write('settings', d.settings);
      await requestPersistence();
      setData(d);
      setStatus('unlocked');
      await openInboxFor(dek);
    },

    async unlockPin(pin) {
      const f = await checkFailures();
      const w = await vaultGet<PinWrap>('pin');
      if (!w) throw new Error('Ingen dagbog fundet');
      let key: CryptoKey;
      try {
        key = await unwrapWithPin(w, pin);
      } catch {
        const count = f.count + 1;
        const wait = count >= 5 ? Math.min(2 ** (count - 5) * 30_000, 60 * 60_000) : 0;
        await vaultSet('failures', { count, until: Date.now() + wait });
        throw new Error('Forkert kode');
      }
      await vaultSet('failures', { count: 0, until: 0 });
      await load(key);
    },

    async unlockBio() {
      const w = await vaultGet<BioWrap>('bio');
      if (!w) throw new Error('Face ID er ikke sat op');
      await load(await unwrapWithBiometrics(w));
    },

    lock() {
      keyRef.current = null;
      inboxKeyRef.current = null;
      setInbox([]);
      clearPhotoCache();
      setData(emptyData());
      setStatus('locked');
    },

    async changePin(oldPin, newPin, kind) {
      const w = await vaultGet<PinWrap>('pin');
      if (!w) throw new Error('Ingen dagbog fundet');
      let dek: CryptoKey;
      try {
        dek = await unwrapWithPin(w, oldPin);
      } catch {
        throw new Error('Den nuværende kode er forkert');
      }
      await vaultSet('pin', await wrapWithPin(dek, newPin));
      await vaultSet('pinKind', kind);
      setPinKind(kind);
    },

    async enableBio() {
      const key = keyRef.current;
      if (!key) throw new Error('Låst');
      await vaultSet('bio', await enrollBiometrics(key));
      setHasBio(true);
    },

    async disableBio() {
      await vaultDelete('bio');
      setHasBio(false);
    },

    async put(c, id, value) {
      await write(`${c}:${id}`, value);
      setData((d) => ({ ...d, [c]: { ...d[c], [id]: value } }));
    },

    async remove(c, id) {
      if (c === 'entries') {
        for (const pid of data.entries[id]?.photos ?? []) await recordDelete(`photo:${pid}`);
      }
      await recordDelete(`${c}:${id}`);
      setData((d) => {
        const next = { ...d[c] };
        delete next[id];
        return { ...d, [c]: next };
      });
    },

    async saveSettings(s) {
      await write('settings', s);
      setData((d) => ({ ...d, settings: s }));
    },

    async saveMeta(m) {
      await write('meta', m);
      setData((d) => ({ ...d, meta: m }));
    },

    async saveDraft(draft) {
      if (draft) await write('draft', draft);
      else await recordDelete('draft');
      setData((d) => ({ ...d, draft }));
    },

    async replaceAll(incoming, photos) {
      for (const [id, p] of Object.entries(photos ?? {})) await write(`photo:${id}`, p);
      const next = { ...data };
      for (const c of COLLECTIONS) {
        const items = incoming[c] as Record<string, unknown> | undefined;
        if (!items) continue;
        for (const [id, v] of Object.entries(items)) await write(`${c}:${id}`, v);
        (next[c] as Record<string, unknown>) = { ...next[c], ...items };
      }
      if (incoming.settings) {
        // API-nøglen bevares hvis importen ikke har en
        const s = settingsWithDefaults(incoming.settings);
        if (!s.ai.apiKey) s.ai.apiKey = data.settings.ai.apiKey;
        await write('settings', s);
        next.settings = s;
      }
      if (incoming.meta) {
        next.meta = { skipped: [...new Set([...data.meta.skipped, ...(incoming.meta.skipped ?? [])])] };
        await write('meta', next.meta);
      }
      setData(next);
    },

    async putPhoto(p) {
      await write(`photo:${p.id}`, p);
    },

    async getPhoto(id) {
      const key = keyRef.current;
      const sealed = await recordGet(`photo:${id}`);
      if (!key || !sealed) return undefined;
      return openJSON<Photo>(key, sealed);
    },

    async removePhoto(id) {
      await recordDelete(`photo:${id}`);
    },

    async allPhotos() {
      const key = keyRef.current;
      if (!key) throw new Error('Låst');
      const out: Record<string, Photo> = {};
      for (const k of await recordKeysWithPrefix('photo:')) {
        const sealed = await recordGet(k);
        if (sealed) {
          const p = await openJSON<Photo>(key, sealed);
          out[p.id] = p;
        }
      }
      return out;
    },

    inbox,

    async refreshInbox() {
      if (inboxKeyRef.current) setInbox(await readInbox(inboxKeyRef.current));
    },

    async removeInbox(id) {
      await deleteInbox(id);
      setInbox((list) => list.filter((x) => x.id !== id));
    },

    async wipe() {
      await wipeEverything();
      inboxKeyRef.current = null;
      setInbox([]);
      clearPhotoCache();
      keyRef.current = null;
      setData(emptyData());
      setHasBio(false);
      setStatus('setup');
    },
  }), [status, data, hasBio, pinKind, load, write, inbox, openInboxFor]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}
