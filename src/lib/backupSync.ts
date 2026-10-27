// Gemmer den låste kopi på Google Drev: når man trykker, og af sig selv hver dag.
import { useEffect, useSyncExternalStore } from 'react';
import { backupName } from './backup';
import { saveToDrive } from './drive';
import { clientIdOf, driveToken, GoogleError, signIn } from './google';
import { useStore } from './store';

type Store = ReturnType<typeof useStore>;

/** Er den seneste kopi fra en tidligere dag? */
const olderThanToday = (ms: number) => new Date(ms).toDateString() !== new Date().toDateString();

interface State {
  busy: boolean;
  error: string;
}

let state: State = { busy: false, error: '' };
const listeners = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};

export function useBackupState(): State {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);
}

/** Gemmer en kopi nu. Mangler der adgang til Drev, går den til Google først (med `login`). Giver true, når kopien er gemt. */
export async function backupNow(store: Store, opts: { login?: boolean } = {}): Promise<boolean> {
  if (state.busy) return false;
  const token = driveToken();
  if (!token) {
    const g = store.data.settings.google;
    if (opts.login) signIn(clientIdOf(g), { hint: g.email || undefined, back: '#/kopi' });
    return false;
  }
  set({ busy: true, error: '' });
  try {
    const file = await store.backup();
    const s = store.data.settings;
    const folderId = await saveToDrive(token, s.backup.folderId, backupName(), JSON.stringify(file));
    await store.saveSettings({ ...s, backup: { ...s.backup, folderId, last: Date.now() } });
    set({ busy: false });
    return true;
  } catch (e) {
    set({ busy: false, error: e instanceof GoogleError ? e.message : 'Kopien kunne ikke gemmes.' });
    return false;
  }
}

/** Gemmer af sig selv første gang, dagbogen er låst op hver dag. */
export function useAutoBackup() {
  const store = useStore();
  const b = store.data.settings.backup;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      clearTimeout(timer);
      if (!document.hidden && b.auto && driveToken() && olderThanToday(b.last)) {
        // Lidt senere, så det ikke forsinker åbningen
        timer = setTimeout(() => backupNow(store), 4000);
      }
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', run);
    };
  }, [store, b.auto, b.last]); // eslint-disable-line react-hooks/exhaustive-deps
}
