import { useCallback, useEffect, useRef, useState } from 'react';
import { useStore, type PinKind } from '../lib/store';
import { Icon } from '../ui';

function Keypad({ onDigit, onDelete, extra }: { onDigit: (d: string) => void; onDelete: () => void; extra?: React.ReactNode }) {
  return (
    <div className="keypad">
      {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
        <button key={d} onClick={() => onDigit(d)}>{d}</button>
      ))}
      {extra ?? <span />}
      <button onClick={() => onDigit('0')}>0</button>
      <button className="plain" onClick={onDelete} aria-label="Slet">Slet</button>
    </div>
  );
}

function Dots({ n, total }: { n: number; total: number }) {
  return (
    <div className="pin-dots" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => <span key={i} className={i < n ? 'full' : ''} />)}
    </div>
  );
}

export function LockScreen() {
  const { unlockPin, unlockBio, hasBio, pinKind } = useStore();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const triedBio = useRef(false);

  const tryPin = useCallback(async (p: string) => {
    setBusy(true);
    setError('');
    try {
      await unlockPin(p);
    } catch (e) {
      setError((e as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  }, [unlockPin]);

  const tryBio = useCallback(async () => {
    setError('');
    try {
      await unlockBio();
    } catch (e) {
      const m = (e as Error).message;
      if (m === 'PRF_UNSUPPORTED') setError('Face ID understøttes ikke her. Brug koden.');
      else if ((e as Error).name !== 'NotAllowedError') setError(m);
    }
  }, [unlockBio]);

  // Forsøg Face ID automatisk ved åbning
  useEffect(() => {
    if (hasBio && !triedBio.current) {
      triedBio.current = true;
      tryBio();
    }
  }, [hasBio, tryBio]);

  const digit = (d: string) => {
    if (busy) return;
    const next = (pin + d).slice(0, pinKind.length);
    setPin(next);
    if (next.length === pinKind.length) tryPin(next);
  };

  return (
    <div className="lock">
      <div style={{ width: 40, height: 40, color: 'var(--muted)' }}>{Icon.lock}</div>
      <h1>Dagbog</h1>
      {pinKind.kind === 'digits' ? (
        <>
          <Dots n={pin.length} total={pinKind.length} />
          <p className="error" role="alert">{busy ? 'Låser op …' : error}</p>
          <Keypad
            onDigit={digit}
            onDelete={() => setPin((p) => p.slice(0, -1))}
            extra={hasBio ? <button className="plain" onClick={tryBio} aria-label="Face ID"><span style={{ width: 28, height: 28, display: 'inline-flex' }}>{Icon.face}</span></button> : undefined}
          />
        </>
      ) : (
        <form className="stack" style={{ width: '100%', maxWidth: 320 }} onSubmit={(e) => { e.preventDefault(); tryPin(pin); }}>
          <input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Adgangssætning" autoComplete="current-password" />
          <p className="error" role="alert">{busy ? 'Låser op …' : error}</p>
          <button className="btn primary block" disabled={busy || !pin}>Lås op</button>
          {hasBio && <button type="button" className="btn block" onClick={tryBio}>Brug Face ID</button>}
        </form>
      )}
    </div>
  );
}

/** Vælg ny kode – bruges både ved opstart og ved skift af kode. */
export function PinChooser({ onChosen, title }: { onChosen: (pin: string, kind: PinKind) => void | Promise<void>; title: string }) {
  const [mode, setMode] = useState<'digits' | 'text'>('digits');
  const [first, setFirst] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const LEN = 6;

  const finish = async (p: string) => {
    if (first === null) {
      setFirst(p);
      setPin('');
      setError('');
      return;
    }
    if (p !== first) {
      setError('Koderne var ikke ens. Prøv igen.');
      setFirst(null);
      setPin('');
      return;
    }
    setBusy(true);
    try {
      await onChosen(p, { kind: mode, length: mode === 'digits' ? LEN : 0 });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="stack" style={{ alignItems: 'center', width: '100%' }}>
      <h2>{busy ? 'Opretter krypteret dagbog …' : first === null ? title : 'Gentag koden'}</h2>
      {mode === 'digits' ? (
        <>
          <Dots n={pin.length} total={LEN} />
          <p className="error" role="alert">{error}</p>
          <Keypad
            onDigit={(d) => {
              if (busy) return;
              const next = (pin + d).slice(0, LEN);
              setPin(next);
              if (next.length === LEN) setTimeout(() => finish(next), 120);
            }}
            onDelete={() => setPin((p) => p.slice(0, -1))}
          />
        </>
      ) : (
        <form className="stack" style={{ width: '100%', maxWidth: 320 }} onSubmit={(e) => { e.preventDefault(); if (pin.length >= 8) finish(pin); else setError('Mindst 8 tegn.'); }}>
          <input type="password" autoFocus value={pin} onChange={(e) => setPin(e.target.value)} placeholder="Mindst 8 tegn" autoComplete="new-password" />
          <p className="error" role="alert">{error}</p>
          <button className="btn primary block" disabled={busy}>{first === null ? 'Videre' : 'Gem'}</button>
        </form>
      )}
      {first === null && !busy && (
        <button className="link small" onClick={() => { setMode(mode === 'digits' ? 'text' : 'digits'); setPin(''); setError(''); }}>
          {mode === 'digits' ? 'Brug en længere adgangssætning i stedet (mere sikker)' : 'Brug en 6-cifret kode'}
        </button>
      )}
    </div>
  );
}

export function SetupScreen() {
  const { setup } = useStore();
  const [step, setStep] = useState<'intro' | 'pin'>('intro');

  if (step === 'intro') {
    return (
      <div className="lock">
        <h1>Dagbog</h1>
        <div className="stack" style={{ maxWidth: 360, textAlign: 'left' }}>
          <p className="serif" style={{ fontSize: '1.15rem' }}>Et roligt sted at skrive om din dag.</p>
          <p className="small muted">
            Alt, du skriver, gemmes krypteret på denne enhed. Der er ingen konto og ingen server. Koden, du vælger nu, er nøglen til dagbogen. Glemmer du den, kan dagbogen ikke åbnes igen, så tag en sikkerhedskopi (eksport) en gang imellem.
          </p>
          <button className="btn primary block" onClick={() => setStep('pin')}>Kom i gang</button>
        </div>
      </div>
    );
  }

  return (
    <div className="lock">
      <PinChooser title="Vælg en kode" onChosen={(pin, kind) => setup(pin, kind)} />
      <p className="tiny muted" style={{ maxWidth: 320 }}>Face ID kan slås til bagefter under Indstillinger.</p>
    </div>
  );
}
