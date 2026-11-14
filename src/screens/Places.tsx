// "Billeder og steder" (under Mere): hjælpe-appen "Dagbog Billeder" sender dato og sted for
// kamera-billederne, og Dagbog viser, hvor du har været. Selve billederne bliver på telefonen.
import { useMemo, useRef, useState } from 'react';
import { addDays, formatMonth, toISO } from '../lib/dates';
import { countryName, dayPhotoCount, fixedStays, openAppUrl, THUMB_PX, suggestFixed, tripLine, trips } from '../lib/places';
import type { FixedPlace } from '../lib/types';
import { describeAll, importFiles, importTimeline, stopDescribing, undescribed, useDescribeState, useImportState } from '../lib/placesImport';
import { costUsd, krText } from '../lib/usage';
import { aiReady } from '../lib/generate';
import { useStore } from '../lib/store';
import { go, Header, uid } from '../ui';

/** "2.–6. maj 2025" eller "30. apr.–2. maj 2025" */
function tripDates(from: string, to: string): string {
  const f = new Date(`${from}T12:00:00`);
  const t = new Date(`${to}T12:00:00`);
  const d = (x: Date, o: Intl.DateTimeFormatOptions) => x.toLocaleDateString('da-DK', o);
  if (from === to) return d(f, { day: 'numeric', month: 'long', year: 'numeric' });
  if (from.slice(0, 7) === to.slice(0, 7)) return `${f.getDate()}.–${d(t, { day: 'numeric', month: 'long', year: 'numeric' })}`;
  return `${d(f, { day: 'numeric', month: 'short' })}–${d(t, { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

export function PlacesScreen() {
  const store = useStore();
  const { data } = store;
  const imp = useImportState();
  const desc = useDescribeState();
  const [copied, setCopied] = useState(false);
  const [allTrips, setAllTrips] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const oldInput = useRef<HTMLInputElement>(null);
  const visits = Object.values(data.visits).flatMap((m) => m.visits);
  const visitYears = visits.length ? [new Date(visits[0].s).getFullYear(), new Date(visits[visits.length - 1].s).getFullYear()] : [];
  const fixed = useMemo(() => data.settings.places?.fixed ?? [], [data.settings.places]);
  const notFixed = data.settings.places?.notFixed ?? [];
  // Rejser og de faste steder (én linje pr. sted og år), nyeste først
  const tripList = useMemo(() => {
    // Et tryk åbner den første dag med billeder (ellers den første dag)
    const photoDay = (from: string, to: string) => {
      for (let d = from; d <= to; d = addDays(d, 1)) if (dayPhotoCount(data.phonePhotos, d)) return d;
      return from;
    };
    const items: Array<{ key: string; to: string; title: string; sub: string; day: string }> = trips(data.phonePhotos, data.visits, fixed).map((t) => ({
      key: `t${t.from}`, to: t.to, day: photoDay(t.from, t.to),
      title: tripLine(t).replace(/^- [^:]+: /, '').replace(/ \(.*\)$/, ''),
      sub: `${tripDates(t.from, t.to)}${t.countries.length ? ` · ${t.countries.map(countryName).join(', ')}` : ''}`,
    }));
    for (const { place, stays } of fixedStays(data.phonePhotos, data.visits, fixed)) {
      const years = new Map<string, Array<{ from: string; to: string }>>();
      for (const st of stays) { const y = st.from.slice(0, 4); const l = years.get(y); if (l) l.push(st); else years.set(y, [st]); }
      for (const [y, ss] of years) {
        const last = ss[ss.length - 1];
        items.push({ key: `f${place.id}${y}`, to: last.to, day: [...ss].reverse().map((x) => photoDay(x.from, x.to)).find((d) => dayPhotoCount(data.phonePhotos, d)) ?? last.from, title: place.name, sub: `${ss.length} ${ss.length === 1 ? 'ophold' : 'ophold'} i ${y} · ${place.city}` });
      }
    }
    return items.sort((a, b) => b.to.localeCompare(a.to));
  }, [data.phonePhotos, data.visits, fixed]);
  const suggestions = useMemo(() => suggestFixed(data.phonePhotos, data.visits, fixed, notFixed).slice(0, 2), [data.phonePhotos, data.visits, fixed, notFixed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [names, setNames] = useState<Record<string, string>>({});
  const savePlaces = (next: { fixed: FixedPlace[]; notFixed: string[] }) => store.saveSettings({ ...data.settings, places: next });
  const months = Object.values(data.phonePhotos).sort((a, b) => b.id.localeCompare(a.id));
  const photos = months.flatMap((m) => m.photos);
  const days = new Set(photos.map((p) => toISO(new Date(p.t)))).size;
  const placed = photos.filter((p) => p.city).length;
  const thumbs = photos.filter((p) => p.thumb).length;
  const missing = undescribed(data.phonePhotos);
  const described = photos.filter((p) => p.desc).length;
  // Overslag: ca. 480 tokens pr. lille billede ind og 45 ud, plus lidt pr. kald
  const estimate = krText(costUsd(data.settings.ai.searchModel, { input_tokens: missing * 480 + Math.ceil(missing / 10) * 400, output_tokens: missing * 45 }));
  const last = Math.max(0, ...months.map((m) => m.importedAt));
  const home = 'DK'; // andre lande nævnes ved måneden

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header back="mere" />
      <div className="stack-sm">
        <h1>Billeder og steder</h1>
        <p className="small muted">Dato og sted fra dine billeder. Billederne selv bliver på telefonen.</p>
      </div>

      {photos.length > 0 && (
        <div className="stat-row">
          <div className="card"><b>{photos.length}</b><span className="small muted">billeder</span></div>
          <div className="card"><b>{days}</b><span className="small muted">dage</span></div>
          <div className="card"><b>{placed}</b><span className="small muted">med sted</span></div>
        </div>
      )}

      <section className="card stack-sm" style={{ background: 'var(--accent-soft)', boxShadow: 'none' }}>
        <strong>{photos.length ? 'Hent nye billeder' : 'Hent dine billeder'}</strong>
        <span className="small">Åbner hjælpe-appen "Dagbog Billeder", som læser dato og sted og sender dem tilbage hertil.</span>
        {thumbs > 0 && <span className="small">{thumbs} små billeder på dagene (op til 5 pr. dag).</span>}
        {last > 0 && <span className="small muted">Sidst hentet {new Date(last).toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
        <button className="btn primary block" disabled={imp.busy} onClick={() => { location.href = openAppUrl(data.settings.places?.thumbFrom); }}>
          {imp.busy ? 'Indlæser …' : 'Hent billeder'}
        </button>
        {thumbs > 0 && !data.settings.places?.thumbRedo && (data.settings.places?.thumbPx ?? 640) < THUMB_PX && (
          <button className="btn block" disabled={imp.busy} onClick={async () => {
            // Henter alle billeder igen fra den første dag; Claudes beskrivelser bevares
            await store.saveSettings({ ...data.settings, places: { ...(data.settings.places ?? { fixed: [], notFixed: [] }), thumbFrom: undefined, thumbRedo: true } });
            location.href = openAppUrl();
          }}>Hent billederne i bedre kvalitet</button>
        )}
        {data.settings.places?.thumbRedo && <span className="small">Henter i bedre kvalitet. Tryk "Hent billeder", til der ikke står "Der mangler flere".</span>}
      </section>

      {thumbs > 0 && aiReady(data) && (missing > 0 || desc.busy || desc.error) && (
        <section className="card stack-sm">
          <strong>Claude beskriver billederne</strong>
          {desc.busy
            ? <span className="small">Beskriver {desc.done} af {desc.total} …</span>
            : <span className="small">{missing} billeder mangler en beskrivelse. Ca. {estimate}, én gang. Så kan du spørge fx "hvornår var vi sidst på stranden?".</span>}
          {desc.error && <span className="small error">{desc.error}</span>}
          {desc.busy
            ? <button className="btn block" onClick={stopDescribing}>Stop</button>
            : <button className="btn primary block" onClick={() => void describeAll(store)}>Beskriv {missing} billeder</button>}
        </section>
      )}
      {described > 0 && !desc.busy && missing === 0 && <p className="small muted">{described} billeder er beskrevet af Claude.</p>}

      <section className="card stack-sm">
        <strong>Billeder fra en gammel telefon</strong>
        <span className="small">På den gamle telefon: åbn "Dagbog Billeder", tryk "Gem på Drev", og gem filerne på Drev. Vælg dem så her, gerne alle på én gang.</span>
        <button className="btn block" disabled={imp.busy} onClick={() => oldInput.current?.click()}>Vælg filer fra den gamle telefon</button>
        <input ref={oldInput} type="file" multiple accept=".txt,text/plain" hidden onChange={(e) => {
          const fs = [...(e.target.files ?? [])];
          e.target.value = '';
          if (fs.length) void importFiles(store, fs);
        }} />
      </section>

      <section className="card stack-sm">
        <strong>Tidslinje fra Google Maps</strong>
        <span className="small">{visits.length
          ? `${visits.length} ophold fra ${Math.min(...visitYears)} til ${Math.max(...visitYears)}.`
          : 'Giver steder for alle dage, også uden billeder. Eksportér den under Indstillinger → Placering → Tidslinje.'}</span>
        <button className="btn block" disabled={imp.busy} onClick={() => fileInput.current?.click()}>{visits.length ? 'Hent en Tidslinje-fil mere' : 'Vælg Tidslinje-fil'}</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void importTimeline(store, f);
        }} />
      </section>

      {imp.lines.length > 0 && (
        <section className="card stack-sm">
          <h3>{imp.busy ? 'Indlæser' : imp.error ? 'Det gik galt' : 'Seneste hentning'}</h3>
          <pre className="tiny" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace' }}>{imp.lines.join('\n')}</pre>
          <button className="btn small" onClick={async () => { try { await navigator.clipboard.writeText(imp.lines.join('\n')); setCopied(true); } catch { /* vælg teksten selv */ } }}>
            {copied ? '✓ Kopieret' : 'Kopiér til Claude'}
          </button>
        </section>
      )}

      {suggestions.map((sg) => (
        <section key={sg.city} className="card stack-sm" style={{ background: 'var(--accent-soft)', boxShadow: 'none' }}>
          <strong>Er {sg.city} et fast sted for dig?</strong>
          <span className="small">Du har været der på {sg.trips} rejser. Et fast sted, fx et sommerhus, samles til én linje pr. år.</span>
          <input type="text" value={names[sg.city] ?? ''} placeholder="Fx Sommerhuset" aria-label={`Navn til ${sg.city}`}
            onChange={(e) => setNames({ ...names, [sg.city]: e.target.value })} />
          <div className="row wrap">
            <button className="btn primary" disabled={!(names[sg.city] ?? '').trim()} onClick={() => savePlaces({
              fixed: [...fixed, { id: uid(), name: names[sg.city].trim(), city: sg.city, lat: sg.lat, lng: sg.lng }], notFixed,
            })}>Gem som fast sted</button>
            <button className="btn ghost" onClick={() => savePlaces({ fixed, notFixed: [...notFixed, sg.city] })}>Nej</button>
          </div>
        </section>
      ))}

      {fixed.length > 0 && (
        <section className="stack-sm">
          <h3>Faste steder</h3>
          <div className="card list" style={{ padding: '2px 16px' }}>
            {fixed.map((f) => (
              <div key={f.id} className="list-item">
                <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <strong>🏡 {f.name}</strong>
                  <span className="small muted">{f.city}</span>
                </span>
                <button className="btn ghost small" onClick={() => savePlaces({ fixed: fixed.filter((x) => x.id !== f.id), notFixed })}>Fjern</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {tripList.length > 0 && (
        <section className="stack-sm">
          <h3>Rejser · {tripList.length}</h3>
          <div className="card list" style={{ padding: '2px 16px' }}>
            {(allTrips ? tripList : tripList.slice(0, 12)).map((t) => (
              <button key={t.key} className="list-item" onClick={() => go(`husk/dag/${t.day}`)}>
                <span className="grow" style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <strong>{t.key.startsWith('f') ? `🏡 ${t.title}` : t.title}</strong>
                  <span className="small muted">{t.sub}</span>
                </span>
              </button>
            ))}
          </div>
          {!allTrips && tripList.length > 12 && <button className="btn ghost" onClick={() => setAllTrips(true)}>Vis alle {tripList.length}</button>}
        </section>
      )}

      {months.length > 0 && (
        <section className="stack-sm">
          <h3>Billeder pr. måned</h3>
          <div className="card list" style={{ padding: '2px 16px' }}>
            {months.map((m) => {
              const byCity = new Map<string, number>();
              for (const p of m.photos) if (p.city) byCity.set(p.city, (byCity.get(p.city) ?? 0) + 1);
              const top = [...byCity.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([c]) => c);
              const abroad = [...new Set(m.photos.map((p) => p.cc).filter((c): c is string => !!c && c !== home))].map(countryName);
              return (
                <button key={m.id} className="list-item" onClick={() => go(`husk/maaned/${m.id}`)}>
                  <span className="grow" style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <strong>{formatMonth(m.id)}</strong>
                    <span className="small muted">{[abroad.join(', '), top.join(' · ')].filter(Boolean).join(' — ') || 'Intet sted'} · {m.photos.length} billeder</span>
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      <p className="tiny muted">Bynavne: GeoNames (CC BY 4.0), regnet på telefonen.</p>
    </div>
  );
}
