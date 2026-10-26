// Gemmer den låste kopi på Google Drev: når man trykker, og af sig selv hver dag.
import { useEffect, useSyncExternalStore } from 'react';
import { backupName } from './backup';
import { today } from './dates';
import { saveToDrive } from './drive';
import { clientIdOf, driveToken, GoogleError, signIn } from './google';
import { useStore } from './store';

type Store = ReturnType<typeof useStore>;

/** Automatisk kopi højst så ofte. */
const EVERY_MS = 20 * 60 * 60_000;

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

/** Gemmer en kopi nu. Mangler der adgang til Drev, går den til Google først (med `login`). */
export async function backupNow(store: Store, opts: { login?: boolean } = {}): Promise<void> {
  if (state.busy) return;
  const token = driveToken();
  if (!token) {
    const g = store.data.settings.google;
    if (opts.login) signIn(clientIdOf(g), { hint: g.email || undefined, back: '#/kopi' });
    return;
  }
  set({ busy: true, error: '' });
  try {
    const file = await store.backup();
    const s = store.data.settings;
    const folderId = await saveToDrive(token, s.backup.folderId, backupName(today()), JSON.stringify(file));
    await store.saveSettings({ ...s, backup: { ...s.backup, folderId, last: Date.now() } });
    set({ busy: false });
  } catch (e) {
    set({ busy: false, error: e instanceof GoogleError ? e.message : 'Kopien kunne ikke gemmes.' });
  }
}

/** Gemmer af sig selv, når dagbogen er låst op, og den seneste kopi er ældre end et døgn. */
export function useAutoBackup() {
  const store = useStore();
  const b = store.data.settings.backup;
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const run = () => {
      clearTimeout(timer);
      if (!document.hidden && b.auto && driveToken() && Date.now() - b.last > EVERY_MS) {
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
