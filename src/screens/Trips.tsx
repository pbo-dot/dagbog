// Rejser under Husk: alle rejser (fra Tidslinjen og billederne) med forsidebilleder, og en side pr. rejse
// dag for dag med steder, billeder og egen tekst (ellers Claudes beskrivelser af billederne).
import { useMemo, useState } from 'react';
import { addDays, addMonths, formatLong, today } from '../lib/dates';
import { countryName, dayDescs, dayStays, dayThumbs, fixedStays, stayTime, trips } from '../lib/places';
import { PlacesMap, stayPoints } from './PlacesMap';
import { PhonePhotos } from './PhonePhotos';
import { useStore } from '../lib/store';
import type { FixedPlace } from '../lib/types';
import { DoubleConfirm, go, Header, PhotoImg, PhotoViewer } from '../ui';

const NONE: FixedPlace[] = [];

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
export function useTrips(): Trip[] {
  const { data } = useStore();
  const fixed = data.settings.places?.fixed ?? NONE;
  return useMemo(() => {
    const list: Trip[] = [...trips(data.phonePhotos, data.visits, fixed, data.settings.places?.notTrip)]; // kopi: listen fra trips() huskes og må ikke ændres
    for (const { place, stays } of fixedStays(data.phonePhotos, data.visits, fixed)) {
      for (const st of stays) list.push({ from: st.from, to: st.to, cities: [place.name], countries: [], fixed: place.name });
    }
    return list.sort((a, b) => b.to.localeCompare(a.to));
  }, [data.phonePhotos, data.visits, fixed, data.settings.places?.notTrip]);
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
  const store = useStore();
  const { data } = store;
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
      <PlacesMap points={days.flatMap((d) => stayPoints(dayStays(data.phonePhotos, d, data.visits, fixed), stayTime, `${Number(d.slice(8))}/${Number(d.slice(5, 7))} · `))} fixed={fixed} height={260} />
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
            <PhonePhotos ids={dayIds} small />
            {entry ? (
              <p className="serif trip-day-text">{entry.text.length > 220 ? `${entry.text.slice(0, 220).trimEnd()} …` : entry.text} <span className="tiny muted">· din tekst</span></p>
            ) : data.stories[d]?.text ? (
              <p className="serif trip-day-text">{data.stories[d].text}</p>
            ) : descs.length > 0 ? (
              <p className="serif trip-day-text">{descs.slice(0, 3).map((x) => x.text.replace(/\.?$/, '.')).join(' ')}</p>
            ) : null}
          </section>
        );
      })}
      {!trip.fixed && trip.cities.length > 0 && (
        <DoubleConfirm className="btn" label="Ikke en rejse" first={`${trip.cities.join(', ')} tæller aldrig mere som rejse. Fortsæt?`} second="Er du sikker?"
          onConfirm={async () => {
            const places = data.settings.places ?? { fixed: [], notFixed: [] };
            const notTrip = [...new Set([...(places.notTrip ?? []), ...trip.cities])];
            await store.saveSettings({ ...data.settings, places: { ...places, notTrip } });
            go('husk/rejser');
          }} />
      )}
      {open && <PhotoViewer id={open.id} ids={open.ids} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Husk: den seneste rejse med billeder (ellers den seneste rejse) som stort kort. */
export function LatestTripCard() {
  const { data } = useStore();
  const all = useTrips();
  const real = all.filter((t) => !t.fixed);
  const t = real.find((x) => tripPhotos(data.phonePhotos, x).length > 0) ?? real[0];
  if (!t) return null;
  const ids = tripPhotos(data.phonePhotos, t);
  const c = cover(ids);
  const title = t.cities.slice(0, 3).join(', ');
  return (
    <button className="latest-trip" onClick={() => go(`husk/rejse/${t.from}_${t.to}`)}>
      {c.length > 0 && <span className={`trip-cover n${c.length}`}>{c.map((id) => <PhotoImg key={id} id={id} className="trip-cover-img" alt="" />)}</span>}
      <span className="trip-hero-text">
        <small>Seneste rejse</small>
        <b>{title}</b>
        <span>{tripDates(t.from, t.to)}{t.countries.length ? ` · ${t.countries.map(countryName).join(', ')}` : ''}{ids.length ? ` · ${ids.length} billeder` : ''}</span>
      </span>
    </button>
  );
}

/** Husk: samme dag sidste år (eller en dag tæt på) med billede og sted. */
export function YearAgoCard() {
  const { data } = useStore();
  const fixed = data.settings.places?.fixed;
  const base = addMonths(today(), -12);
  const tries = [0, -1, 1, -2, 2, -3, 3].map((n) => addDays(base, n));
  const day = tries.find((d) => dayThumbs(data.phonePhotos, d).length > 0)
    ?? tries.find((d) => data.entries[d] || dayStays(data.phonePhotos, d, data.visits, fixed).length > 0);
  if (!day) return null;
  const ids = dayThumbs(data.phonePhotos, day);
  const stays = [...new Set(dayStays(data.phonePhotos, day, data.visits, fixed).map((x) => x.city))];
  const entry = data.entries[day];
  const title = stays.slice(0, 2).join(', ') || entry?.text.split('\n')[0].slice(0, 60) || 'Sted ukendt';
  return (
    <button className="card tappable year-ago" onClick={() => go(`husk/dag/${day}`)}>
      {ids[0]
        ? <PhotoImg id={ids[0]} className="year-ago-img" alt="" />
        : <span className="year-ago-img year-ago-ico" aria-hidden="true">📍</span>}
      <span className="grow" style={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left' }}>
        <span className="overline">For et år siden</span>
        <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</strong>
        <span className="small muted">{formatLong(day)}{ids.length ? ` · ${ids.length} ${ids.length === 1 ? 'billede' : 'billeder'}` : ''}</span>
      </span>
    </button>
  );
}

/** "189 rejser siden 2014" til rækken på Husk. */
export function useTripCountText(): string {
  const real = useTrips().filter((t) => !t.fixed);
  if (!real.length) return 'Hvor du har været, med billeder';
  return `${real.length} ${real.length === 1 ? 'rejse' : 'rejser'} siden ${real[real.length - 1].from.slice(0, 4)}`;
}
