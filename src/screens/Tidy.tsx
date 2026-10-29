import { useEffect, useMemo, useRef, useState } from 'react';
import { AIError, TIDY_MODEL, tidyEstimate, tidyNotes, type TidyNote, type TidyOptions } from '../lib/ai';
import { backupNow } from '../lib/backupSync';
import { today } from '../lib/dates';
import { useStore } from '../lib/store';
import type { Note } from '../lib/types';
import { krText } from '../lib/usage';
import { go, Header, Icon, Switch } from '../ui';

interface Session {
  opts: TidyOptions;
  results: TidyNote[] | null;
  checked: number; // så mange noter nåede Claude at læse
  total: number;
  usd: number;
  off: Set<string>; // fravalgte forslag: "slet:<id>" eller "etiket:<id>"
  tab: 'slet' | 'etiket';
  done: { removed: number; labels: number; backup: boolean } | null;
  undo: Note[]; // noterne, som de var før Gem
  removedIds: string[];
}

const fresh = (): Session => ({
  opts: { remove: true, label: true, newLabels: false },
  results: null, checked: 0, total: 0, usd: 0, off: new Set(), tab: 'slet', done: null, undo: [], removedIds: [],
});

// Huskes, mens dagbogen er åben, så man kan læse en note og komme tilbage til forslagene.
let session: Session = fresh();

const isPinned = (n: Note) => n.pinned ?? n.icon === '📌';
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Ryd op i noter: Claude foreslår, hvad der kan slettes, og hvilke etiketter noterne skal have. */
export function TidyScreen() {
  const store = useStore();
  const { data } = store;
  const [s, setS] = useState<Session>(session);
  const update = (patch: Partial<Session>) => setS((old) => (session = { ...old, ...patch }));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const stop = useRef(false);

  const notes = useMemo(() => Object.values(data.notes), [data.notes]);
  const labels = useMemo(() => [...new Set(notes.flatMap((n) => n.labels ?? []))].sort((a, b) => a.localeCompare(b, 'da')), [notes]);
  const unlabeled = notes.filter((n) => !n.labels?.length).length;

  // Billeder til slettede noter fjernes først, når man forlader skærmen (så Fortryd kan lægge dem tilbage).
  useEffect(() => () => {
    if (session.done && session.removedIds.length) {
      const keep = new Set(Object.values(store.data.notes).flatMap((n) => n.photos ?? []));
      for (const n of session.undo) for (const p of n.photos ?? []) if (!keep.has(p)) store.removePhoto(p);
      session = fresh();
    } else if (session.done) session = fresh();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const start = async () => {
    setError('');
    stop.current = false;
    const all = notes;
    setBusy(`Claude læser 0 af ${all.length} …`);
    try {
      const r = await tidyNotes(data.settings, all, labels, s.opts, today(),
        (n) => setBusy(`Claude læser ${n} af ${all.length} …`), () => stop.current);
      // Fastgjorte noter slettes aldrig, og etiketter, noten allerede har, fjernes
      const results = r.results.map((x) => {
        const n = data.notes[x.id];
        const has = new Set(n?.labels ?? []);
        return {
          ...x,
          remove: x.remove && !!n && !isPinned(n),
          addLabels: [...new Set(x.addLabels.map((l) => l.trim()).filter((l) => l && !has.has(l)))].filter((l) => s.opts.newLabels || labels.includes(l)),
        };
      }).filter((x) => x.remove || x.addLabels.length);
      const off = new Set(results.filter((x) => x.remove && !x.sure).map((x) => `slet:${x.id}`));
      update({ results, checked: r.checked, total: all.length, usd: r.usd, off, tab: results.some((x) => x.remove) ? 'slet' : 'etiket' });
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    } finally {
      setBusy('');
    }
  };

  const results = s.results ?? [];
  const removes = results.filter((x) => x.remove && data.notes[x.id]);
  const labelled = results.filter((x) => x.addLabels.length && data.notes[x.id] && !(x.remove && !s.off.has(`slet:${x.id}`)));
  const chosenRemove = removes.filter((x) => !s.off.has(`slet:${x.id}`));
  const chosenLabels = labelled.filter((x) => !s.off.has(`etiket:${x.id}`));
  const labelCount = chosenLabels.reduce((a, x) => a + x.addLabels.length, 0);
  const toggle = (key: string) => {
    const off = new Set(s.off);
    if (off.has(key)) off.delete(key);
    else off.add(key);
    update({ off });
  };

  const save = async () => {
    setError('');
    setBusy('Gemmer en kopi på Drev …');
    try {
      const backup = await backupNow(store);
      setBusy('Gemmer …');
      const undo: Note[] = [];
      for (const x of chosenRemove) {
        undo.push(data.notes[x.id]);
        await store.remove('notes', x.id);
      }
      for (const x of chosenLabels) {
        const n = data.notes[x.id];
        undo.push(n);
        await store.put('notes', n.id, { ...n, labels: [...(n.labels ?? []), ...x.addLabels] });
      }
      update({ done: { removed: chosenRemove.length, labels: labelCount, backup }, undo, removedIds: chosenRemove.map((x) => x.id) });
    } catch {
      setError('Noget gik galt. Det, der nåede at blive gemt, er gemt.');
    } finally {
      setBusy('');
    }
  };

  const undoAll = async () => {
    setBusy('Lægger tilbage …');
    for (const n of s.undo) await store.put('notes', n.id, n);
    session = fresh();
    setS(session);
    setBusy('');
    go('noter');
  };

  if (s.done) {
    return (
      <div className="stack" style={{ gap: 18 }}>
        <Header back="noter" />
        <div className="tidy-check" aria-hidden="true">{Icon.check}</div>
        <h1 style={{ textAlign: 'center' }}>Ryddet op</h1>
        <p className="muted" style={{ textAlign: 'center', margin: 0 }}>
          {[s.done.removed ? `${plural(s.done.removed, 'note', 'noter')} slettet` : '', s.done.labels ? `${plural(s.done.labels, 'etiket', 'etiketter')} sat` : ''].filter(Boolean).join(' · ') || 'Intet ændret'}
        </p>
        <div className="card small">{s.done.backup ? 'Kopi gemt på Drev lige før. ' : ''}Noterne i Google Keep er ikke rørt.</div>
        <button className="btn block" disabled={!!busy} onClick={undoAll}>{busy || 'Fortryd'}</button>
        <button className="btn primary block" onClick={() => go('noter')}>Se noterne</button>
      </div>
    );
  }

  if (s.results) {
    const list = s.tab === 'slet' ? removes : labelled;
    return (
      <div className="stack" style={{ gap: 14, paddingBottom: 90 }}>
        <Header back="noter" right={<button className="btn ghost small" onClick={() => { session = fresh(); setS(session); }}>Forfra</button>} />
        <h1>Forslag</h1>
        {s.checked < s.total && <p className="notice small">Claude nåede {s.checked} af {s.total} noter.</p>}
        <div className="plan-tabs" role="tablist" aria-label="Forslag">
          <button role="tab" aria-selected={s.tab === 'slet'} className={s.tab === 'slet' ? 'on' : ''} onClick={() => update({ tab: 'slet' })}>Slet · {removes.length}</button>
          <button role="tab" aria-selected={s.tab === 'etiket'} className={s.tab === 'etiket' ? 'on' : ''} onClick={() => update({ tab: 'etiket' })}>Etiketter · {labelled.length}</button>
        </div>
        {list.length === 0 && <p className="muted">{s.tab === 'slet' ? 'Claude fandt intet, der bør slettes.' : 'Ingen nye etiketter.'}</p>}
        {list.map((x) => {
          const n = data.notes[x.id];
          const key = `${s.tab}:${x.id}`;
          const on = !s.off.has(key);
          return (
            <div key={key} className={`tidy-item${s.tab === 'slet' && on ? ' del' : ''}`}>
              <input type="checkbox" checked={on} onChange={() => toggle(key)} aria-label={on ? 'Fravælg' : 'Vælg'} />
              <button className="grow" onClick={() => go(`noter/${n.id}`)}>
                <strong>{n.title || n.text.slice(0, 40) || '(uden titel)'}</strong>
                {s.tab === 'slet'
                  ? <span className="small muted">{x.reason}{x.sure ? '' : ' · måske'}</span>
                  : <span className="tidy-tags">{(n.labels ?? []).map((l) => <span key={l} className="label-chip">{l}</span>)}{x.addLabels.map((l) => <span key={l} className="label-chip new">+ {l}</span>)}</span>}
              </button>
            </div>
          );
        })}
        {error && <p className="error">{error}</p>}
        <div className="tidy-foot">
          <button className="btn primary block" disabled={!!busy || (!chosenRemove.length && !labelCount)} onClick={save}>
            {busy ? <><span className="spinner" /> {busy}</> : `Gem · ${[chosenRemove.length ? `slet ${chosenRemove.length}` : '', labelCount ? `sæt ${labelCount} ${labelCount === 1 ? 'etiket' : 'etiketter'}` : ''].filter(Boolean).join(', ') || 'intet valgt'}`}
          </button>
        </div>
        <p className="tiny muted">Brugt ca. {krText(s.usd)}</p>
      </div>
    );
  }

  const setOpt = (patch: Partial<TidyOptions>) => update({ opts: { ...s.opts, ...patch } });
  return (
    <div className="stack" style={{ gap: 16 }}>
      <Header back="noter" />
      <h1>Ryd op i noter</h1>
      <p className="muted" style={{ margin: 0 }}>Claude foreslår, hvad der kan slettes, og hvilke etiketter noterne skal have. Intet ændres, før du trykker Gem.</p>
      <div className="keep-stats">
        <span><b>{notes.length}</b>noter</span>
        <span><b>{unlabeled}</b>uden etiket</span>
        <span><b>{labels.length}</b>etiketter</span>
      </div>
      <div className="card stack-sm">
        <div className="setting"><span>Foreslå noter at slette</span><Switch label="Slet" checked={s.opts.remove} onChange={(v) => setOpt({ remove: v })} /></div>
        <div className="setting"><span>Sæt etiketter på</span><Switch label="Etiketter" checked={s.opts.label} onChange={(v) => setOpt({ label: v })} /></div>
        {s.opts.label && <div className="setting"><span>Nye etiketter må laves</span><Switch label="Nye etiketter" checked={s.opts.newLabels} onChange={(v) => setOpt({ newLabels: v })} /></div>}
      </div>
      {error && <p className="error">{error}</p>}
      {busy ? (
        <>
          <button className="btn primary block" disabled><span className="spinner" /> {busy}</button>
          <button className="btn ghost block" onClick={() => { stop.current = true; }}>Stop</button>
        </>
      ) : (
        <button className="btn primary block" disabled={!notes.length || (!s.opts.remove && !s.opts.label)} onClick={start}>
          <span style={{ width: 18, height: 18, display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}>{Icon.sparkle}</span>
          Gennemgå {plural(notes.length, 'note', 'noter')}
        </button>
      )}
      <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>Ca. {krText(tidyEstimate(notes))} · {TIDY_MODEL.includes('sonnet') ? 'Claude Sonnet' : 'Claude'}{notes.length > 80 ? ' · tager et par minutter' : ''}</p>
    </div>
  );
}
