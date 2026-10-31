import { useEffect, useState, type ReactNode } from 'react';
import { usePhotoUrl } from './lib/photos';
import { useStore } from './lib/store';
import { MOODS, type MoodId } from './lib/types';

// ---------- Hash-router ----------

export function useRoute(): string[] {
  const get = () => decodeURIComponent(location.hash.replace(/^#\/?/, '')).split('/').filter(Boolean);
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => {
      setRoute(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export function go(path: string) {
  location.hash = `#/${path}`;
}

// ---------- Ikoner (enkle streg-ikoner) ----------

const P = (d: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

export const Icon = {
  pen: P(<><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></>),
  week: P(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></>),
  memory: P(<><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>),
  people: P(<><circle cx="9" cy="9" r="3.2" /><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" /><circle cx="17" cy="8" r="2.4" /><path d="M16 13.6c2.4.1 4 1.5 4.5 4" /></>),
  patterns: P(<><path d="M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4z" /><path d="M5 17a3 3 0 013-3h11" /></>),
  calendar: P(<><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /><path d="M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01" strokeWidth="2.4" /></>),
  more: P(<path d="M4.5 7h15M4.5 12h15M4.5 17h15" />),
  gear: P(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>),
  mic: P(<><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5.5 11a6.5 6.5 0 0013 0M12 17.5V21" /></>),
  speaker: P(<><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" /><path d="M15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11" /></>),
  stop: P(<rect x="7" y="7" width="10" height="10" rx="1.5" />),
  chevronLeft: P(<path d="M14.5 5.5L8 12l6.5 6.5" />),
  chevronRight: P(<path d="M9.5 5.5L16 12l-6.5 6.5" />),
  lock: P(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 018 0v2.5" /></>),
  face: P(<><path d="M4 8V6a2 2 0 012-2h2M16 4h2a2 2 0 012 2v2M20 16v2a2 2 0 01-2 2h-2M8 20H6a2 2 0 01-2-2v-2" /><path d="M9 9.5v1M15 9.5v1M12 9.5V13h-1M9.5 16a3.5 3.5 0 005 0" /></>),
  search: P(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>),
  plus: P(<path d="M12 5v14M5 12h14" />),
  camera: P(<><path d="M4 8.5A1.5 1.5 0 015.5 7h2.2l1.5-2h5.6l1.5 2h2.2A1.5 1.5 0 0120 8.5v9a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 17.5z" /><circle cx="12" cy="12.5" r="3.5" /></>),
  image: P(<><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.6" /><path d="M20 15.5l-4.5-4.5L7 19" /></>),
  grid: P(<><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>),
  smile: P(<><circle cx="12" cy="12" r="8.5" /><path d="M8.5 14.2a4.2 4.2 0 007 0M9.2 9.8h.01M14.8 9.8h.01" /></>),
  tag: P(<><path d="M3.5 12.2V4.5a1 1 0 011-1h7.7l8.3 8.3a1 1 0 010 1.4l-7.1 7.1a1 1 0 01-1.4 0z" /><circle cx="8" cy="8" r="1.3" /></>),
  heart: P(<path d="M12 19.5s-7.5-4.4-7.5-10A4.3 4.3 0 0112 7a4.3 4.3 0 017.5 2.5c0 5.6-7.5 10-7.5 10z" />),
  chat: P(<path d="M4.5 6.5a2 2 0 012-2h11a2 2 0 012 2v8a2 2 0 01-2 2H10l-4.5 3.5v-3.5h-1a2 2 0 01-1-.3z" />),
  cloud: P(<path d="M7 18.5a4.5 4.5 0 01-.6-9A6 6 0 0118 8.6a4.2 4.2 0 01-.6 9.9z" />),
  check: P(<path d="M5 12.5l4.5 4.5L19 7.5" />),
  note: P(<><rect x="5" y="3.5" width="14" height="17" rx="2.5" /><path d="M8.5 8.5h7M8.5 12h7M8.5 15.5h4" /></>),
  sparkle: P(<path d="M12 3.5l1.8 5.2 5.2 1.8-5.2 1.8L12 17.5l-1.8-5.2L5 10.5l5.2-1.8z" />),
};

// ---------- Små komponenter ----------

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
      <span />
    </label>
  );
}

export function MoodPicker({ value, onChange }: { value?: MoodId | null; onChange: (m: MoodId | null) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label="Humør">
      {MOODS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="radio"
          aria-checked={value === m.id}
          className={`chip mood mood-${m.id} ${value === m.id ? 'on' : ''}`}
          onClick={() => onChange(value === m.id ? null : m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export function MoodTag({ mood }: { mood?: MoodId | null }) {
  if (!mood) return null;
  const label = MOODS.find((m) => m.id === mood)?.label;
  return (
    <span className={`mood-tag mood-${mood}`}>
      <span className="mood-dot" />
      {label}
    </span>
  );
}

export function Toast({ text, onDone }: { text: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 2200);
    return () => clearTimeout(t);
  }, [text, onDone]);
  return <div className="toast" role="status">{text}</div>;
}

/** Ikonet for et punkt i kalenderen: emoji, eller en farvet prik for Google-aftaler. */
export function AgendaIcon({ item }: { item: { kind: string; icon: string; color?: string } }) {
  return item.kind === 'google' ? <i className="g-dot" style={{ background: item.color || '#1a73e8' }} aria-label="Google Kalender" /> : <>{item.icon}</>;
}

export function Header({ title, back: backTo, right }: { title?: ReactNode; back?: string; right?: ReactNode }) {
  return (
    <div className="header">
      {backTo !== undefined ? (
        <button className="back" onClick={() => go(backTo)}>
          <span style={{ width: 20, height: 20, display: 'inline-flex' }}>{Icon.chevronLeft}</span> Tilbage
        </button>
      ) : (
        <h1>{title}</h1>
      )}
      {right}
    </div>
  );
}

/** Toppen af fanen Plan: Kalender, Huskeliste og Faste ting, med evt. en knap til højre. */
export function PlanTabs({ active, right }: { active: 'kalender' | 'huskeliste' | 'faste'; right?: ReactNode }) {
  const tabs = [['kalender', 'Kalender'], ['huskeliste', 'Huskeliste'], ['faste', 'Faste ting']] as const;
  return (
    <div className="stack-sm" style={{ gap: 12 }}>
      <div className="header"><h1>Plan</h1>{right}</div>
      <div className="plan-tabs" role="tablist" aria-label="Plan">
        {tabs.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={active === id} className={active === id ? 'on' : ''} onClick={() => go(id)}>{label}</button>
        ))}
      </div>
    </div>
  );
}

/** Knap der kræver to bekræftelser */
export function DoubleConfirm({ label, first, second, onConfirm, className = 'btn danger' }: {
  label: string; first: string; second: string; onConfirm: () => void | Promise<void>; className?: string;
}) {
  const [step, setStep] = useState(0);
  if (step === 0) return <button className={className} onClick={() => setStep(1)}>{label}</button>;
  return (
    <div className="card stack-sm" style={{ borderColor: 'var(--danger)' }}>
      <p className="small">{step === 1 ? first : second}</p>
      <div className="row">
        <button className="btn danger" onClick={async () => (step === 1 ? setStep(2) : (await onConfirm(), setStep(0)))}>
          {step === 1 ? 'Ja, fortsæt' : 'Ja, slet for altid'}
        </button>
        <button className="btn ghost" onClick={() => setStep(0)}>Fortryd</button>
      </div>
    </div>
  );
}

export function uid(): string {
  return crypto.randomUUID();
}

// ---------- Fotos ----------

export function PhotoImg({ id, className, onClick, alt = '' }: { id: string; className?: string; onClick?: () => void; alt?: string }) {
  const { getPhoto } = useStore();
  const url = usePhotoUrl(id, getPhoto);
  if (!url) return <div className={`${className ?? ''} photo-loading`} />;
  return <img src={url} className={className} alt={alt} onClick={onClick} loading="lazy" decoding="async" />;
}

/** Store billeder på en dag – tryk for fuld skærm. */
export function PhotoGallery({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!ids.length) return null;
  return (
    <>
      <div className="photo-gallery">
        {ids.map((id) => <PhotoImg key={id} id={id} className="photo-large" onClick={() => setOpen(id)} alt="Foto fra dagen" />)}
      </div>
      {open && (
        <div className="photo-viewer" role="dialog" aria-label="Foto" onClick={() => setOpen(null)}>
          <PhotoImg id={open} alt="Foto fra dagen" />
          <button className="photo-close" aria-label="Luk">×</button>
        </div>
      )}
    </>
  );
}
