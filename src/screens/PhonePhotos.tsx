// Telefonens billeder for en dag: en række at rulle i (eller et gitter), fuld skærm ved tryk, og
// "Vælg" for at fjerne flere fra Dagbog på én gang. Billedet på telefonen og i Google Fotos røres aldrig.
import { useState } from 'react';
import { setHiddenMany, thumbTime } from '../lib/places';
import { useStore } from '../lib/store';
import { PhotoImg, PhotoViewer } from '../ui';

export function PhonePhotos({ ids, grid = false, small = false }: { ids: string[]; grid?: boolean; small?: boolean }) {
  const store = useStore();
  const { data } = store;
  const [open, setOpen] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  if (!ids.length) return null;
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  const stop = () => { setPicking(false); setChosen([]); setAsking(false); };
  const remove = async () => {
    const months = setHiddenMany(data.phonePhotos, chosen, true);
    await store.putMany('phonePhotos', Object.fromEntries(months.map((m) => [m.id, m])));
    stop();
  };
  return (
    <div className="phone-photos">
      <div className={grid ? 'photo-grid' : 'photo-strip'}>
        {ids.map((id) => {
          const on = chosen.includes(id);
          return (
            <span key={id} className={`strip-item${picking ? ' picking' : ''}${on ? ' chosen' : ''}`}>
              <PhotoImg id={id} className={`${grid ? 'grid-img' : 'strip-img'}${small ? ' small' : ''}`} alt="Billede fra dagen"
                onClick={() => (picking ? toggle(id) : setOpen(id))} />
              {picking
                ? <span className="pick-mark" aria-hidden="true">{on ? '✓' : ''}</span>
                : !small && <span className="strip-time">{thumbTime(data.phonePhotos, id)}</span>}
            </span>
          );
        })}
      </div>
      {!picking && <button className="link small" style={{ alignSelf: 'flex-end' }} onClick={() => setPicking(true)}>Vælg</button>}
      {picking && !asking && (
        <div className="row between pick-bar">
          <button className="btn ghost small" onClick={() => setChosen(chosen.length === ids.length ? [] : [...ids])}>
            {chosen.length === ids.length ? 'Fravælg alle' : 'Vælg alle'}
          </button>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn ghost small" onClick={stop}>Annullér</button>
            <button className="btn danger small" disabled={!chosen.length} onClick={() => setAsking(true)}>Fjern {chosen.length || ''}</button>
          </div>
        </div>
      )}
      {asking && (
        <div className="card pick-confirm">
          <strong>Fjern {chosen.length} {chosen.length === 1 ? 'billede' : 'billeder'} fra Dagbog?</strong>
          <span className="small muted">De bliver på telefonen og i Google Fotos og kan lægges tilbage under Billeder og steder.</span>
          <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
            <button className="btn ghost" onClick={() => setAsking(false)}>Annullér</button>
            <button className="btn danger" onClick={() => void remove()}>Fjern</button>
          </div>
        </div>
      )}
      {open && <PhotoViewer id={open} ids={ids} onClose={() => setOpen(null)} />}
    </div>
  );
}
