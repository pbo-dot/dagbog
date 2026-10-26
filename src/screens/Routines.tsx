import { useState } from 'react';
import { agenda, at } from '../lib/agenda';
import { addDays, formatLong, formatShort, today } from '../lib/dates';
import { dueTomorrow, everyText, markTaken, routineStatus } from '../lib/routines';
import { useStore } from '../lib/store';
import type { Routine } from '../lib/types';
import { AgendaIcon, DoubleConfirm, go, Header, Icon, uid } from '../ui';

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
  const all = Object.values(store.data.routines).sort((a, b) => a.createdAt - b.createdAt);
  const cards = all.map((r) => ({ r, s: routineStatus(r, t) })).filter(({ s }) => s.kind !== 'none');
  // Dagen før: en lille linje, så man kan forberede sig
  const tomorrow = all.map((r) => ({ r, d: dueTomorrow(r, t) })).filter(({ d }) => d);
  // Aftaler (egne og fra samtaler) i dag og i morgen
  const plans = agenda(store.data, t, addDays(t, 1)).filter((i) => i.kind !== 'routine');
  if (!cards.length && !tomorrow.length && !plans.length) return null;
  return (
    <div className="stack-sm">
      {plans.filter((i) => i.date === t).map((i, n) => (
        <p key={`t${n}`} className="small" style={{ margin: 0 }}>
          <strong>I dag:</strong> <AgendaIcon item={i} /> {i.title}{i.time ? ` ${at(i.time)}` : ''}{i.detail ? ` · ${i.detail}` : ''}
        </p>
      ))}
      {cards.map(({ r, s }) => <RoutineCard key={r.id} r={r} s={s} />)}
      {plans.filter((i) => i.date !== t).map((i, n) => (
        <p key={`m${n}`} className="small muted" style={{ margin: 0 }}>
          I morgen: <AgendaIcon item={i} /> {i.title}{i.time ? ` ${at(i.time)}` : ''}{i.detail ? ` · ${i.detail}` : ''}
        </p>
      ))}
      {tomorrow.map(({ r, d }) => (
        <p key={r.id} className="small muted" style={{ margin: 0 }}>
          I morgen: {r.icon} {r.name}{d?.option ? ` · ${d.option}` : ''}
        </p>
      ))}
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
        <span className="routine-ico">✓</span>
        <div className="grow">
          <strong>{r.name} taget</strong>
          <span className="small muted" style={{ display: 'block' }}>Kl. {time(s.at).replace(':', '.')}{s.option ? ` · ${s.option}` : ''} · næste {formatShort(s.next)}{s.nextOption ? `, ${s.nextOption}` : ''}</span>
        </div>
        <button className="btn ghost small" onClick={() => save({ ...r, log: r.log.filter((l) => l.due !== s.due) })}>Fortryd</button>
      </div>
    );
  }
  if (s.kind !== 'due') return null;
  const option = choice ?? s.option;
  const others = r.options.filter((o) => o !== option);
  return (
    <div className={`card routine ${s.late ? 'late' : 'due'}`} style={{ flexWrap: 'wrap' }}>
      <span className="routine-ico">{r.icon}</span>
      <div className="grow">
        <strong>{r.name}</strong>
        <span className={`small ${s.late ? 'error' : 'muted'}`} style={{ display: 'block', minHeight: 0 }}>
          {s.late ? `Mangler siden ${formatLong(s.due).split(' ')[0].toLowerCase()}` : 'I dag'}{option ? ` · ${option}` : ''}
        </span>
      </div>
      <button className="btn primary" onClick={() => save({ ...r, log: [{ due: s.due, at: Date.now(), option }, ...r.log] })}>Taget</button>
      {s.late && <button className="btn ghost small" onClick={() => go(`faste/${r.id}/tidligere`)}>Taget en anden dag</button>}
      {others.length > 0 && (
        <div className="row wrap" style={{ gap: 6, width: '100%', paddingLeft: 56 }}>
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
      <p className="small muted">Medicin og andet på en fast plan. På dagen står de øverst på Skriv-siden.</p>
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

/** "Taget en anden dag": vælg dag og klokkeslæt bagud i tiden. */
function TakenEarlier({ r, open, onSave }: { r: Routine; open?: boolean; onSave: (next: Routine) => void }) {
  const [show, setShow] = useState(!!open);
  const [date, setDate] = useState(() => addDays(today(), -1));
  const [clock, setClock] = useState('12:00');
  const [option, setOption] = useState<string | undefined>(r.options[0]);
  if (!show) return <button className="btn block" onClick={() => setShow(true)}>Taget en anden dag</button>;
  return (
    <div className="card stack-sm">
      <strong>Taget en anden dag</strong>
      <div className="row">
        <label className="field grow">Dag
          <input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="field">Klokken
          <input type="time" value={clock} onChange={(e) => setClock(e.target.value)} />
        </label>
      </div>
      {r.options.length > 0 && (
        <div className="chips">
          {r.options.map((o) => <button key={o} className={`chip ${option === o ? 'on' : ''}`} onClick={() => setOption(o)}>{o}</button>)}
        </div>
      )}
      {date < r.start && <p className="tiny muted">"Første gang" flyttes til {formatShort(date)}, så planen regnes derfra.</p>}
      <div className="row">
        <button className="btn primary" onClick={() => { onSave(markTaken(r, date, clock, option)); setShow(false); }}>Gem</button>
        <button className="btn ghost" onClick={() => setShow(false)}>Fortryd</button>
      </div>
    </div>
  );
}

/** Opret eller ret en fast ting, og se historikken. */
export function RoutineScreen({ id, earlier }: { id: string; earlier?: boolean }) {
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
      <label className="field">Navn
        <input type="text" value={r.name} placeholder="Fx Indsprøjtning" autoFocus={isNew}
          onChange={(e) => update({ name: e.target.value })} aria-label="Navn" />
      </label>

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
        <>
          <button className="btn primary" disabled={!r.name.trim()} onClick={async () => { await store.put('routines', r.id, { ...r, name: r.name.trim() }); go('faste'); }}>Gem</button>
          {!r.name.trim() && <p className="tiny muted" style={{ marginTop: -8 }}>Skriv et navn øverst for at kunne gemme.</p>}
        </>
      ) : (
        <>
          <section className="stack-sm">
            <h3>Historik</h3>
            <TakenEarlier r={r} open={earlier} onSave={(next) => update(next)} />
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
