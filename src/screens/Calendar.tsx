import { useState } from 'react';
import { agenda, at, type AgendaItem } from '../lib/agenda';
import { calendarLink } from '../lib/conversation';
import { addDays, addMonths, formatFull, formatMonth, fromISO, monthId, today, weekStart } from '../lib/dates';
import { useStore } from '../lib/store';
import type { Appointment } from '../lib/types';
import { go, Header, uid } from '../ui';

const DAYS = ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'];

function ItemLine({ item }: { item: AgendaItem }) {
  return (
    <span className="small">
      {item.icon} <strong>{item.title}</strong>
      {item.time ? ` ${at(item.time)}` : ''}
      {item.detail ? ` · ${item.detail}` : ''}
      {item.kind === 'routine' && item.done ? ' · ✓ taget' : ''}
    </span>
  );
}

/** Kalender: måned med prikker, valgt dag med detaljer, og de næste 7 dage. */
export function CalendarScreen({ month: routeMonth }: { month?: string }) {
  const store = useStore();
  const { data } = store;
  const t = today();
  const [month, setMonth] = useState(routeMonth ?? monthId(t));
  const [selected, setSelected] = useState(t);
  const [adding, setAdding] = useState<Appointment | null>(null);

  const first = `${month}-01`;
  const gridStart = weekStart(first);
  const last = addDays(addMonths(first, 1), -1);
  const gridEnd = addDays(weekStart(last), 6);
  const cells: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) cells.push(d);
  const items = agenda(data, gridStart, gridEnd);
  const byDay = new Map<string, AgendaItem[]>();
  for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  const talksOn = (d: string) => Object.values(data.conversations).filter((c) => c.date === d);

  const nextWeek = agenda(data, t, addDays(t, 7));
  const dayItems = agenda(data, selected, selected);

  const newAppointment = (date: string): Appointment => ({ id: uid(), title: '', date, time: '', place: '', createdAt: Date.now() });
  const saveAppointment = async () => {
    if (!adding || !adding.title.trim()) return;
    await store.put('appointments', adding.id, { ...adding, title: adding.title.trim(), place: adding.place.trim() });
    setSelected(adding.date);
    setMonth(monthId(adding.date));
    setAdding(null);
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header title="Kalender" right={<button className="btn ghost small" onClick={() => { setMonth(monthId(t)); setSelected(t); }}>I dag</button>} />

      <section className="stack-sm">
        <h3>De næste 7 dage</h3>
        {nextWeek.length === 0 && <p className="small muted">Intet planlagt.</p>}
        <div className="list">
          {nextWeek.map((i, n) => (
            <button key={n} className="list-item" onClick={() => { setSelected(i.date); setMonth(monthId(i.date)); }}>
              <span className="tiny muted">{i.date === t ? 'I dag' : i.date === addDays(t, 1) ? 'I morgen' : formatFull(i.date)}</span>
              <ItemLine item={i} />
            </button>
          ))}
        </div>
      </section>

      <section className="stack-sm">
        <div className="row between">
          <button className="btn ghost" onClick={() => setMonth(monthId(addMonths(first, -1)))} aria-label="Forrige måned">‹</button>
          <strong className="serif" style={{ fontSize: '1.15rem' }}>{formatMonth(month)}</strong>
          <button className="btn ghost" onClick={() => setMonth(monthId(addMonths(first, 1)))} aria-label="Næste måned">›</button>
        </div>
        <div className="cal">
          {DAYS.map((d) => <span key={d} className="cal-head">{d}</span>)}
          {cells.map((d) => {
            const its = byDay.get(d) ?? [];
            const written = !!data.entries[d];
            return (
              <button key={d}
                className={`cal-day${d.slice(0, 7) !== month ? ' other' : ''}${d === t ? ' today' : ''}${d === selected ? ' sel' : ''}`}
                onClick={() => setSelected(d)} aria-label={formatFull(d)}>
                <span>{fromISO(d).getDate()}</span>
                <span className="cal-marks">
                  {written && <i className="cal-dot" />}
                  {its.slice(0, 2).map((i, n) => <i key={n} className="cal-ico">{i.icon}</i>)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="tiny muted">● = skrevet i dagbogen</p>
      </section>

      <section className="stack-sm">
        <h3>{formatFull(selected)}</h3>
        {dayItems.map((i, n) => (
          <div key={n} className="card stack-sm" style={{ padding: '10px 12px' }}>
            <ItemLine item={i} />
            {i.kind === 'appointment' && (
              <div className="row wrap" style={{ gap: 6 }}>
                <a className="btn small" href={calendarLink({ title: i.title, date: i.date, time: i.time, durationMinutes: 60, place: i.detail ?? '' }, 'Fra dagbogen.')}
                  {...(/Android/i.test(navigator.userAgent) ? {} : { target: '_blank', rel: 'noopener' })}>Læg i Google Kalender</a>
                <button className="btn ghost small" onClick={() => setAdding({ ...data.appointments[i.ref] })}>Ret</button>
                <button className="btn ghost small" onClick={() => store.remove('appointments', i.ref)}>Slet</button>
              </div>
            )}
            {i.kind === 'event' && <button className="link tiny" style={{ alignSelf: 'flex-start' }} onClick={() => go(`samtale/${i.ref}`)}>Fra en samtale</button>}
            {i.kind === 'routine' && <button className="link tiny" style={{ alignSelf: 'flex-start' }} onClick={() => go(`faste/${i.ref}`)}>Faste ting</button>}
          </div>
        ))}
        {talksOn(selected).map((c) => (
          <button key={c.id} className="list-item" onClick={() => go(`samtale/${c.id}`)}><span className="small">💬 Samtale: <strong>{c.title}</strong></span></button>
        ))}
        {data.entries[selected] ? (
          <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => go(`husk/dag/${selected}`)}>Læs dagen i dagbogen</button>
        ) : selected <= t ? (
          <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => go(selected === t ? 'skriv' : `skriv/${selected}`)}>Skriv om dagen</button>
        ) : null}
        {!adding && <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setAdding(newAppointment(selected))}>+ Ny aftale</button>}
      </section>

      {adding && (
        <section className="card stack-sm">
          <h3>{data.appointments[adding.id] ? 'Ret aftale' : 'Ny aftale'}</h3>
          <label className="field">Hvad
            <input type="text" autoFocus value={adding.title} placeholder="Fx Ørelæge" onChange={(e) => setAdding({ ...adding, title: e.target.value })} />
          </label>
          <div className="row">
            <label className="field grow">Dato
              <input type="date" value={adding.date} onChange={(e) => e.target.value && setAdding({ ...adding, date: e.target.value })} />
            </label>
            <label className="field">Klokken
              <input type="time" value={adding.time} onChange={(e) => setAdding({ ...adding, time: e.target.value })} />
            </label>
          </div>
          <label className="field">Sted (valgfrit)
            <input type="text" value={adding.place} onChange={(e) => setAdding({ ...adding, place: e.target.value })} />
          </label>
          <div className="row">
            <button className="btn primary" disabled={!adding.title.trim()} onClick={saveAppointment}>Gem</button>
            <button className="btn ghost" onClick={() => setAdding(null)}>Fortryd</button>
          </div>
        </section>
      )}
    </div>
  );
}

