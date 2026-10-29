import { useState, type ReactNode } from 'react';
import type { Proposal } from '../lib/ai';
import { formatFull } from '../lib/dates';
import { baseKind, findPerson, lineDiff, problem, saveProposal, target, undoProposal, whereSaved, type Saved } from '../lib/proposals';
import { everyText } from '../lib/routines';
import { useStore } from '../lib/store';
import type { Appointment, Note, Routine } from '../lib/types';
import { go } from '../ui';

type Status = { saved: Saved } | 'nej' | 'fortrudt' | null;

// Huskes, mens dagbogen er åben, så et forslag ikke kan gemmes to gange efter at have kigget væk.
const statuses = new WeakMap<Proposal, Status>();

const KIND: Record<Proposal['kind'], string> = {
  note: 'Ny note', todo: 'Nyt huskepunkt', appointment: 'Ny aftale', routine: 'Ny fast ting', personNote: 'Note om',
  editNote: 'Ret note', editAppointment: 'Ret aftale', editRoutine: 'Ret fast ting',
};

const when = (date: string, time: string) => `${/^\d{4}-\d{2}-\d{2}$/.test(date) ? formatFull(date) : '?'}${time ? ` kl. ${time.replace(':', '.')}` : ''}`;
const often = (everyDays: number, monthly: boolean) => everyText({ everyDays: Math.max(1, Math.round(everyDays) || 1), monthly });

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
  const base = baseKind(p.kind);
  const isEdit = p.kind.startsWith('edit');
  const old = target(p, store.data);
  const person = p.kind === 'personNote' ? findPerson(store.data.people, p.title) : undefined;
  const title = p.kind === 'personNote' ? person?.name ?? p.title : p.title;
  const label = p.kind === 'personNote' ? `${KIND.personNote} ${title}` : KIND[p.kind];

  if (status === 'nej') return null;
  if (status === 'fortrudt') return <p className="tiny muted">Fortrudt: {title}</p>;
  if (status) {
    const where = whereSaved(status.saved);
    const google = 'google' in status.saved && status.saved.google;
    return (
      <div className="stack-sm">
        <div className="proposal-ok" role="status">
          <span className="badge">✓</span>
          <span><strong>{title}</strong> er {isEdit ? 'rettet' : status.saved.kind === 'todo' ? 'lagt på huskelisten' : `gemt under ${where.label}`}
            {google && <span className="small muted" style={{ display: 'block' }}>og i Google Kalender</span>}
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
    const why = problem(p, store.data);
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
          {base !== 'personNote' && (
            <label className="field">{base === 'note' ? 'Titel' : base === 'routine' ? 'Navn' : base === 'todo' ? 'Huskepunkt' : 'Hvad'}
              <input type="text" value={p.title} onChange={(e) => set({ title: e.target.value })} />
            </label>
          )}
          {base === 'appointment' && (
            <>
              <div className="row">
                <label className="field grow">Dato<input type="date" value={p.date} onChange={(e) => e.target.value && set({ date: e.target.value })} /></label>
                <label className="field">Klokken<input type="time" value={p.time} onChange={(e) => set({ time: e.target.value })} /></label>
              </div>
              <label className="field">Sted<input type="text" value={p.place} onChange={(e) => set({ place: e.target.value })} /></label>
              <label className="field">Note<input type="text" value={p.note} onChange={(e) => set({ note: e.target.value })} /></label>
            </>
          )}
          {base === 'todo' && (
            <label className="field">Frist (valgfri)<input type="date" value={p.date} onChange={(e) => set({ date: e.target.value })} /></label>
          )}
          {base === 'routine' && (
            <label className="field">Første gang<input type="date" value={p.date} onChange={(e) => e.target.value && set({ date: e.target.value })} /></label>
          )}
          {(base === 'note' || base === 'personNote') && (
            <label className="field">{base === 'note' ? 'Tekst' : 'Noten'}
              <textarea rows={base === 'note' ? 10 : 3} value={p.text} onChange={(e) => set({ text: e.target.value })} />
            </label>
          )}
        </>
      ) : isEdit && old ? (
        <EditPreview p={p} old={old} google={!!(old as Appointment).google} />
      ) : (
        <>
          {base !== 'personNote' && <strong className="proposal-title">{base === 'appointment' ? '🗓' : base === 'todo' ? '☐' : p.icon} {p.title}</strong>}
          {base === 'todo' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) && <div className="kv small"><span className="muted">Frist</span><b>{formatFull(p.date)}</b></div>}
          {base === 'note' && <NotePreview text={p.text} />}
          {base === 'personNote' && <p className="serif">"{p.text}"</p>}
          {base === 'appointment' && (
            <>
              <div className="kv small"><span className="muted">Hvornår</span><b>{when(p.date, p.time)}</b></div>
              {p.place && <div className="kv small"><span className="muted">Hvor</span><b>{p.place}</b></div>}
              {p.note && <div className="kv small"><span className="muted">Note</span><b>{p.note}</b></div>}
              {g.email && g.push && <span className="g-badge">Også i Google Kalender</span>}
            </>
          )}
          {base === 'routine' && (
            <>
              <div className="kv small"><span className="muted">Hvor ofte</span><b>{often(p.everyDays, p.monthly)}</b></div>
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

/** Én ændring: det gamle overstreget, det nye fremhævet. Uændret vises bare. */
function Change({ label, before, after }: { label: string; before: string; after: string }) {
  if (before === after) return after ? <div className="kv small"><span className="muted">{label}</span><b>{after}</b></div> : null;
  return (
    <div className="stack-sm" style={{ gap: 4 }}>
      <span className="proposal-field">{label}</span>
      {before && <span className="diff old">{before}</span>}
      {after && <span className="diff new">{after}</span>}
    </div>
  );
}

function EditPreview({ p, old, google }: { p: Proposal; old: Note | Appointment | Routine; google: boolean }) {
  let body: ReactNode = null;
  if (p.kind === 'editAppointment') {
    const a = old as Appointment;
    body = (
      <>
        {a.title !== p.title.trim() && <Change label="Hvad" before={a.title} after={p.title.trim()} />}
        <Change label="Hvornår" before={when(a.date, a.time)} after={when(p.date, p.time)} />
        <Change label="Hvor" before={a.place} after={p.place.trim()} />
        <Change label="Note" before={a.note ?? ''} after={p.note.trim()} />
        {google && <span className="g-badge">Rettes også i Google Kalender</span>}
      </>
    );
  } else if (p.kind === 'editRoutine') {
    const r = old as Routine;
    body = (
      <>
        <Change label="Navn" before={r.name} after={p.title.trim()} />
        <Change label="Hvor ofte" before={often(r.everyDays, r.monthly)} after={often(p.everyDays, p.monthly)} />
        <Change label="Første gang" before={formatFull(r.start)} after={p.date ? formatFull(p.date) : formatFull(r.start)} />
        <Change label="Skift mellem" before={r.options.join(', ')} after={p.options.join(', ')} />
      </>
    );
  } else {
    const n = old as Note;
    const pretty = (l: string) => l.replace(/^- \[ \] /, '☐ ').replace(/^- \[x\] /i, '☑ ').replace(/^#+ /, '');
    body = (
      <>
        {n.title !== p.title.trim() && <Change label="Titel" before={n.title} after={p.title.trim()} />}
        <div className="stack-sm" style={{ gap: 2 }}>
          {lineDiff(n.text, p.text).map((l, i) => (
            <span key={i} className={l.kind === 'same' ? 'small' : `diff ${l.kind === 'added' ? 'new' : 'old'}`}>
              {l.kind === 'added' ? '+ ' : l.kind === 'removed' ? '− ' : ''}{pretty(l.text)}
            </span>
          ))}
        </div>
      </>
    );
  }
  const name = p.kind === 'editRoutine' ? (old as Routine).name : (old as Note | Appointment).title;
  const icon = p.kind === 'editAppointment' ? '🗓' : (old as Note | Routine).icon;
  return (
    <>
      <strong className="proposal-title">{icon} {name}</strong>
      {body}
    </>
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
