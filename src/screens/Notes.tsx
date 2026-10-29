import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatShort, toISO, today } from '../lib/dates';
import { speechInputAvailable, startDictation } from '../lib/device';
import { compressImage } from '../lib/photos';
import { useStore } from '../lib/store';
import type { Note } from '../lib/types';
import { DoubleConfirm, go, Header, Icon, PhotoGallery, PhotoImg, uid } from '../ui';

type Store = ReturnType<typeof useStore>;

/** Linjer med "- [ ]" / "- [x]" er afkrydsning. */
const CHECK = /^\s*[-*] \[( |x|X)\] (.*)$/;

/** Farver som i Keep. Nøglen gemmes på noten, farven følger lys/mørk tilstand. */
const NOTE_COLORS: Array<{ id: string; label: string }> = [
  { id: '', label: 'Ingen farve' },
  { id: 'gul', label: 'Gul' },
  { id: 'groen', label: 'Grøn' },
  { id: 'blaa', label: 'Blå' },
  { id: 'roed', label: 'Rød' },
  { id: 'lilla', label: 'Lilla' },
];

const colorClass = (n: Pick<Note, 'color'>) => (n.color ? ` nc-${n.color}` : '');

/** Gammel note fra Keep med 📌 som ikon er fastgjort. */
const isPinned = (n: Note) => n.pinned ?? n.icon === '📌';

/** Alle etiketter med antal, flest noter først. */
function labelCounts(notes: Note[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const n of notes) for (const l of n.labels ?? []) m.set(l, (m.get(l) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'da'));
}

const host = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
};

/** Tekst til kortet: afkrydsning for sig, resten for sig. */
function split(text: string) {
  const lines = text.split('\n');
  const checks = lines.map((l) => l.match(CHECK)).filter((m): m is RegExpMatchArray => !!m).map((m) => ({ done: m[1] !== ' ', text: m[2] }));
  const rest = lines.filter((l) => !CHECK.test(l)).map((l) => l.replace(/^#+\s*/, '')).join('\n').trim();
  return { checks, rest };
}

/** Et kort i gitteret, som i Keep. */
function NoteCard({ n }: { n: Note }) {
  const { checks, rest } = split(n.text);
  const done = checks.filter((c) => c.done).length;
  const labels = n.labels ?? [];
  return (
    <button className={`note-card${colorClass(n)}`} onClick={() => go(`noter/${n.id}`)}>
      {n.photos?.[0] && <PhotoImg id={n.photos[0]} className="note-card-img" />}
      <strong className="note-card-title">{n.title}</strong>
      {rest && <span className="note-card-text">{rest}</span>}
      {checks.length > 0 && (
        <span className="note-card-checks">
          {checks.slice(0, 4).map((c, i) => <span key={i} className={c.done ? 'done' : ''}>{c.done ? '☑' : '☐'} {c.text}</span>)}
          {checks.length > 4 && <span className="muted">+ {checks.length - 4} mere</span>}
          <span className="note-card-bar"><i style={{ width: `${(done / checks.length) * 100}%` }} /></span>
        </span>
      )}
      {!rest && !checks.length && n.links?.[0] && <span className="note-card-text">🔗 {n.links[0].title}</span>}
      {labels.length > 0 && (
        <span className="label-row">
          {labels.slice(0, 2).map((l) => <span key={l} className="label">{l}</span>)}
          {labels.length > 2 && <span className="label">+{labels.length - 2}</span>}
        </span>
      )}
    </button>
  );
}

const FILTER_KEY = 'dagbog-note-filter';
const FROM_KEEP = '\u0000keep';
const NO_LABEL = '\u0000none';

/** Fanen Noter: kort i to spalter, fastgjorte øverst, filter på etiket. */
export function NotesScreen() {
  const store = useStore();
  const { notes } = store.data;
  const [q, setQ] = useState('');
  const [searching, setSearching] = useState(false);
  const [filter, setFilterState] = useState<string>(() => {
    try { return sessionStorage.getItem(FILTER_KEY) ?? ''; } catch { return ''; }
  });
  const setFilter = (f: string) => {
    setFilterState(f);
    try { sessionStorage.setItem(FILTER_KEY, f); } catch { /* ingen lagring */ }
  };
  const all = Object.values(notes);
  const counts = labelCounts(all);
  const hasKeep = all.some((n) => n.keep);
  const term = q.trim().toLowerCase();
  const list = all
    .filter((n) => !filter || (filter === FROM_KEEP ? !!n.keep : filter === NO_LABEL ? !n.labels?.length : n.labels?.includes(filter)))
    .filter((n) => !term || `${n.title}\n${n.text}\n${(n.labels ?? []).join(' ')}\n${(n.links ?? []).map((l) => l.title).join(' ')}`.toLowerCase().includes(term))
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const pinned = list.filter(isPinned);
  const others = list.filter((n) => !isPinned(n));

  const addPhotoNote = async (file: File) => {
    const id = await savePhoto(store, file);
    const n: Note = { ...blankNote(), title: 'Billede', photos: [id] };
    await store.put('notes', n.id, n);
    go(`noter/${n.id}`);
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="header">
        <h1>Noter</h1>
        <button className={`icon-btn${searching ? ' on' : ''}`} onClick={() => { setSearching(!searching); setQ(''); }} aria-label="Søg i noter">
          <span style={{ width: 22, height: 22, display: 'inline-flex' }}>{Icon.search}</span>
        </button>
      </div>
      {searching && <input type="search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søg i noter" aria-label="Søg i noter" />}
      <div className="quick-note">
        <button className="grow quick-note-text" onClick={() => go('noter/ny')}>Skriv en note …</button>
        <button className="quick-ico" onClick={() => go('noter/ny/liste')} aria-label="Ny liste">☑</button>
        <label className="quick-ico" aria-label="Ny note med billede">🖼
          <input type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) addPhotoNote(f); }} />
        </label>
        {speechInputAvailable() && (
          <button className="quick-ico" onClick={() => go('noter/ny/tale')} aria-label="Indtal en note">
            <span style={{ width: 18, height: 18, display: 'inline-flex' }}>{Icon.mic}</span>
          </button>
        )}
      </div>
      {all.length > 0 && (
        <label className="chip-select note-filter">
          <span className="note-filter-ico" aria-hidden="true">🏷</span>
          <span className="sr-only">Etiket</span>
          <select value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Vis noter med etiket">
            <option value="">Alle etiketter ({all.length})</option>
            {hasKeep && <option value={FROM_KEEP}>Fra Google Keep</option>}
            <option value={NO_LABEL}>Uden etiket</option>
            {counts.length > 0
              ? <optgroup label="Etiketter">{counts.map(([l, c]) => <option key={l} value={l}>{l} ({c})</option>)}</optgroup>
              : <option disabled>Ingen etiketter endnu</option>}
          </select>
        </label>
      )}
      {all.length === 0 && <p className="small muted">Faste oplysninger uden dato, fx koder, lister og gode råd.</p>}
      {pinned.length > 0 && (
        <section className="stack-sm">
          <h3>Fastgjort</h3>
          <div className="note-grid">{pinned.map((n) => <NoteCard key={n.id} n={n} />)}</div>
        </section>
      )}
      {others.length > 0 && (
        <section className="stack-sm">
          {pinned.length > 0 && <h3>Andre</h3>}
          <div className="note-grid">{others.map((n) => <NoteCard key={n.id} n={n} />)}</div>
        </section>
      )}
      {(term || filter) && list.length === 0 && <p className="small muted">Ingen noter her.</p>}
      <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => go('noter/keep')}>Hent fra Google Keep</button>
    </div>
  );
}

const blankNote = (): Note => ({ id: uid(), title: '', icon: '🗒️', text: '', createdAt: Date.now(), updatedAt: Date.now() });

/** Gemmer et billede (formindsket og låst) og giver dets id. */
async function savePhoto(store: Store, file: Blob): Promise<string> {
  const img = await compressImage(file);
  const id = uid();
  await store.putPhoto({ id, date: today(), createdAt: Date.now(), ...img });
  return id;
}

/** Vælg etiketter: tryk på en eksisterende, eller skriv en ny. */
function LabelPicker({ value, all, onChange }: { value: string[]; all: string[]; onChange: (labels: string[]) => void }) {
  const [text, setText] = useState('');
  const [showAll, setShowAll] = useState(false);
  const add = () => {
    const l = text.trim();
    if (l && !value.includes(l)) onChange([...value, l]);
    setText('');
  };
  const matching = all.filter((l) => !value.includes(l) && (!text.trim() || l.toLowerCase().includes(text.trim().toLowerCase())));
  const shown = showAll || text.trim() ? matching : matching.slice(0, 8);
  return (
    <div className="stack-sm">
      {value.length > 0 && (
        <div className="chips">
          {value.map((l) => <button key={l} type="button" className="chip on" onClick={() => onChange(value.filter((x) => x !== l))} aria-label={`Fjern ${l}`}>{l} ✕</button>)}
        </div>
      )}
      <div className="row">
        <input type="text" className="grow" value={text} placeholder="Søg eller skriv en ny etiket" onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} aria-label="Etiket" />
        <button type="button" className="btn small" disabled={!text.trim()} onClick={add}>Tilføj</button>
      </div>
      {shown.length > 0 && (
        <div className="chips">
          {shown.map((l) => <button key={l} type="button" className="chip" onClick={() => { onChange([...value, l]); setText(''); }}>{l}</button>)}
          {!showAll && !text.trim() && matching.length > shown.length && <button type="button" className="chip" onClick={() => setShowAll(true)}>+ {matching.length - shown.length} flere</button>}
        </div>
      )}
    </div>
  );
}

/** Værktøjslinjen i en note: liste, billede, farve, etiket, fastgør. Gemmer med det samme. */
function Toolbar({ note, save, onList }: { note: Note; save: (patch: Partial<Note>) => void; onList?: () => void }) {
  const store = useStore();
  const [panel, setPanel] = useState<'' | 'farve' | 'etiket'>('');
  const tool = (label: string, content: ReactNode, onClick: () => void, on = false) => (
    <button type="button" className={`tool${on ? ' on' : ''}`} onClick={onClick} aria-label={label} aria-pressed={on}>{content}</button>
  );
  return (
    <div className="note-tools">
      {panel === 'farve' && (
        <div className="swatches" role="group" aria-label="Farve">
          {NOTE_COLORS.map((c) => (
            <button key={c.id} type="button" className={`swatch${c.id ? ` nc-${c.id}` : ''}${(note.color ?? '') === c.id ? ' on' : ''}`} aria-label={c.label}
              onClick={() => save({ color: c.id || undefined })} />
          ))}
        </div>
      )}
      {panel === 'etiket' && (
        <LabelPicker value={note.labels ?? []} all={labelCounts(Object.values(store.data.notes)).map(([l]) => l)}
          onChange={(labels) => save({ labels: labels.length ? labels : undefined })} />
      )}
      <div className="tool-row">
        {onList && tool('Tilføj afkrydsning', '☑', onList)}
        <label className="tool" aria-label="Tilføj billede">🖼
          <input type="file" accept="image/*" hidden onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) save({ photos: [...(note.photos ?? []), await savePhoto(store, f)] });
          }} />
        </label>
        {tool('Farve', '🎨', () => setPanel(panel === 'farve' ? '' : 'farve'), panel === 'farve')}
        {tool('Etiketter', '🏷', () => setPanel(panel === 'etiket' ? '' : 'etiket'), panel === 'etiket')}
        {tool(isPinned(note) ? 'Løsn' : 'Fastgør', '📌', () => save({ pinned: !isPinned(note), icon: note.icon === '📌' ? '🗒️' : note.icon }), isPinned(note))}
      </div>
    </div>
  );
}

/** Ny note eller ret tekst. Gemmer af sig selv, mens der skrives. */
function NoteEditor({ start, mode, onDone }: { start: Note; mode?: string; onDone?: () => void }) {
  const store = useStore();
  const [note, setNote] = useState<Note>(start);
  const saved = useRef(!!store.data.notes[start.id]);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const latest = useRef(note);
  const [listening, setListening] = useState(false);
  const stopMic = useRef<(() => void) | null>(null);
  const text = useRef<HTMLTextAreaElement>(null);

  const flush = async () => {
    clearTimeout(timer.current);
    const n = latest.current;
    const title = n.title.trim() || n.text.split('\n').find((l) => l.trim())?.replace(CHECK, '$2').trim().slice(0, 40) || '';
    if (!title && !n.photos?.length) return false;
    await store.put('notes', n.id, { ...n, title: title || 'Note', updatedAt: Date.now() });
    saved.current = true;
    return true;
  };
  const change = (patch: Partial<Note>, now = false) => {
    const n = { ...latest.current, ...patch };
    latest.current = n;
    setNote(n);
    clearTimeout(timer.current);
    if (now) flush();
    else timer.current = setTimeout(flush, 600);
  };
  const done = async () => {
    stopMic.current?.();
    const ok = (await flush()) || saved.current;
    if (onDone) onDone();
    else go(ok ? `noter/${note.id}` : 'noter');
  };
  // Gem, hvis man forlader siden midt i en tekst
  useEffect(() => () => { stopMic.current?.(); void flush(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleMic = () => {
    if (listening) return stopMic.current?.();
    setListening(true);
    const base = latest.current.text && !/\s$/.test(latest.current.text) ? `${latest.current.text} ` : latest.current.text;
    stopMic.current = startDictation(
      (final, interim) => change({ text: base + [final, interim].filter(Boolean).join(' ') }),
      () => { setListening(false); stopMic.current = null; },
    );
  };
  useEffect(() => {
    if (mode === 'tale') toggleMic();
    if (mode === 'liste') text.current?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const addCheck = () => {
    const t = latest.current.text;
    change({ text: `${t}${t && !t.endsWith('\n') ? '\n' : ''}- [ ] ` });
    setTimeout(() => { const el = text.current; if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Header back="noter" right={<button className="btn primary small" onClick={done}>Færdig</button>} />
      <div className={`note-edit${colorClass(note)}`}>
        <input type="text" className="note-edit-title" value={note.title} placeholder="Titel" onChange={(e) => change({ title: e.target.value })} aria-label="Titel" autoFocus={!mode && !store.data.notes[start.id]} />
        <textarea ref={text} rows={10} value={note.text} placeholder="Skriv her …" onChange={(e) => change({ text: e.target.value })} aria-label="Tekst" />
        {speechInputAvailable() && (
          <button type="button" className={`icon-btn mic ${listening ? 'on' : ''}`} onClick={toggleMic} aria-label={listening ? 'Stop' : 'Indtal'} style={{ alignSelf: 'flex-end' }}>
            <span style={{ width: 22, height: 22, display: 'inline-flex' }}>{listening ? Icon.stop : Icon.mic}</span>
          </button>
        )}
      </div>
      {note.photos && note.photos.length > 0 && <PhotoGallery ids={note.photos} />}
      <Toolbar note={note} save={(p) => change(p, true)} onList={addCheck} />
      <p className="tiny muted">Gemmes af sig selv. En linje, der starter med "- [ ] ", bliver til en afkrydsning.</p>
    </div>
  );
}

/** Én note: læsevisning med afkrydsning og værktøjslinje, eller redigering. */
export function NoteScreen({ id, mode }: { id: string; mode?: string }) {
  const store = useStore();
  const isNew = id === 'ny';
  const existing = store.data.notes[id];
  const [editing, setEditing] = useState(false);
  const [fresh] = useState(() => ({ ...blankNote(), text: mode === 'liste' ? '- [ ] ' : '' }));

  if (isNew) return <NoteEditor start={fresh} mode={mode} />;
  if (!existing) return <div className="stack"><Header back="noter" /><p className="muted">Ikke fundet.</p></div>;
  if (editing) return <NoteEditor start={existing} onDone={() => setEditing(false)} />;

  const n = existing;
  const save = (patch: Partial<Note>) => store.put('notes', n.id, { ...n, ...patch, updatedAt: Date.now() });
  const lines = n.text.split('\n');
  const hasChecks = lines.some((l) => CHECK.test(l));
  const toggle = (i: number) => {
    const next = lines.map((l, j) => (j === i ? l.replace(/\[( |x|X)\]/, (_m, c: string) => (c === ' ' ? '[x]' : '[ ]')) : l));
    save({ text: next.join('\n') });
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <Header back="noter" right={<button className="btn small" onClick={() => setEditing(true)}>Ret</button>} />
      <h1>{n.icon && n.icon !== '📌' && n.icon !== '🗒️' ? `${n.icon} ` : ''}{n.title}</h1>
      {n.keep && <p className="tiny muted" style={{ marginTop: -8 }}>Fra Google Keep · {formatShort(toISO(new Date(n.keep.edited)))}</p>}
      {n.text.trim() && (
        <div className={`card note-body${colorClass(n)}`}>
          {lines.map((l, i) => {
            const m = l.match(CHECK);
            if (m) {
              return (
                <label key={i} className="check-line">
                  <input type="checkbox" checked={m[1] !== ' '} onChange={() => toggle(i)} />
                  <span style={m[1] !== ' ' ? { textDecoration: 'line-through', color: 'var(--muted)' } : undefined}>{m[2]}</span>
                </label>
              );
            }
            const h = l.match(/^#+\s*(.*)$/);
            if (h) return <h3 key={i} style={{ marginTop: i ? 12 : 0 }}>{h[1]}</h3>;
            return l.trim() ? <p key={i}>{l}</p> : <div key={i} style={{ height: 8 }} />;
          })}
        </div>
      )}
      {hasChecks && <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={() => save({ text: n.text.replace(/\[(x|X)\]/g, '[ ]') })}>Nulstil afkrydsning</button>}
      {n.photos && n.photos.length > 0 && <PhotoGallery ids={n.photos} />}
      {n.links?.map((l) => (
        <a key={l.url} className="web-src" href={l.url} target="_blank" rel="noopener noreferrer">
          <span className="ico">🔗</span>
          <span className="grow"><strong>{l.title}</strong><span className="tiny muted" style={{ display: 'block' }}>{host(l.url)}</span></span>
        </a>
      ))}
      {n.labels && n.labels.length > 0 && <span className="label-row">{n.labels.map((l) => <span key={l} className="label">{l}</span>)}</span>}
      <Toolbar note={n} save={save} />
      <DoubleConfirm label="Slet note" first={`Slet "${n.title}"?`} second="Er du helt sikker?"
        onConfirm={async () => {
          for (const p of n.photos ?? []) await store.removePhoto(p);
          await store.remove('notes', n.id);
          go('noter');
        }} />
    </div>
  );
}
