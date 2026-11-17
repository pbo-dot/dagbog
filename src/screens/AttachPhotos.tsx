// Billeder ved en aftale eller et huskepunkt: tag et billede eller vælg fra telefonen. Billederne
// formindskes og gemmes krypteret i billedlageret som noternes billeder (og kommer med i kopien).
import { useRef, useState } from 'react';
import { compressImage } from '../lib/photos';
import { useStore } from '../lib/store';
import { today } from '../lib/dates';
import { PhotoImg, PhotoViewer, uid } from '../ui';

/** Små billeder i en række; tryk åbner fuld skærm. Bruges også, hvor man ikke kan rette. */
export function AttachedPhotos({ ids }: { ids?: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!ids?.length) return null;
  return (
    <div className="attach-row">
      {ids.map((id) => <PhotoImg key={id} id={id} className="attach-img" onClick={() => setOpen(id)} alt="Vedhæftet billede" />)}
      {open && <PhotoViewer id={open} ids={ids} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Tilføj og fjern billeder i en formular. Fjernede billeder slettes først ved Gem (`dropPhotos`). */
export function AttachPhotos({ ids, onChange }: { ids: string[]; onChange: (ids: string[]) => void }) {
  const store = useStore();
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);

  const add = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    try {
      const added: string[] = [];
      for (const f of files.slice(0, 6)) {
        const img = await compressImage(f);
        const id = uid();
        await store.putPhoto({ id, date: today(), createdAt: Date.now(), ...img });
        added.push(id);
      }
      onChange([...ids, ...added]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack-sm">
      {ids.length > 0 && (
        <div className="attach-row">
          {ids.map((id) => (
            <span key={id} className="attach-item">
              <PhotoImg id={id} className="attach-img" onClick={() => setOpen(id)} alt="Vedhæftet billede" />
              <button type="button" className="attach-remove" aria-label="Fjern billedet" onClick={() => onChange(ids.filter((x) => x !== id))}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn small" disabled={busy} onClick={() => camera.current?.click()}>📷 Tag billede</button>
        <button type="button" className="btn small" disabled={busy} onClick={() => gallery.current?.click()}>🖼 Vælg billede</button>
        {busy && <span className="small muted">Gemmer …</span>}
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void add(fs); }} />
      <input ref={gallery} type="file" accept="image/*" multiple hidden onChange={(e) => { const fs = [...(e.target.files ?? [])]; e.target.value = ''; void add(fs); }} />
      {open && <PhotoViewer id={open} ids={ids} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Sletter billeder fra billedlageret: dem, der er fjernet ved Gem, eller nye, når der trykkes Fortryd. */
export function dropPhotos(store: ReturnType<typeof useStore>, ids: string[] | undefined, keep: string[] = []): void {
  for (const id of ids ?? []) if (!keep.includes(id)) void store.removePhoto(id);
}
