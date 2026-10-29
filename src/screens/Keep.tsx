import { useMemo, useRef, useState } from 'react';
import { toISO } from '../lib/dates';
import { chosen, extractImages, labelCounts, scanKeep, toNote, type KeepScan } from '../lib/keep';
import { compressImage } from '../lib/photos';
import { useStore } from '../lib/store';
import type { Note } from '../lib/types';
import { go, Header, uid } from '../ui';

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 1e6)).toLocaleString('da-DK')} MB`;

/** Hent noter fra Google Keep via en zip-fil fra Google Takeout. */
export function KeepImportScreen() {
  const store = useStore();
  const zip = useRef<Uint8Array | null>(null);
  const [scan, setScan] = useState<KeepScan | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [labels, setLabels] = useState<Set<string>>(new Set());
  const [withPhotos, setWithPhotos] = useState(true);
  const [archived, setArchived] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [done, setDone] = useState<{ added: number; updated: number; photos: number } | null>(null);

  const counts = useMemo(() => (scan ? labelCounts(scan.notes) : []), [scan]);
  const picked = scan ? scan.notes.filter((n) => chosen(n, labels, archived)) : [];
  const photoCount = picked.reduce((a, n) => a + n.images.length, 0);

  const open = async (file: File) => {
    setError('');
    setBusy('Læser filen …');
    try {
      const data = new Uint8Array(await file.arrayBuffer());
      const s = await scanKeep(data);
      zip.current = data;
      setScan(s);
      setLabels(new Set(labelCounts(s.notes).map((c) => c.label)));
    } catch (e) {
      setError(e instanceof Error && e.message.includes('Keep') ? e.message : 'Filen kunne ikke læses. Vælg zip-filen fra Google Takeout.');
    } finally {
      setBusy('');
    }
  };

  const importAll = async () => {
    if (!scan || !zip.current) return;
    setError('');
    const byKeep = new Map(Object.values(store.data.notes).filter((n) => n.keep).map((n) => [n.keep!.id, n]));
    const todo = picked.filter((k) => {
      const old = byKeep.get(k.id);
      return !old?.keep || old.keep.edited < k.edited;
    });
    let added = 0;
    let updated = 0;
    let photos = 0;
    try {
      let files: Record<string, Uint8Array> = {};
      if (withPhotos) {
        const wanted = new Set(todo.flatMap((k) => k.images));
        if (wanted.size) {
          setBusy('Henter billederne ud …');
          files = await extractImages(zip.current, wanted);
        }
      }
      for (let i = 0; i < todo.length; i++) {
        const k = todo[i];
        if (i % 10 === 0) setBusy(`Indlæser ${i + 1} af ${todo.length} …`);
        const old = byKeep.get(k.id);
        const ids: string[] = [];
        for (const path of withPhotos ? k.images : []) {
          const bytes = files[path];
          if (!bytes) continue;
          try {
            const img = await compressImage(new Blob([bytes as BlobPart]));
            const id = uid();
            await store.putPhoto({ id, date: toISO(new Date(k.created)), createdAt: k.created, ...img });
            ids.push(id);
          } catch {
            // fx HEIC, som browseren ikke kan læse: noten kommer med uden billedet
          }
        }
        const note = toNote(k, old, ids, old?.id ?? uid());
        if (!note) continue;
        // Nye billeder erstatter de gamle
        if (ids.length && old?.photos) for (const p of old.photos) await store.removePhoto(p);
        await store.put('notes', note.id, note as Note);
        if (old) updated++;
        else added++;
        photos += ids.length;
      }
      setDone({ added, updated, photos });
    } catch {
      setError('Noget gik galt under indlæsningen. Det, der nåede at blive indlæst, er gemt.');
    } finally {
      setBusy('');
      zip.current = null;
    }
  };

  if (done) {
    return (
      <div className="stack" style={{ gap: 20 }}>
        <Header back="noter" />
        <h1>Hentet fra Keep</h1>
        {done.added + done.updated === 0 ? <p>Alt var allerede hentet.</p> : <p>{done.added} {done.added === 1 ? 'ny note' : 'nye noter'}{done.updated ? `, ${done.updated} opdateret` : ''}{done.photos ? ` og ${done.photos} ${done.photos === 1 ? 'billede' : 'billeder'}` : ''}.</p>}
        
        <button className="btn primary block" onClick={() => go('noter')}>Se noterne</button>
      </div>
    );
  }

  if (scan) {
    const shown = showAll ? counts : counts.slice(0, 6);
    const toggle = (l: string) => setLabels((s) => {
      const n = new Set(s);
      if (n.has(l)) n.delete(l);
      else n.add(l);
      return n;
    });
    return (
      <div className="stack" style={{ gap: 18 }}>
        <Header back="noter" />
        <h1>Fundet i Keep</h1>
        <div className="keep-stats">
          <span><b>{scan.notes.length}</b>noter</span>
          <span><b>{counts.filter((c) => c.label).length}</b>etiketter</span>
          <span><b>{scan.notes.reduce((a, n) => a + n.images.length, 0)}</b>billeder</span>
        </div>
        <section className="stack-sm">
          <div className="row between">
            <h3>Etiketter</h3>
            <button className="btn ghost small" onClick={() => setLabels(labels.size ? new Set() : new Set(counts.map((c) => c.label)))}>{labels.size ? 'Ingen' : 'Alle'}</button>
          </div>
          <div className="card todo-list">
            {shown.map((c) => (
              <label key={c.label} className="keep-row">
                <input type="checkbox" checked={labels.has(c.label)} onChange={() => toggle(c.label)} />
                <span className="grow">{c.label || <em>Uden etiket</em>}</span>
                <span className="small muted">{c.count}</span>
              </label>
            ))}
            {counts.length > shown.length && <button className="today-later" onClick={() => setShowAll(true)}>+ {counts.length - shown.length} flere …</button>}
          </div>
        </section>
        <div className="card todo-list">
          <label className="keep-row">
            <input type="checkbox" checked={withPhotos} onChange={(e) => setWithPhotos(e.target.checked)} />
            <span className="grow">Billeder med{scan.imageBytes ? ` (ca. ${mb(scan.imageBytes)} før formindskning)` : ''}</span>
          </label>
          <label className="keep-row">
            <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />
            <span className="grow">Arkiverede noter med</span>
          </label>
        </div>
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" disabled={!picked.length || !!busy} onClick={importAll}>
          {busy ? <><span className="spinner" /> {busy}</> : `Indlæs ${picked.length} ${picked.length === 1 ? 'note' : 'noter'}${withPhotos && photoCount ? ` og ${photoCount} ${photoCount === 1 ? 'billede' : 'billeder'}` : ''}`}
        </button>
        <p className="tiny muted">Noterne i Keep røres ikke. Noter, der allerede er hentet, kommer ikke med to gange.</p>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header back="noter" />
      <h1>Hent fra Google Keep</h1>
      <ol className="keep-steps">
        <li>Åbn <strong>takeout.google.com</strong>, fravælg alt, vælg kun <strong>Keep</strong>, og tryk Eksportér.</li>
        <li>Google sender en mail med en zip-fil. Hent den til telefonen.</li>
        <li>Vælg filen her.</li>
      </ol>
      <label className={`btn primary block${busy ? ' disabled' : ''}`}>
        {busy ? <><span className="spinner" /> {busy}</> : 'Vælg zip-filen'}
        <input type="file" accept=".zip,application/zip" hidden disabled={!!busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) open(f); }} />
      </label>
      <a className="btn block" style={{ textDecoration: 'none' }} href="https://takeout.google.com/settings/takeout/custom/keep" target="_blank" rel="noopener noreferrer">Åbn Google Takeout ↗</a>
      {error && <p className="error">{error}</p>}
      <p className="small muted">Google lader ikke andre apps læse Keep direkte, så noterne kommer over som en kopi. Dine noter i Keep røres ikke.</p>
    </div>
  );
}
