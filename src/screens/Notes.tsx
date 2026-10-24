import { useState } from 'react';
import { useStore } from '../lib/store';
import type { Note } from '../lib/types';
import { DoubleConfirm, go, Header, Icon, uid } from '../ui';

const ICONS = ['📝', '📈', '🧳', '🌊', '🧭', '💡', '🩺', '🏠', '🔗', '🍽️'];

/** Linjer med "- [ ]" / "- [x]" er afkrydsning. */
const CHECK = /^\s*[-*] \[( |x|X)\] (.*)$/;

/** Første linje med indhold (uden afkrydsning), til listen. */
function preview(text: string): string {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const checks = lines.filter((l) => CHECK.test(l)).length;
  if (checks && checks === lines.length) return `${checks} ting`;
  return lines.find((l) => !CHECK.test(l) && !/^#/.test(l))?.replace(/^[-*]\s+/, '') ?? '';
}

const newNote = (): Note => ({ id: uid(), title: '', icon: '📝', text: '', createdAt: Date.now(), updatedAt: Date.now() });

const withText = (n: Note, text: string): Note => ({ ...n, text, updatedAt: Date.now() });

/** Liste over noter med søgning. */
export function NotesScreen() {
  const { notes } = useStore().data;
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const list = Object.values(notes)
    .filter((n) => !term || `${n.title}\n${n.text}`.toLowerCase().includes(term))
    .sort((a, b) => a.title.localeCompare(b.title, 'da'));
  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header back="husk" />
      <h1>Noter</h1>
      {Object.keys(notes).length > 0 && (
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Søg i noter" aria-label="Søg i noter" />
      )}
      {Object.keys(notes).length === 0 && <p className="small muted">Faste oplysninger uden dato, fx regler, lister og gode råd.</p>}
      <div className="stack-sm" style={{ gap: 10 }}>
        {list.map((n) => (
          <button key={n.id} className="card tappable note-row" onClick={() => go(`noter/${n.id}`)}>
            <span className="note-ico">{n.icon}</span>
            <span className="grow" style={{ minWidth: 0 }}>
              <strong style={{ display: 'block' }}>{n.title}</strong>
              <span className="small muted" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{preview(n.text)}</span>
            </span>
          </button>
        ))}
        {term && list.length === 0 && <p className="small muted">Ingen noter med "{q}".</p>}
      </div>
      <button className="fab" onClick={() => go('noter/ny')}><span style={{ width: 22, height: 22, display: 'inline-flex' }}>{Icon.plus}</span>Note</button>
      <div style={{ height: 64 }} aria-hidden="true" />
    </div>
  );
}

/** Én note: læsevisning med afkrydsning, eller redigering. */
export function NoteScreen({ id }: { id: string }) {
  const store = useStore();
  const isNew = id === 'ny';
  const existing = store.data.notes[id];
  const [draft, setDraft] = useState<Note | null>(() => (isNew ? newNote() : null));

  if (!isNew && !existing) return <div className="stack"><Header back="noter" /><p className="muted">Ikke fundet.</p></div>;

  if (draft) {
    const saveDraft = async () => {
      if (!draft.title.trim()) return;
      await store.put('notes', draft.id, { ...draft, title: draft.title.trim(), updatedAt: Date.now() });
      setDraft(null);
      if (isNew) go(`noter/${draft.id}`);
    };
    return (
      <div className="stack" style={{ gap: 16 }}>
        <Header back={isNew ? 'noter' : `noter/${id}`} />
        <h1>{isNew ? 'Ny note' : 'Ret note'}</h1>
        <div className="chips">
          {ICONS.map((i) => <button key={i} className={`chip ${draft.icon === i ? 'on' : ''}`} onClick={() => setDraft({ ...draft, icon: i })} aria-label={`Ikon ${i}`}>{i}</button>)}
        </div>
        <label className="field">Titel
          <input type="text" autoFocus={isNew} value={draft.title} placeholder="Fx Pakkeliste Fanø" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </label>
        <label className="field">Tekst
          <textarea rows={12} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} placeholder="Skriv her …" />
        </label>
        <p className="tiny muted">Tip: Start en linje med "- [ ] " for at få en afkrydsningsboks.</p>
        <div className="row">
          <button className="btn primary" disabled={!draft.title.trim()} onClick={saveDraft}>Gem</button>
          <button className="btn ghost" onClick={() => (isNew ? go('noter') : setDraft(null))}>Fortryd</button>
        </div>
        {!isNew && (
          <DoubleConfirm label="Slet note" first={`Slet "${draft.title}"?`} second="Er du helt sikker?"
            onConfirm={async () => { await store.remove('notes', id); go('noter'); }} />
        )}
      </div>
    );
  }

  const n = existing!;
  const lines = n.text.split('\n');
  const hasChecks = lines.some((l) => CHECK.test(l));
  const toggle = (i: number) => {
    const next = lines.map((l, j) => (j === i ? l.replace(/\[( |x|X)\]/, (_m, c: string) => (c === ' ' ? '[x]' : '[ ]')) : l));
    store.put('notes', n.id, withText(n, next.join('\n')));
  };
  const reset = () => store.put('notes', n.id, withText(n, n.text.replace(/\[(x|X)\]/g, '[ ]')));

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Header back="noter" right={<button className="btn small" onClick={() => setDraft({ ...n })}>Ret</button>} />
      <h1>{n.icon} {n.title}</h1>
      <div className="card note-body">
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
      {hasChecks && <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} onClick={reset}>Nulstil afkrydsning</button>}
    </div>
  );
}
