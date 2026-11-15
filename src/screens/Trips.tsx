// Rejser under Husk: alle rejser (fra Tidslinjen og billederne) med forsidebilleder, og en side pr. rejse
// dag for dag med steder, billeder og egen tekst (ellers Claudes beskrivelser af billederne).
import { useMemo, useState } from 'react';
import { addDays, formatLong } from '../lib/dates';
import { countryName, dayDescs, dayStays, dayThumbs, fixedStays, trips } from '../lib/places';
import { useStore } from '../lib/store';
import { go, Header, PhotoImg, PhotoViewer } from '../ui';

interface Trip { from: string; to: string; cities: string[]; countries: string[]; fixed?: string }

function daysOf(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
}

/** "1.–14. september 2026" eller "30. apr.–2. maj 2025" */
export function tripDates(from: string, to: string): string {
  const f = new Date(`${from}T12:00:00`);
  const t = new Date(`${to}T12:00:00`);
  const d = (x: Date, o: Intl.DateTimeFormatOptions) => x.toLocaleDateString('da-DK', o);
  if (from === to) return d(f, { day: 'numeric', month: 'long', year: 'numeric' });
  if (from.slice(0, 7) === to.slice(0, 7)) return `${f.getDate()}.–${d(t, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return `${d(f, { day: 'numeric', month: 'short' })}–${d(t, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

/** Alle rejser og ophold ved faste steder, nyeste først. */
function useTrips(): Trip[] {
  const { data } = useStore();
  const fixed = data.settings.places?.fixed ?? [];
  return useMemo(() => {
    const list: Trip[] = trips(data.phonePhotos, data.visits, fixed);
    for (const { place, stays } of fixedStays(data.phonePhotos, data.visits, fixed)) {
      for (const st of stays) list.push({ from: st.from, to: st.to, cities: [place.name], countries: [], fixed: place.name });
    }
    return list.sort((a, b) => b.to.localeCompare(a.to));
  }, [data.phonePhotos, data.visits, fixed]);
}

function tripPhotos(months: Parameters<typeof dayThumbs>[0], t: Trip): string[] {
  return daysOf(t.from, t.to).flatMap((d) => dayThumbs(months, d));
}

/** Tre billeder spredt over rejsen til forsiden. */
function cover(ids: string[]): string[] {
  if (ids.length <= 3) return ids;
  return [ids[0], ids[Math.floor(ids.length / 2)], ids[ids.length - 1]];
}

export function TripsScreen() {
  const { data } = useStore();
  const all = useTrips();
  const fixedNames = [...new Set((data.settings.places?.fixed ?? []).map((f) => f.name))];
  const [filter, setFilter] = useState<string>('alle');
  const [shown, setShown] = useState(20);
  const withPhotos = useMemo(() => new Map(all.map((t) => [`${t.from}_${t.to}_${t.fixed ?? ''}`, tripPhotos(data.phonePhotos, t)])), [all, data.phonePhotos]);
  const key = (t: Trip) => `${t.from}_${t.to}_${t.fixed ?? ''}`;
  const list = all.filter((t) => filter === 'alle' ? !t.fixed
    : filter === 'billeder' ? !t.fixed && withPhotos.get(key(t))!.length > 0
    : filter === 'udlandet' ? t.countries.length > 0
    : t.fixed === filter);
  const real = all.filter((t) => !t.fixed);
  const first = real.length ? real[real.length - 1].from.slice(0, 4) : '';
  const chips: Array<[string, string]> = [['alle', 'Alle'], ['billeder', 'Med billeder'], ['udlandet', 'Udlandet'], ...fixedNames.map((n): [string, string] => [n, `🏡 ${n}`])];

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Header back="husk" />
      <div className="stack-sm">
        <h1>Rejser</h1>
        <p className="small muted">{real.length} rejser{first ? ` siden ${first}` : ''} · {real.filter((t) => withPhotos.get(key(t))!.length).length} med billeder</p>
      </div>
      <div className="chips">
        {chips.map(([id, label]) => <button key={id} className={`chip ${filter === id ? 'on' : ''}`} onClick={() => { setFilter(id); setShown(20); }}>{label}</button>)}
      </div>
      {!all.length && <p className="muted">Ingen rejser endnu. Hent din Tidslinje og dine billeder under Mere → Billeder og steder.</p>}
      {list.slice(0, shown).map((t) => {
        const ids = withPhotos.get(key(t))!;
        const title = t.fixed ? `🏡 ${t.fixed}` : t.cities.slice(0, 3).join(', ');
        const sub = `${tripDates(t.from, t.to)}${t.countries.length ? ` · ${t.countries.map(countryName).join(', ')}` : ''}${ids.length ? ` · ${ids.length} billeder` : ''}`;
        const open = () => go(`husk/rejse/${t.from}_${t.to}${t.fixed ? `_${encodeURIComponent(t.fixed)}` : ''}`);
        if (!ids.length) {
          return (
            <button key={key(t)} className="trip-mini" onClick={open}>
              <span className="trip-mini-ico" aria-hidden="true">{t.countries.length ? '✈️' : '📍'}</span>
              <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
                <strong>{title}</strong><span className="small muted">{sub}</span>
              </span>
            </button>
          );
        }
        const c = cover(ids);
        return (
          <button key={key(t)} className="trip-card" onClick={open}>
            <span className={`trip-cover n${c.length}`}>{c.map((id) => <PhotoImg key={id} id={id} className="trip-cover-img" alt="" />)}</span>
            <span className="trip-body"><strong>{title}</strong><span className="small muted">{sub}</span></span>
          </button>
        );
      })}
      {list.length > shown && <button className="btn" onClick={() => setShown((n) => n + 30)}>Vis flere ({list.length - shown})</button>}
    </div>
  );
}

export function TripScreen({ id }: { id: string }) {
  const { data } = useStore();
  const [from, to, fixedRaw] = id.split('_');
  const fixedName = fixedRaw ? decodeURIComponent(fixedRaw) : '';
  const all = useTrips();
  const trip = all.find((t) => t.from === from && t.to === to && (t.fixed ?? '') === fixedName) ?? { from, to, cities: [], countries: [] };
  const fixed = data.settings.places?.fixed;
  const days = daysOf(from, to);
  const ids = days.flatMap((d) => dayThumbs(data.phonePhotos, d));
  const cities = [...new Set(days.flatMap((d) => dayStays(data.phonePhotos, d, data.visits, fixed).map((x) => x.city)))];
  const written = days.filter((d) => data.entries[d]).length;
  const [open, setOpen] = useState<{ id: string; ids: string[] } | null>(null);
  const title = trip.fixed ? trip.fixed : trip.cities.slice(0, 3).join(', ') || 'Rejse';

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Header back="husk/rejser" />
      <div className="trip-hero">
        {ids[0] && <PhotoImg id={ids[0]} className="trip-hero-img" alt="" />}
        <span className="trip-hero-text">
          <b>{title}</b>
          <span>{tripDates(from, to)} · {days.length} {days.length === 1 ? 'dag' : 'dage'}{trip.countries.length ? ` · ${trip.countries.map(countryName).join(', ')}` : ''}</span>
        </span>
      </div>
      <div className="stat-row">
        <div className="card"><b>{ids.length}</b><span className="small muted">billeder</span></div>
        <div className="card"><b>{cities.length}</b><span className="small muted">{cities.length === 1 ? 'by' : 'byer'}</span></div>
        <div className="card"><b>{written}</b><span className="small muted">dage skrevet</span></div>
      </div>
      {days.map((d) => {
        const dayIds = dayThumbs(data.phonePhotos, d);
        const stays = [...new Set(dayStays(data.phonePhotos, d, data.visits, fixed).map((x) => x.city))];
        const entry = data.entries[d];
        const descs = dayDescs(data.phonePhotos, d);
        return (
          <section key={d} className="card trip-day">
            <button className="trip-day-head" onClick={() => go(`husk/dag/${d}`)}>
              <strong>{formatLong(d)}</strong>
              <span className="small muted">{stays.slice(0, 3).join(' · ')}</span>
            </button>
            {dayIds.length > 0 && (
              <div className="photo-strip">
                {dayIds.map((pid) => <PhotoImg key={pid} id={pid} className="strip-img small" onClick={() => setOpen({ id: pid, ids: dayIds })} alt="Billede fra dagen" />)}
              </div>
            )}
            {entry ? (
              <p className="serif trip-day-text">{entry.text.length > 220 ? `${entry.text.slice(0, 220).trimEnd()} …` : entry.text} <span className="tiny muted">· din tekst</span></p>
            ) : descs.length > 0 ? (
              <p className="serif trip-day-text">{descs.slice(0, 3).map((x) => x.text.replace(/\.?$/, '.')).join(' ')}</p>
            ) : null}
          </section>
        );
      })}
      {open && <PhotoViewer id={open.id} ids={open.ids} onClose={() => setOpen(null)} />}
    </div>
  );
}
