import { useEffect, useState } from 'react';
import { backupName, parseBackupFile, type BackupFile } from '../lib/backup';
import { backupNow, useBackupState } from '../lib/backupSync';
import { today } from '../lib/dates';
import { downloadBackup, KEEP, listBackups, type DriveFile } from '../lib/drive';
import { download } from '../lib/export';
import { clientIdOf, driveToken, GoogleError, lastError, signIn } from '../lib/google';
import { useStore } from '../lib/store';
import { go, Header, Icon, Switch } from '../ui';
import { Dots, Keypad } from './Lock';
import { applyTheme, getTheme } from './Settings';

/** "i dag kl. 07.42", "i går kl. 21.10" eller "24. okt. kl. 08.00" */
export function whenText(ms: number): string {
  const d = new Date(ms);
  const time = `kl. ${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((new Date(new Date().toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days === 0) return `I dag ${time}`;
  if (days === 1) return `I går ${time}`;
  return `${d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' })} ${time}`;
}

/** Mere › Sikkerhedskopi */
export function BackupScreen() {
  const store = useStore();
  const s = store.data.settings;
  const b = s.backup;
  const { busy, error } = useBackupState();
  const denied = lastError() === 'access_denied';

  const setAuto = async (auto: boolean) => {
    await store.saveSettings({ ...s, backup: { ...b, auto } });
    // Første gang: Google skal give lov til Drev. Kopien gemmes, når man er tilbage.
    if (auto && !driveToken()) signIn(clientIdOf(s.google), { hint: s.google.email || undefined, back: '#/kopi' });
  };

  const status = busy
    ? { cls: '', icon: Icon.cloud, title: 'Gemmer kopi …', text: '' }
    : error || denied
      ? { cls: 'bad', icon: Icon.cloud, title: 'Kopien blev ikke gemt', text: denied ? 'Du sagde nej hos Google.' : error }
      : b.last
        ? { cls: '', icon: Icon.check, title: 'Gemt på Drev', text: whenText(b.last) }
        : { cls: 'off', icon: Icon.cloud, title: 'Ingen kopi endnu', text: 'Tryk "Gem kopi nu".' };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Header back="mere" />
      <h1>Sikkerhedskopi</h1>
      <div className={`backup-status ${status.cls}`} role="status">
        <span className="badge">{status.icon}</span>
        <span className="grow">
          <strong style={{ display: 'block' }}>{status.title}</strong>
          {status.text && <span className="small muted">{status.text}</span>}
        </span>
      </div>
      <div className="card stack">
        <div className="setting"><strong>Automatisk hver dag</strong><Switch checked={b.auto} onChange={setAuto} label="Automatisk kopi hver dag" /></div>
        <div className="kv small"><span className="muted">Mappe</span><b>Dagbog-kopi</b></div>
        <div className="kv small"><span className="muted">Gemmer</span><b>de seneste {KEEP} dage</b></div>
      </div>
      <button className="btn primary block" disabled={busy} onClick={() => backupNow(store, { login: true })}>Gem kopi nu</button>
      <button className="btn block" onClick={async () => download(new Blob([JSON.stringify(await store.backup())], { type: 'application/json' }), backupName(today()))}>
        Gem kopi på telefonen
      </button>
      <button className="btn ghost block" onClick={() => go('kopi/hent')}>Hent kopi fra Drev</button>
      <p className="tiny muted">Kopien er låst med din kode. Skifter du kode, skal du bruge den gamle kode til ældre kopier.</p>
    </div>
  );
}

type Found = { file: BackupFile; meta?: DriveFile };

/**
 * Hent en kopi og lås op med koden. Bruges ved ny start og fra Sikkerhedskopi.
 * `back` er adressen, Google sender tilbage til efter login.
 */
export function RestoreFlow({ back, onCancel, replacing }: { back: string; onCancel: () => void; replacing?: boolean }) {
  const store = useStore();
  const clientId = clientIdOf(store.data.settings.google);
  const [token] = useState(driveToken);
  const [files, setFiles] = useState<DriveFile[] | null>(null);
  const [found, setFound] = useState<Found | null>(null);
  const [error, setError] = useState(() => (lastError() === 'access_denied' ? 'Du sagde nej hos Google.' : ''));
  const [loading, setLoading] = useState(!!token);

  const fetchFile = async (f: DriveFile) => {
    if (!token) return;
    setLoading(true);
    setError('');
    try {
      setFound({ file: parseBackupFile(await downloadBackup(token, f.id)), meta: f });
    } catch (e) {
      setError(e instanceof GoogleError || e instanceof Error ? e.message : 'Kopien kunne ikke hentes.');
    } finally {
      setLoading(false);
    }
  };

  // Logget ind hos Google: find den nyeste kopi med det samme
  useEffect(() => {
    if (!token) return;
    (async () => {
      try {
        const list = await listBackups(token);
        setFiles(list);
        if (list[0]) await fetchFile(list[0]);
        else setLoading(false);
      } catch (e) {
        setError((e as Error).message);
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pickFile = (
    <label className="btn ghost block">
      Vælg en fil på telefonen
      <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        try {
          setFound({ file: parseBackupFile(await f.text()) });
          setError('');
        } catch (err) {
          setError((err as Error).message);
        }
      }} />
    </label>
  );

  if (found) return <UnlockBackup found={found} files={files} onPick={fetchFile} onCancel={() => setFound(null)} replacing={replacing} loading={loading} />;

  return (
    <div className="stack" style={{ width: '100%', maxWidth: 380, gap: 14 }}>
      <h1>Hent kopi</h1>
      {loading ? (
        <p className="muted">Leder efter din kopi på Drev …</p>
      ) : token ? (
        <p>{error || 'Der er ingen kopi på Drev.'}</p>
      ) : (
        <>
          <p>Log ind hos Google for at finde din kopi på Drev.</p>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary block" onClick={() => signIn(clientId, { back })}>Log ind hos Google</button>
        </>
      )}
      {!loading && pickFile}
      <button className="btn block" onClick={onCancel}>{replacing ? 'Tilbage' : 'Start en ny dagbog i stedet'}</button>
    </div>
  );
}

function UnlockBackup({ found, files, onPick, onCancel, replacing, loading }: {
  found: Found; files: DriveFile[] | null; onPick: (f: DriveFile) => void; onCancel: () => void; replacing?: boolean; loading: boolean;
}) {
  const store = useStore();
  const kind = found.file.pinKind;
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const tryPin = async (p: string) => {
    setBusy(true);
    setError('');
    try {
      await store.restore(found.file, p);
      applyTheme(getTheme());
      go('skriv');
    } catch (e) {
      setError((e as Error).message === 'Forkert kode' ? 'Forkert kode' : 'Kopien kunne ikke læses ind.');
      setPin('');
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ width: '100%', maxWidth: 380, gap: 14, alignItems: 'stretch' }}>
      <h1>Hent kopi</h1>
      <div className="card stack-sm">
        <strong>{found.meta ? 'Fundet på Drev' : 'Kopi fra fil'}</strong>
        <div className="kv small"><span className="muted">Kopi fra</span><b>{whenText(Date.parse(found.file.createdAt))}</b></div>
        {files && files.length > 1 && (
          <select aria-label="Vælg en anden kopi" value={found.meta?.id} disabled={loading || busy}
            onChange={(e) => { const f = files.find((x) => x.id === e.target.value); if (f) onPick(f); }}>
            {files.map((f) => <option key={f.id} value={f.id}>{whenText(Date.parse(f.modifiedTime))}</option>)}
          </select>
        )}
      </div>
      {replacing && <p className="small">Alt på telefonen bliver erstattet af kopien.</p>}
      <h2 style={{ textAlign: 'center' }}>{busy ? 'Henter alt …' : 'Skriv din kode'}</h2>
      {kind.kind === 'digits' ? (
        <>
          <Dots n={pin.length} total={kind.length} />
          <p className="error" role="alert" style={{ textAlign: 'center' }}>{error}</p>
          <Keypad
            onDigit={(d) => {
              if (busy) return;
              const next = (pin + d).slice(0, kind.length);
              setPin(next);
              if (next.length === kind.length) tryPin(next);
            }}
            onDelete={() => setPin((p) => p.slice(0, -1))}
          />
        </>
      ) : (
        <form className="stack" onSubmit={(e) => { e.preventDefault(); tryPin(pin); }}>
          <input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Adgangssætning" autoComplete="current-password" />
          <p className="error" role="alert">{error}</p>
          <button className="btn primary block" disabled={busy || !pin}>Hent alt</button>
        </form>
      )}
      <button className="btn ghost block" disabled={busy} onClick={onCancel}>Tilbage</button>
    </div>
  );
}
