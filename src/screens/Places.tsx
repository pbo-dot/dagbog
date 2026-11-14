// "Billeder og steder" (under Mere): hjælpe-appen "Dagbog Billeder" sender dato og sted for
// kamera-billederne, og Dagbog viser, hvor du har været. Selve billederne bliver på telefonen.
import { useState } from 'react';
import { formatMonth, toISO } from '../lib/dates';
import { countryName, OPEN_APP_URL } from '../lib/places';
import { useImportState } from '../lib/placesImport';
import { useStore } from '../lib/store';
import { go, Header } from '../ui';

export function PlacesScreen() {
  const { data } = useStore();
  const imp = useImportState();
  const [copied, setCopied] = useState(false);
  const months = Object.values(data.phonePhotos).sort((a, b) => b.id.localeCompare(a.id));
  const photos = months.flatMap((m) => m.photos);
  const days = new Set(photos.map((p) => toISO(new Date(p.t)))).size;
  const placed = photos.filter((p) => p.city).length;
  const last = Math.max(0, ...months.map((m) => m.importedAt));
  // Hjemlandet er det land, der har flest billeder; andre lande nævnes ved måneden
  const counts = new Map<string, number>();
  for (const p of photos) if (p.cc) counts.set(p.cc, (counts.get(p.cc) ?? 0) + 1);
  const home = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

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
        {last > 0 && <span className="small muted">Sidst hentet {new Date(last).toLocaleString('da-DK', { dateStyle: 'medium', timeStyle: 'short' })}</span>}
        <button className="btn primary block" disabled={imp.busy} onClick={() => { location.href = OPEN_APP_URL; }}>
          {imp.busy ? 'Indlæser …' : 'Hent billeder'}
        </button>
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

      {months.length > 0 && (
        <section className="stack-sm">
          <h3>Steder pr. måned</h3>
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
