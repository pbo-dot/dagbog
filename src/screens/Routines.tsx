import { useState } from 'react';
import { agenda, at } from '../lib/agenda';
import { addDays, formatLong, formatShort, today } from '../lib/dates';
import { dueTomorrow, everyText, markTaken, routineStatus } from '../lib/routines';
import { upcomingBirthdays } from '../lib/people';
import { askSoon } from './Ask';
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

/** Dagens overblik øverst på Skriv-siden: aftaler, faste ting og fødselsdage i dag, og hvad der kommer. */
export function RoutineCards() {
  const store = useStore();
  const { data } = store;
  const t = today();
  const routines = Object.values(data.routines).sort((a, b) => a.createdAt - b.createdAt);
  const due = routines.map((r) => ({ r, s: routineStatus(r, t) })).filter(({ s }) => s.kind !== 'none');
  const plans = agenda(data, t, t).filter((i) => i.kind !== 'routine');
  const people = Object.values(data.people);
  const birthdays = upcomingBirthdays(people, t, 14);
  // I dag og den kommende uge (med gaveidéer); senere fødselsdage som en linje nederst
  const todayBdays = birthdays.filter((b) => b.next.days <= 7);
  const soonBday = birthdays.find((b) => b.next.days > 7);
  const tomorrowPlan = agenda(data, addDays(t, 1), addDays(t, 1)).find((i) => i.kind !== 'routine');
  const tomorrowRoutine = routines.map((r) => ({ r, d: dueTomorrow(r, t) })).find(({ d }) => d);
  const save = (r: Routine) => store.put('routines', r.id, r);
  const later = [
    tomorrowPlan && { key: 'p', text: `I morgen: ${tomorrowPlan.title}${tomorrowPlan.time ? ` ${at(tomorrowPlan.time)}` : ''}`, go: 'kalender' },
    tomorrowRoutine && { key: 'r', text: `I morgen: ${tomorrowRoutine.r.icon} ${tomorrowRoutine.r.name}${tomorrowRoutine.d?.option ? ` · ${tomorrowRoutine.d.option}` : ''}`, go: `faste/${tomorrowRoutine.r.id}` },
    soonBday && {
      key: 'b',
      text: `Om ${soonBday.next.days} ${soonBday.next.days === 1 ? 'dag' : 'dage'}: ${soonBday.person.name.split(' ')[0]} ${soonBday.next.age ? `fylder ${soonBday.next.age}` : 'har fødselsdag'}`,
      go: `mennesker/${soonBday.person.id}`,
    },
  ].filter(Boolean) as Array<{ key: string; text: string; go: string }>;

  if (!due.length && !plans.length && !todayBdays.length && !later.length) return null;

  // Stille dag: kun faste ting, der er klaret, og intet andet i dag
  if (!plans.length && !todayBdays.length && due.every(({ s }) => s.kind === 'done')) {
    return (
      <div className="today-compact">
        {due.map(({ r }) => <span key={r.id} className="today-pill">{r.icon} {r.name} <b className="ok">✓</b></span>)}
        {later.slice(0, 1).map((l) => <button key={l.key} className="today-pill" onClick={() => go(l.go)}>{l.text}</button>)}
        {!later.length && <span className="today-pill muted">Intet andet i dag</span>}
      </div>
    );
  }

  return (
    <section className="today" aria-label="I dag">
      <div className="today-head"><span>I dag</span></div>
      {todayBdays.map(({ person, next }) => {
        const first = person.name.split(' ')[0];
        return (
          <div key={person.id} className="today-row">
            <span className="today-ico bday">🎂</span>
            <span className="grow">
              <strong>{next.days === 0 ? '' : next.days === 1 ? 'I morgen: ' : `Om ${next.days} dage: `}{first} {next.age ? `fylder ${next.age}` : 'har fødselsdag'}</strong>
              {person.relation && <span className="small muted" style={{ display: 'block' }}>{person.relation}</span>}
            </span>
            <button className="btn small" onClick={() => askSoon(`Giv mig 5 gaveidéer til ${person.name}${person.relation ? ` (${person.relation})` : ''}${next.age ? `, der fylder ${next.age}` : ''}. Brug det, jeg har skrevet om ${first}.`)}>Gaveidéer</button>
          </div>
        );
      })}
      {plans.map((i, n) => (
        <button key={`p${n}`} className="today-row" onClick={() => go('kalender')}>
          <span className="today-ico"><AgendaIcon item={i} /></span>
          <span className="grow">
            <strong>{i.title}</strong>
            {i.detail && <span className="small muted" style={{ display: 'block' }}>{i.detail}</span>}
          </span>
          {i.time && <span className="today-time">{i.time.replace(':', '.')}</span>}
        </button>
      ))}
      {due.map(({ r, s }) => (
        <div key={r.id} className="today-row">
          <span className="today-ico">{r.icon}</span>
          <span className="grow">
            <strong>{r.name}</strong>
            {s.kind === 'due' && (s.late || s.option) && (
              <span className={`small ${s.late ? 'error' : 'muted'}`} style={{ display: 'block', minHeight: 0 }}>
                {s.late ? `Mangler siden ${formatLong(s.due).split(' ')[0].toLowerCase()}` : ''}{s.late && s.option ? ' · ' : ''}{s.option ?? ''}
              </span>
            )}
          </span>
          {s.kind === 'due' ? (
            <>
              {s.late && <button className="btn ghost small" onClick={() => go(`faste/${r.id}/tidligere`)}>Anden dag</button>}
              <button className="btn primary small" onClick={() => save({ ...r, log: [{ due: s.due, at: Date.now(), option: s.option }, ...r.log] })}>Taget</button>
            </>
          ) : s.kind === 'done' ? (
            <button className="today-done" onClick={() => save({ ...r, log: r.log.filter((l) => l.due !== s.due) })} aria-label={`Fortryd ${r.name}`}>✓ {time(s.at).replace(':', '.')}</button>
          ) : null}
        </div>
      ))}
      {later.map((l) => <button key={l.key} className="today-later" onClick={() => go(l.go)}>{l.text} ›</button>)}
    </section>
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
