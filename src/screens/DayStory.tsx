// "Dagens historie" på en dag: Claudes 1–2 sætninger ud fra billeder, steder og kalender, med
// "Hvem var med?" (personer fra Mennesker), "Ret" og "Skriv igen". Den korte udgave (`compact`)
// bruges på Skriv og på rejsens dage og åbner dagen under Husk ved tryk.
import { useState } from 'react';
import { saveStory, tellDay } from '../lib/dayStory';
import { AIError } from '../lib/ai';
import { aiReady } from '../lib/generate';
import { dayThumbs } from '../lib/places';
import { useStore } from '../lib/store';
import { go } from '../ui';

export function DayStoryCard({ date, compact = false }: { date: string; compact?: boolean }) {
  const store = useStore();
  const { data } = store;
  const story = data.stories[date];
  const thumbs = dayThumbs(data.phonePhotos, date);
  const [editing, setEditing] = useState<string | null>(null);
  const [picking, setPicking] = useState<string[] | null>(null);
  const [me, setMe] = useState(true); // "Mig selv" i valget af hvem der var med
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canAI = aiReady(data);
  const names = (story?.with ?? []).map((id) => data.people[id]?.name).filter(Boolean) as string[];

  if (compact) {
    if (!story?.text) return null;
    return (
      <button className="story-line" onClick={() => go(`husk/dag/${date}`)}>
        <span className="overline">✦ Dagens historie</span>
        <span className="story-text small">{story.text}{names.length ? ` · med ${names.join(', ')}` : ''}</span>
      </button>
    );
  }
  if (!thumbs.length && !story?.text) return null;

  const run = async (withIds?: string[], notMe?: boolean) => {
    setBusy(true);
    setError('');
    try {
      await tellDay(store, date, withIds, notMe);
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    } finally {
      setBusy(false);
    }
  };
  const savePeople = async (ids: string[], withMe: boolean) => {
    setPicking(null);
    await saveStory(store, date, { with: ids, notMe: withMe ? undefined : true });
    // Navnene kommer med i historien, medmindre ejeren selv har rettet den
    if (story?.text && !story.edited && canAI && thumbs.length) await run(ids, !withMe);
  };
  const people = Object.values(data.people).sort((a, b) => a.name.localeCompare(b.name, 'da'));

  return (
    <section className="story-card" aria-label="Dagens historie">
      <span className="overline">✦ Dagens historie</span>
      {editing !== null ? (
        <>
          <textarea className="story-edit" rows={3} value={editing} onChange={(e) => setEditing(e.target.value)} aria-label="Dagens historie" autoFocus />
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn ghost small" onClick={() => setEditing(null)}>Annullér</button>
            <button className="btn primary small" onClick={async () => { await saveStory(store, date, { text: editing.trim(), edited: true }); setEditing(null); }}>Gem</button>
          </div>
        </>
      ) : story?.text ? (
        <p className="story-text">{busy ? 'Claude skriver …' : story.text}</p>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>{busy ? 'Claude skriver …' : 'Claude kan skrive et par linjer om dagen ud fra billederne og stederne.'}</p>
      )}

      {picking === null && (
        <div className="row wrap" style={{ gap: 6, alignItems: 'center' }}>
          {story?.notMe && <span className="label-chip">Uden mig</span>}
          {names.map((n) => <span key={n} className="label-chip">{n}</span>)}
          <button className="link small" onClick={() => { setPicking(story?.with ?? []); setMe(!story?.notMe); }}>{names.length || story?.notMe ? 'Ret hvem' : '+ Hvem var med?'}</button>
        </div>
      )}
      {picking !== null && (
        <div className="story-people">
          <label className="check-line">
            <input type="checkbox" checked={me} onChange={() => setMe(!me)} />
            <span>Mig selv</span>
          </label>
          {people.length === 0 && <span className="small muted">Tilføj mennesker under Husk → Mennesker først.</span>}
          {people.map((p) => (
            <label key={p.id} className="check-line">
              <input type="checkbox" checked={picking.includes(p.id)} onChange={() => setPicking(picking.includes(p.id) ? picking.filter((x) => x !== p.id) : [...picking, p.id])} />
              <span>{p.name}</span>
            </label>
          ))}
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn ghost small" onClick={() => setPicking(null)}>Annullér</button>
            <button className="btn primary small" onClick={() => void savePeople(picking, me)}>Gem</button>
          </div>
        </div>
      )}

      {editing === null && picking === null && (
        <div className="row between" style={{ alignItems: 'center', gap: 8 }}>
          <span className="tiny muted">
            {story?.text ? (story.edited ? 'Rettet af dig' : `Ud fra ${story.photos ?? thumbs.length} billeder og Tidslinjen`) : ''}
          </span>
          <div className="row" style={{ gap: 4 }}>
            {story?.text && <button className="btn ghost small" onClick={() => setEditing(story.text)}>Ret</button>}
            {canAI && thumbs.length > 0 && (
              <button className={`btn small ${story?.text ? 'ghost' : 'primary'}`} disabled={busy} onClick={() => void run()}>
                {story?.text ? 'Skriv igen' : 'Fortæl dagen'}
              </button>
            )}
          </div>
        </div>
      )}
      {error && <span className="small error">{error}</span>}
    </section>
  );
}
