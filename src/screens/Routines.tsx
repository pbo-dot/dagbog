import { useState } from 'react';
import { formatLong, formatShort, today } from '../lib/dates';
import { everyText, routineStatus } from '../lib/routines';
import { useStore } from '../lib/store';
import type { Routine } from '../lib/types';
import { DoubleConfirm, go, Header, Icon, uid } from '../ui';

const ICONS = ['💉', '💊', '🩹', '🧴', '💧', '⭐'];
const EVERY: { label: string; days: number; monthly: boolean }[] = [
  { label: 'Hver dag', days: 1, monthly: false },
  { label: 'Hver uge', days: 7, monthly: false },
  { label: 'Hver 14. dag', days: 14, monthly: false },
  { label: 'Hver måned', days: 0, monthly: true },
];

const time = (at: number) => new Date(at).toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });

/** Kort øverst på Skriv-siden: faste ting, der skal tages i dag (eller er glemt), og dem der lige er taget. */
export function RoutineCards() {
  const store = useStore();
  const t = today();
  const cards = Object.values(store.data.routines)
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((r) => ({ r, s: routineStatus(r, t) }))
    .filter(({ s }) => s.kind !== 'none');
  if (!cards.length) return null;
  return (
    <div className="stack-sm">
      {cards.map(({ r, s }) => <RoutineCard key={r.id} r={r} s={s} />)}
    </div>
  );
}

function RoutineCard({ r, s }: { r: Routine; s: ReturnType<typeof routineStatus> }) {
  const store = useStore();
  const [choice, setChoice] = useState<string | undefined>(undefined);
  const save = (next: Routine) => store.put('routines', r.id, next);

  if (s.kind === 'done') {
    return (
      <div className="card routine done">
        <strong>✓ {r.name} taget</strong>
        <span className="tiny muted">I dag kl. {time(s.at).replace(':', '.')}{s.option ? ` · ${s.option}` : ''}</span>
        <span className="tiny muted">Næste: {formatShort(s.next)}{s.nextOption ? ` · ${s.nextOption}` : ''}</span>
        <button className="link tiny" style={{ alignSelf: 'flex-start' }} onClick={() => save({ ...r, log: r.log.filter((l) => l.due !== s.due) })}>Fortryd</button>
      </div>
    );
  }
  if (s.kind !== 'due') return null;
  const option = choice ?? s.option;
  const others = r.options.filter((o) => o !== option);
  return (
    <div className={`card routine ${s.late ? 'late' : 'due'}`}>
      <div className="row between" style={{ alignItems: 'center' }}>
        <div className="stack-sm" style={{ gap: 2 }}>
          <strong>{r.icon} {r.name}</strong>
          <span className={`tiny ${s.late ? 'error' : 'muted'}`} style={{ minHeight: 0 }}>
            {s.late ? `Mangler siden ${formatLong(s.due).split(' ')[0].toLowerCase()}` : 'I dag'}{option ? ` · ${option}` : ''}
          </span>
        </div>
        <button className="btn primary" onClick={() => save({ ...r, log: [{ due: s.due, at: Date.now(), option }, ...r.log] })}>✓ Taget</button>
      </div>
      {others.length > 0 && (
        <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
          <span className="tiny muted">Andet?</span>
          {others.map((o) => <button key={o} className="chip small" onClick={() => setChoice(o)}>{o}</button>)}
        </div>
      )}
    </div>
  );
}

/** Liste over faste ting. */
export function RoutinesScreen() {
  const { routines } = useStore().data;
  const t = today();
  const list = Object.values(routines).sort((a, b) => a.createdAt - b.createdAt);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="husk" />
      <h1>Faste ting</h1>
      <p className="small muted">Ting der skal tages eller gøres på en fast plan, fx medicin, en indsprøjtning eller et plaster. På dagen står de øverst på Skriv-siden med en knap "✓ Taget".</p>
      <button className="btn primary" onClick={() => go('faste/ny')}>Ny fast ting</button>
      <div className="list">
        {list.length === 0 && <p className="small muted">Ingen faste ting endnu.</p>}
        {list.map((r) => {
          const s = routineStatus(r, t);
          const last = r.log[0];
          return (
            <button key={r.id} className="list-item" onClick={() => go(`faste/${r.id}`)}>
              <strong>{r.icon} {r.name}</strong>
              <span className="small muted">
                {everyText(r)}
                {s.kind === 'due' ? (s.late ? ' · mangler' : ' · i dag') : ''}
                {last ? ` · sidst ${formatShort(toDay(last.at))}${last.option ? ` (${last.option})` : ''}` : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const toDay = (at: number) => {
  const d = new Date(at);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Opret eller ret en fast ting, og se historikken. */
export function RoutineScreen({ id }: { id: string }) {
  const store = useStore();
  const existing = id === 'ny' ? undefined : store.data.routines[id];
  const [r, setR] = useState<Routine>(() => existing ?? {
    id: uid(), name: '', icon: '💊', everyDays: 1, monthly: false, start: today(), options: [], log: [], createdAt: Date.now(),
  });
  const [newOption, setNewOption] = useState('');
  if (id !== 'ny' && !existing) return <div className="stack"><Header back="faste" /><p className="muted">Ikke fundet.</p></div>;

  const isNew = !existing;
  // Eksisterende gemmes med det samme; en ny først, når man trykker Gem.
  const update = (patch: Partial<Routine>) => {
    const next = { ...r, ...patch };
    setR(next);
    if (!isNew) store.put('routines', next.id, next);
  };
  const customDays = !r.monthly && ![1, 7, 14].includes(r.everyDays);
  const addOption = () => {
    const o = newOption.trim();
    if (o && !r.options.includes(o)) update({ options: [...r.options, o] });
    setNewOption('');
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header back="faste" />
      <input type="text" className="serif" style={{ fontSize: '1.4rem', border: 'none', background: 'transparent', padding: 0 }}
        value={r.name} placeholder="Navn, fx Indsprøjtning" onChange={(e) => update({ name: e.target.value })} aria-label="Navn" />

      <div className="chips" aria-label="Ikon">
        {ICONS.map((i) => <button key={i} className={`chip ${r.icon === i ? 'on' : ''}`} onClick={() => update({ icon: i })}>{i}</button>)}
      </div>

      <section className="stack-sm">
        <h3>Hvor ofte</h3>
        <div className="chips">
          {EVERY.map((e) => (
            <button key={e.label} className={`chip ${(e.monthly ? r.monthly : !r.monthly && r.everyDays === e.days) ? 'on' : ''}`}
              onClick={() => update(e.monthly ? { monthly: true } : { monthly: false, everyDays: e.days })}>{e.label}</button>
          ))}
          <button className={`chip ${customDays ? 'on' : ''}`} onClick={() => update({ monthly: false, everyDays: customDays ? r.everyDays : 3 })}>Andet …</button>
        </div>
        {customDays && (
          <label className="row" style={{ gap: 8 }}>
            <span className="small">Hver</span>
            <input type="number" min={2} max={365} style={{ width: 80 }} value={r.everyDays}
              onChange={(e) => update({ everyDays: Math.max(2, Math.min(365, Number(e.target.value) || 2)) })} />
            <span className="small">dag</span>
          </label>
        )}
      </section>

      <label className="field">Første gang
        <input type="date" value={r.start} onChange={(e) => e.target.value && update({ start: e.target.value })} />
      </label>

      <section className="stack-sm">
        <h3>Skift mellem (valgfrit)</h3>
        <p className="tiny muted">Fx "højre ben" og "venstre ben". Næste gang foreslås det næste i rækken.</p>
        <div className="chips">
          {r.options.map((o) => (
            <span key={o} className="chip on">{o} <button className="link tiny" aria-label={`Fjern ${o}`} onClick={() => update({ options: r.options.filter((x) => x !== o) })}>×</button></span>
          ))}
        </div>
        <form className="row" onSubmit={(e) => { e.preventDefault(); addOption(); }}>
          <input type="text" className="grow" value={newOption} placeholder="Tilføj, fx højre ben" onChange={(e) => setNewOption(e.target.value)} />
          <button className="icon-btn" aria-label="Tilføj" disabled={!newOption.trim()}><span style={{ width: 20, height: 20, display: 'inline-flex' }}>{Icon.plus}</span></button>
        </form>
      </section>

      {isNew ? (
        <button className="btn primary" disabled={!r.name.trim()} onClick={async () => { await store.put('routines', r.id, { ...r, name: r.name.trim() }); go('faste'); }}>Gem</button>
      ) : (
        <>
          <section className="stack-sm">
            <h3>Historik</h3>
            {r.log.length === 0 && <p className="small muted">Ikke taget endnu.</p>}
            <div className="list">
              {r.log.map((l) => (
                <div key={`${l.due}-${l.at}`} className="list-item">
                  <div className="row between">
                    <span>{formatShort(toDay(l.at))} kl. {time(l.at).replace(':', '.')}</span>
                    <button className="btn ghost tiny" onClick={() => update({ log: r.log.filter((x) => x !== l) })}>Fjern</button>
                  </div>
                  <span className="tiny muted">{[l.option, l.due !== toDay(l.at) ? `planlagt ${formatShort(l.due)}` : ''].filter(Boolean).join(' · ')}</span>
                </div>
              ))}
            </div>
          </section>
          <DoubleConfirm label="Slet den faste ting" first={`Slet "${r.name}" og historikken?`} second="Er du helt sikker?"
            onConfirm={async () => { await store.remove('routines', r.id); go('faste'); }} />
        </>
      )}
    </div>
  );
}
