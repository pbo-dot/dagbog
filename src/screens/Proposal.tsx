import { useState } from 'react';
import type { Proposal } from '../lib/ai';
import { formatFull } from '../lib/dates';
import { findPerson, problem, saveProposal, undoProposal, whereSaved, type Saved } from '../lib/proposals';
import { everyText } from '../lib/routines';
import { useStore } from '../lib/store';
import { go } from '../ui';

type Status = { saved: Saved } | 'nej' | 'fortrudt' | null;

// Huskes, mens dagbogen er åben, så et forslag ikke kan gemmes to gange efter at have kigget væk.
const statuses = new WeakMap<Proposal, Status>();

const KIND: Record<Proposal['kind'], string> = { note: 'Ny note', appointment: 'Ny aftale', routine: 'Ny fast ting', personNote: 'Note om' };

/** Et forslag fra Claude: Gem, Ret eller Nej tak. Intet gemmes før Gem. */
export function ProposalCard({ proposal }: { proposal: Proposal }) {
  const store = useStore();
  const [p, setP] = useState<Proposal>(proposal);
  const [status, setStatusState] = useState<Status>(() => statuses.get(proposal) ?? null);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const setStatus = (s: Status) => {
    statuses.set(proposal, s);
    setStatusState(s);
  };
  const g = store.data.settings.google;
  const person = p.kind === 'personNote' ? findPerson(store.data.people, p.title) : undefined;
  const title = p.kind === 'personNote' ? person?.name ?? p.title : p.title;
  const label = p.kind === 'personNote' ? `${KIND.personNote} ${title}` : KIND[p.kind];

  if (status === 'nej') return null;
  if (status === 'fortrudt') return <p className="tiny muted">Fortrudt: {title}</p>;
  if (status) {
    const where = whereSaved(status.saved);
    return (
      <div className="stack-sm">
        <div className="proposal-ok" role="status">
          <span className="badge">✓</span>
          <span><strong>{title}</strong> er gemt under {where.label}
            {status.saved.kind === 'appointment' && status.saved.google && <span className="small muted" style={{ display: 'block' }}>og i Google Kalender</span>}
          </span>
        </div>
        <div className="row">
          <button className="btn small" onClick={() => go(where.path)}>Åbn i {where.label}</button>
          <button className="btn ghost small" onClick={async () => { await undoProposal(store, status.saved); setStatus('fortrudt'); }}>Fortryd</button>
        </div>
      </div>
    );
  }

  const set = (patch: Partial<Proposal>) => setP({ ...p, ...patch });
  const save = async () => {
    const why = problem(p, store.data.people);
    if (why) return setError(why);
    setBusy(true);
    try {
      setStatus({ saved: await saveProposal(store, p) });
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="proposal stack-sm">
      <span className="proposal-kind">{label}</span>
      {editing ? (
        <>
          {p.kind !== 'personNote' && (
            <label className="field">{p.kind === 'note' ? 'Titel' : p.kind === 'routine' ? 'Navn' : 'Hvad'}
              <input type="text" value={p.title} onChange={(e) => set({ title: e.target.value })} />
            </label>
          )}
          {p.kind === 'appointment' && (
            <>
              <div className="row">
                <label className="field grow">Dato<input type="date" value={p.date} onChange={(e) => e.target.value && set({ date: e.target.value })} /></label>
                <label className="field">Klokken<input type="time" value={p.time} onChange={(e) => set({ time: e.target.value })} /></label>
              </div>
              <label className="field">Sted<input type="text" value={p.place} onChange={(e) => set({ place: e.target.value })} /></label>
            </>
          )}
          {p.kind === 'routine' && (
            <label className="field">Første gang<input type="date" value={p.date} onChange={(e) => e.target.value && set({ date: e.target.value })} /></label>
          )}
          {(p.kind === 'note' || p.kind === 'personNote') && (
            <label className="field">{p.kind === 'note' ? 'Tekst' : 'Noten'}
              <textarea rows={p.kind === 'note' ? 10 : 3} value={p.text} onChange={(e) => set({ text: e.target.value })} />
            </label>
          )}
        </>
      ) : (
        <>
          {p.kind !== 'personNote' && <strong className="proposal-title">{p.kind === 'appointment' ? '🗓' : p.icon} {p.title}</strong>}
          {p.kind === 'note' && <NotePreview text={p.text} />}
          {p.kind === 'personNote' && <p className="serif">"{p.text}"</p>}
          {p.kind === 'appointment' && (
            <>
              <div className="kv small"><span className="muted">Hvornår</span><b>{/^\d{4}-\d{2}-\d{2}$/.test(p.date) ? formatFull(p.date) : '?'}{p.time ? ` kl. ${p.time.replace(':', '.')}` : ''}</b></div>
              {p.place && <div className="kv small"><span className="muted">Hvor</span><b>{p.place}</b></div>}
              {g.email && g.push && <span className="g-badge">Også i Google Kalender</span>}
            </>
          )}
          {p.kind === 'routine' && (
            <>
              <div className="kv small"><span className="muted">Hvor ofte</span><b>{everyText({ everyDays: Math.max(1, Math.round(p.everyDays) || 1), monthly: p.monthly })}</b></div>
              {p.date && <div className="kv small"><span className="muted">Første gang</span><b>{formatFull(p.date)}</b></div>}
              {p.options.length > 0 && <div className="kv small"><span className="muted">Skift mellem</span><b>{p.options.join(', ')}</b></div>}
            </>
          )}
        </>
      )}
      {error && <p className="error small" role="alert">{error}</p>}
      <div className="row">
        <button className="btn primary small" disabled={busy} onClick={save}>Gem</button>
        <button className="btn small" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? 'Færdig' : 'Ret'}</button>
        <button className="btn ghost small" disabled={busy} onClick={() => setStatus('nej')}>Nej tak</button>
      </div>
    </div>
  );
}

/** De første linjer af en note, med afkrydsning som ☐. */
function NotePreview({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim());
  const shown = lines.slice(0, 8).map((l) => l.replace(/^- \[ \] /, '☐ ').replace(/^- \[x\] /i, '☑ ').replace(/^#+ /, ''));
  return (
    <div className="small" style={{ whiteSpace: 'pre-wrap' }}>
      {shown.join('\n')}
      {lines.length > 8 && <span className="muted" style={{ display: 'block' }}>… {lines.length - 8} linjer mere</span>}
    </div>
  );
}
