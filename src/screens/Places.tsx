// "Billeder og steder" (under Mere): hjælpe-appen "Dagbog Billeder" sender dato og sted for
// kamera-billederne, og Dagbog viser, hvor du har været. Selve billederne bliver på telefonen.
import { useMemo, useRef, useState } from 'react';
import { hiddenThumbs, openAppUrl, setHidden, THUMB_PX, suggestFixed, trips } from '../lib/places';
import type { FixedPlace } from '../lib/types';
import { describeAll, importFiles, importTimeline, stopDescribing, undescribed, useDescribeState, useImportState } from '../lib/placesImport';
import { costUsd, krText } from '../lib/usage';
import { aiReady } from '../lib/generate';
import { useStore } from '../lib/store';
import { go, Header, PhotoImg, uid } from '../ui';

export function PlacesScreen() {
  const store = useStore();
  const { data } = store;
  const imp = useImportState();
  const desc = useDescribeState();
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const oldInput = useRef<HTMLInputElement>(null);
  const visits = Object.values(data.visits).flatMap((m) => m.visits);
  const visitYears = visits.length ? [new Date(visits[0].s).getFullYear(), new Date(visits[visits.length - 1].s).getFullYear()] : [];
  const fixed = useMemo(() => data.settings.places?.fixed ?? [], [data.settings.places]);
  const notFixed = data.settings.places?.notFixed ?? [];
  const hidden = useMemo(() => hiddenThumbs(data.phonePhotos), [data.phonePhotos]);
  const tripCount = useMemo(() => trips(data.phonePhotos, data.visits, fixed).length, [data.phonePhotos, data.visits, fixed]);
  const suggestions = useMemo(() => suggestFixed(data.phonePhotos, data.visits, fixed, notFixed).slice(0, 2), [data.phonePhotos, data.visits, fixed, notFixed]); // eslint-disable-line react-hooks/exhaustive-deps
  const [names, setNames] = useState<Record<string, string>>({});
  const savePlaces = (next: { fixed: FixedPlace[]; notFixed: string[] }) => store.saveSettings({ ...data.settings, places: next });
  const months = Object.values(data.phonePhotos).sort((a, b) => b.id.localeCompare(a.id));
  const photos = months.flatMap((m) => m.photos);
  const thumbs = photos.filter((p) => p.thumb).length;
  const missing = undescribed(data.phonePhotos);
  const described = photos.filter((p) => p.desc).length;
  // Overslag: ca. 480 tokens pr. lille billede ind og 45 ud, plus lidt pr. kald
  const estimate = krText(costUsd(data.settings.ai.searchModel, { input_tokens: missing * 480 + Math.ceil(missing / 10) * 400, output_tokens: missing * 45 }));
  const last = Math.max(0, ...months.map((m) => m.importedAt));

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header back="mere" />
      <div className="stack-sm">
        <h1>Billeder og steder</h1>
        <p className="small muted">Dato og sted fra dine billeder. Billederne selv bliver på telefonen.</p>
      </div>

      {(photos.length > 0 || visits.length > 0) && (
        <div className="stat-row">
          <div className="card"><b>{photos.length.toLocaleString('da-DK')}</b><span className="small muted">billeder</span></div>
          <div className="card"><b>{visits.length.toLocaleString('da-DK')}</b><span className="small muted">ophold</span></div>
          <div className="card"><b>{tripCount.toLocaleString('da-DK')}</b><span className="small muted">rejser</span></div>
        </div>
      )}

      <section className="card stack-sm" style={{ background: 'var(--accent-soft)', boxShadow: 'none' }}>
        <strong>{photos.length ? 'Hent nye billeder' : 'Hent dine billeder'}</strong>
        {!photos.length && <span className="small">Åbner hjælpe-appen "Dagbog Billeder", som sender dato, sted og op til 5 billeder pr. dag hertil.</span>}
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

      {imp.lines.length > 0 && (imp.busy || imp.error) && (
        <section className="card stack-sm">
          <h3>{imp.busy ? 'Indlæser' : imp.error ? 'Det gik galt' : 'Seneste hentning'}</h3>
          <pre className="tiny" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace' }}>{imp.lines.join('\n')}</pre>
          <button className="btn small" onClick={async () => { try { await navigator.clipboard.writeText(imp.lines.join('\n')); setCopied(true); } catch { /* vælg teksten selv */ } }}>
            {copied ? '✓ Kopieret' : 'Kopiér til Claude'}
          </button>
        </section>
      )}


      {hidden.length > 0 && (
        <details className="card more-fold">
          <summary><strong>Fjernede billeder · {hidden.length}</strong></summary>
          <div className="hidden-grid">
            {hidden.slice(0, 60).map((id) => (
              <span key={id} className="hidden-item">
                <PhotoImg id={id} className="hidden-img" alt="" />
                <button className="btn small" onClick={() => { const m = setHidden(data.phonePhotos, id, false); if (m) void store.put('phonePhotos', m.id, m); }}>Læg tilbage</button>
              </span>
            ))}
          </div>
        </details>
      )}

      <details className="card more-fold">
        <summary><strong>Flere måder at hente</strong></summary>
        <div className="stack" style={{ gap: 14, marginTop: 12 }}>
          <section className="card stack-sm">
            <strong>Fra en gammel telefon eller Google Fotos</strong>
            <span className="small">Filer fra "Dagbog Billeder" ("Gem på Drev" eller "Hent fra Google Takeout"). Vælg dem alle på én gang.</span>
            <button className="btn block" disabled={imp.busy} onClick={() => oldInput.current?.click()}>Vælg filer</button>
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
          {imp.lines.length > 0 && !imp.busy && !imp.error && (
            <section className="card stack-sm">
              <h3>{imp.busy ? 'Indlæser' : imp.error ? 'Det gik galt' : 'Seneste hentning'}</h3>
              <pre className="tiny" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'monospace' }}>{imp.lines.join('\n')}</pre>
              <button className="btn small" onClick={async () => { try { await navigator.clipboard.writeText(imp.lines.join('\n')); setCopied(true); } catch { /* vælg teksten selv */ } }}>
                {copied ? '✓ Kopieret' : 'Kopiér til Claude'}
              </button>
            </section>
          )}
        </div>
      </details>

      {tripCount > 0 && <button className="card tappable link-card" onClick={() => go('husk/rejser')}><strong>Se rejserne under Husk</strong><span aria-hidden="true">›</span></button>}

      <p className="tiny muted">Bynavne: GeoNames (CC BY 4.0), regnet på telefonen.</p>
    </div>
  );
}
