import { useState } from 'react';
import { agenda, at, type AgendaItem } from '../lib/agenda';
import { calendarLink } from '../lib/conversation';
import { addDays, addMonths, formatFull, formatMonth, fromISO, monthId, today, weekStart } from '../lib/dates';
import { useStore } from '../lib/store';
import type { Appointment } from '../lib/types';
import { currentToken } from '../lib/google';
import { needsPush } from '../lib/gcalWrite';
import { pushAppointments, pushCalendar, syncGoogle, useGoogleState } from '../lib/googleSync';
import { AgendaIcon, go, Header, Icon, Switch, uid } from '../ui';

const DAYS = ['ma', 'ti', 'on', 'to', 'fr', 'lø', 'sø'];

function ItemLine({ item }: { item: AgendaItem }) {
  return (
    <span className="small">
      <AgendaIcon item={item} /> <strong>{item.title}</strong>
      {item.time ? ` ${at(item.time)}` : ''}
      {item.detail ? ` · ${item.detail}` : ''}
      {item.kind === 'routine' && item.done ? ' · ✓ taget' : ''}
    </span>
  );
}

function ago(ms: number): string {
  const min = Math.round((Date.now() - ms) / 60_000);
  if (min < 1) return 'lige nu';
  if (min < 60) return `for ${min} min. siden`;
  const h = Math.round(min / 60);
  if (h < 24) return `for ${h} ${h === 1 ? 'time' : 'timer'} siden`;
  const d = Math.round(h / 24);
  return `for ${d} ${d === 1 ? 'dag' : 'dage'} siden`;
}

/** Status for Google Kalender med knappen Opdatér. */
function GoogleLine() {
  const store = useStore();
  const g = store.data.settings.google;
  const { busy, error } = useGoogleState();
  if (!g.email && !currentToken()) {
    return <button className="link tiny" style={{ alignSelf: 'flex-start' }} onClick={() => go('indstillinger')}>Hent aftaler fra Google Kalender …</button>;
  }
  return (
    <div className="row between" style={{ gap: 8 }}>
      <span className="tiny muted">
        <i className="g-dot" style={{ background: '#1a73e8' }} /> = Google Kalender
        {busy ? ' · henter …' : g.lastSync ? ` · hentet ${ago(g.lastSync)}` : ' · ikke hentet endnu'}
        {error && <span className="error" style={{ display: 'block' }}>{error}</span>}
      </span>
      <button className="btn ghost small" disabled={busy} onClick={() => syncGoogle(store, { login: true })}>{busy ? <span className="spinner" /> : 'Opdatér'}</button>
    </div>
  );
}

/** Kalender: måned med prikker, valgt dag med detaljer, og de næste 7 dage. */
export function CalendarScreen({ month: routeMonth, startAdding }: { month?: string; startAdding?: boolean }) {
  const store = useStore();
  const { data } = store;
  const t = today();
  const [month, setMonth] = useState(routeMonth ?? monthId(t));
  const [selected, setSelected] = useState(t);
  // Genvejen "Ny aftale" på ikonet åbner formularen med det samme
  const [adding, setAdding] = useState<Appointment | null>(() => {
    if (!startAdding) return null;
    const gg = data.settings.google;
    return { id: uid(), title: '', date: t, time: '', place: '', createdAt: Date.now(), toGoogle: !!gg.email && gg.push };
  });

  const first = `${month}-01`;
  const gridStart = weekStart(first);
  const last = addDays(addMonths(first, 1), -1);
  const gridEnd = addDays(weekStart(last), 6);
  const cells: string[] = [];
  for (let d = gridStart; d <= gridEnd; d = addDays(d, 1)) cells.push(d);
  const [showDaily, setShowDaily] = useState(() => {
    try { return localStorage.getItem('dagbog-cal-daily') === '1'; } catch { return false; }
  });
  const toggleDaily = (v: boolean) => {
    setShowDaily(v);
    try { localStorage.setItem('dagbog-cal-daily', v ? '1' : '0'); } catch { /* ikke afgørende */ }
  };
  // Faste ting hver dag fylder for meget i kalenderen; de står på Skriv-siden
  const isDaily = (i: AgendaItem) => i.kind === 'routine' && !data.routines[i.ref]?.monthly && (data.routines[i.ref]?.everyDays ?? 0) <= 1;
  const hasDaily = Object.values(data.routines).some((r) => !r.monthly && r.everyDays <= 1);
  const shown = (list: AgendaItem[]) => (showDaily ? list : list.filter((i) => !isDaily(i)));
  const items = shown(agenda(data, gridStart, gridEnd));
  const byDay = new Map<string, AgendaItem[]>();
  for (const i of items) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  const calName = (id: string) => data.settings.google.calendars.find((c) => c.id === id)?.name ?? '';
  const talksOn = (d: string) => Object.values(data.conversations).filter((c) => c.date === d);

  const nextWeek = shown(agenda(data, t, addDays(t, 7)));
  const dayItems = shown(agenda(data, selected, selected));

  const g = data.settings.google;
  const connected = !!g.email;
  const newAppointment = (date: string): Appointment => ({ id: uid(), title: '', date, time: '', place: '', createdAt: Date.now(), toGoogle: connected && g.push });
  const saveAppointment = async () => {
    if (!adding || !adding.title.trim()) return;
    const saved: Appointment = { ...adding, title: adding.title.trim(), place: adding.place.trim(), note: adding.note?.trim() || undefined, changedAt: Date.now() };
    // Skal den ikke længere ligge i Google, slettes den dér
    const removed = !saved.toGoogle && saved.google ? { cal: saved.google.cal, id: saved.google.id, ref: saved.id } : undefined;
    if (removed) delete saved.google;
    await store.put('appointments', saved.id, saved);
    pushAppointments(store, [saved], removed);
    setSelected(adding.date);
    setMonth(monthId(adding.date));
    setAdding(null);
  };

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header title="Kalender" right={<button className="btn small" onClick={() => { setMonth(monthId(t)); setSelected(t); }}>I dag</button>} />

      {hasDaily && (
        <div className="seg-chips" role="group" aria-label="Vis faste ting hver dag">
          <button className={`chip ${!showDaily ? 'on' : ''}`} aria-pressed={!showDaily} onClick={() => toggleDaily(false)}>Uden daglige</button>
          <button className={`chip ${showDaily ? 'on' : ''}`} aria-pressed={showDaily} onClick={() => toggleDaily(true)}>Med daglige</button>
        </div>
      )}

      <section className="stack-sm">
        <h3>De næste 7 dage</h3>
        {nextWeek.length === 0 && <p className="small muted">Intet planlagt.</p>}
        {nextWeek.length > 0 && (
          <div className="card agenda">
            {nextWeek.map((i, n) => (
              <button key={n} className="agenda-row" onClick={() => { setSelected(i.date); setMonth(monthId(i.date)); }}>
                <span className="agenda-date">
                  {(n === 0 || nextWeek[n - 1].date !== i.date) && <><b>{fromISO(i.date).getDate()}</b><span>{i.date === t ? 'i dag' : DAYS[(fromISO(i.date).getDay() + 6) % 7]}</span></>}
                </span>
                <span className="agenda-bar" style={{ background: i.kind === 'google' ? i.color || '#1a73e8' : 'var(--accent)' }} />
                <span className="grow">
                  <strong style={{ display: 'block' }}>{i.kind !== 'google' && i.icon ? `${i.icon} ` : ''}{i.title}</strong>
                  <span className="small muted">{[i.time ? i.time.replace(':', '.') : '', i.detail ?? '', i.kind === 'routine' && i.done ? '✓ taget' : ''].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="stack-sm">
        <div className="row between">
          <button className="day-arrow" onClick={() => setMonth(monthId(addMonths(first, -1)))} aria-label="Forrige måned">{Icon.chevronLeft}</button>
          <strong className="serif" style={{ fontSize: '1.25rem' }}>{formatMonth(month)}</strong>
          <button className="day-arrow" onClick={() => setMonth(monthId(addMonths(first, 1)))} aria-label="Næste måned">{Icon.chevronRight}</button>
        </div>
        <div className="cal" key={month}>
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
                  {its.slice(0, 2).map((i, n) => <i key={n} className="cal-ico"><AgendaIcon item={i} /></i>)}
                </span>
              </button>
            );
          })}
        </div>
        <p className="tiny muted">● = skrevet i dagbogen</p>
        <GoogleLine />
      </section>

      <section className="stack-sm">
        <h3>{formatFull(selected)}</h3>
        {dayItems.map((i, n) => (
          <div key={n} className="card stack-sm" style={{ padding: '10px 12px' }}>
            <ItemLine item={i} />
            {i.kind === 'appointment' && (() => {
              const a = data.appointments[i.ref];
              return (
                <>
                  {a.note && <span className="small">{a.note}</span>}
                  {a.google && !needsPush(a) ? <span className="g-badge">✓ I Google</span>
                    : a.toGoogle ? <span className="tiny muted">Sendes til Google, når der er forbindelse</span> : null}
                  <div className="row wrap" style={{ gap: 6 }}>
                    {!connected && (
                      <a className="btn small" href={calendarLink({ title: i.title, date: i.date, time: i.time, durationMinutes: 60, place: i.detail ?? '' }, 'Fra dagbogen.')}
                        {...(/Android/i.test(navigator.userAgent) ? {} : { target: '_blank', rel: 'noopener' })}>Læg i Google Kalender</a>
                    )}
                    <button className="btn ghost small" onClick={() => setAdding({ ...a })}>Ret</button>
                    <button className="btn ghost small" onClick={async () => {
                      await store.remove('appointments', a.id);
                      if (a.google) pushAppointments(store, [], { cal: a.google.cal, id: a.google.id, ref: a.id });
                    }}>Slet</button>
                  </div>
                </>
              );
            })()}
            {i.kind === 'google' && <span className="tiny muted">Fra Google Kalender{calName(i.ref) ? ` (${calName(i.ref)})` : ''}</span>}
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
        {!adding && <button className="fab" onClick={() => setAdding(newAppointment(selected))}><span style={{ width: 22, height: 22, display: 'inline-flex' }}>{Icon.plus}</span>Aftale</button>}
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
          <label className="field">Note (valgfrit)
            <input type="text" value={adding.note ?? ''} placeholder="Fx Camilla kommer" onChange={(e) => setAdding({ ...adding, note: e.target.value })} />
          </label>
          {connected && (
            <div className="g-push">
              <span className="grow">
                <strong style={{ display: 'block' }}>Også i Google Kalender</strong>
                <span className="small muted">{g.calendars.find((c) => c.id === (adding.google?.cal ?? pushCalendar(g)))?.name ?? g.email}</span>
              </span>
              <Switch checked={!!adding.toGoogle} onChange={(v) => setAdding({ ...adding, toGoogle: v })} label="Også i Google Kalender" />
            </div>
          )}
          <div className="row">
            <button className="btn primary" disabled={!adding.title.trim()} onClick={saveAppointment}>Gem</button>
            <button className="btn ghost" onClick={() => setAdding(null)}>Fortryd</button>
          </div>
        </section>
      )}
    </div>
  );
}

