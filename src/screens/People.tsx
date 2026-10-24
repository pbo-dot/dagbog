import { useMemo, useState } from 'react';
import { formatShort, today } from '../lib/dates';
import { excerpt } from '../lib/search';
import { useStore } from '../lib/store';
import type { Pattern, Person } from '../lib/types';
import { DoubleConfirm, go, Header, Icon, uid } from '../ui';

export function PeopleScreen() {
  const store = useStore();
  const people = Object.values(store.data.people).sort((a, b) => b.updatedAt - a.updatedAt);
  const [name, setName] = useState('');

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const id = uid();
    await store.put('people', id, { id, name: n, important: '', notes: [], updatedAt: Date.now() });
    setName('');
    go(`mennesker/${id}`);
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="mere" />
      <h1>Mennesker</h1>
      <p className="small muted">Små noter om dem, der betyder noget, så du husker, hvad der sidst var vigtigt for dem.</p>
      <form className="row" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input type="text" className="grow" value={name} onChange={(e) => setName(e.target.value)} placeholder="Navn" />
        <button className="icon-btn" aria-label="Tilføj" disabled={!name.trim()}><span style={{ width: 20, height: 20, display: 'inline-flex' }}>{Icon.plus}</span></button>
      </form>
      <div className="list">
        {people.map((p) => (
          <button key={p.id} className="list-item" onClick={() => go(`mennesker/${p.id}`)}>
            <strong>{p.name}</strong>
            <span className="small muted">{p.important || p.notes[0]?.text || 'Ingen noter endnu'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PersonScreen({ id }: { id: string }) {
  const store = useStore();
  const person = store.data.people[id];
  const [note, setNote] = useState('');

  const mentions = useMemo(() => {
    if (!person) return [];
    const first = person.name.split(/\s+/)[0].toLowerCase();
    if (first.length < 2) return [];
    const re = new RegExp(`(^|[^\\p{L}])${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu');
    return Object.values(store.data.entries)
      .filter((e) => re.test(e.text))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 5);
  }, [person, store.data.entries]);

  if (!person) return <div className="stack"><Header back="mennesker" /><p className="muted">Ikke fundet.</p></div>;

  const save = (p: Person) => store.put('people', id, { ...p, updatedAt: Date.now() });

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="mennesker" />
      <input type="text" className="serif" style={{ fontSize: '1.4rem', border: 'none', background: 'transparent', padding: 0 }} value={person.name}
        onChange={(e) => save({ ...person, name: e.target.value })} aria-label="Navn" />

      <label className="field">
        Det er vigtigt for {person.name.split(' ')[0] || 'dem'} lige nu
        <textarea rows={2} value={person.important} onChange={(e) => save({ ...person, important: e.target.value })} placeholder="Fx ny job, mor er syg, glæder sig til ferien" />
      </label>

      <section className="stack-sm">
        <h3>Noter</h3>
        <form className="stack-sm" onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          save({ ...person, notes: [{ id: uid(), date: today(), text: note.trim() }, ...person.notes] });
          setNote('');
        }}>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ny note …" />
          <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!note.trim()}>Tilføj note</button>
        </form>
        <div className="list">
          {person.notes.map((n) => (
            <div key={n.id} className="list-item">
              <div className="row between">
                <span className="tiny muted">{formatShort(n.date)}</span>
                <button className="btn ghost tiny" onClick={() => save({ ...person, notes: person.notes.filter((x) => x.id !== n.id) })}>Fjern</button>
              </div>
              <span className="serif">{n.text}</span>
            </div>
          ))}
        </div>
      </section>

      {mentions.length > 0 && (
        <section className="stack-sm">
          <h3>Nævnt i dagbogen</h3>
          <div className="list">
            {mentions.map((e) => (
              <button key={e.date} className="list-item" onClick={() => go(`husk/dag/${e.date}`)}>
                <span className="tiny muted">{formatShort(e.date)}</span>
                <span className="small serif">{excerpt(e.text, [person.name.split(/\s+/)[0]], 140)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <DoubleConfirm label="Slet person" first={`Slet ${person.name} og alle noter?`} second="Er du helt sikker?"
        onConfirm={async () => { await store.remove('people', id); go('mennesker'); }} />
    </div>
  );
}

export function PatternsScreen() {
  const store = useStore();
  const patterns = Object.values(store.data.patterns).sort((a, b) => b.createdAt - a.createdAt);
  const [text, setText] = useState('');
  const [editing, setEditing] = useState<string | null>(null);

  const save = (p: Pattern) => store.put('patterns', p.id, p);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="mere" />
      <h1>Mønsterbog</h1>
      <p className="small muted">Tanker og mønstre, der går igen. Fx "Jeg bliver altid lettet, når jeg går en tur."</p>
      <form className="stack-sm" onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        const id = uid();
        save({ id, text: text.trim(), createdAt: Date.now(), occurrences: [], source: 'manual' });
        setText('');
      }}>
        <textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Jeg lægger mærke til, at …" />
        <button className="btn" style={{ alignSelf: 'flex-start' }} disabled={!text.trim()}>Tilføj</button>
      </form>

      <div className="stack-sm">
        {patterns.length === 0 && <p className="small muted">Ingen mønstre endnu. Du kan også gemme mønstre fra ugeopsummeringen.</p>}
        {patterns.map((p) => {
          const last = p.occurrences[p.occurrences.length - 1];
          return (
            <div key={p.id} className="card stack-sm">
              {editing === p.id ? (
                <textarea rows={3} autoFocus value={p.text} onChange={(e) => save({ ...p, text: e.target.value })} onBlur={() => setEditing(null)} />
              ) : (
                <p className="serif" style={{ fontSize: '1.05rem' }} onClick={() => setEditing(p.id)}>{p.text}</p>
              )}
              <div className="row between wrap">
                <span className="tiny muted">
                  {p.source === 'ai' ? 'Fra ugeopsummering · ' : ''}
                  {p.occurrences.length ? `Set igen ${p.occurrences.length} ${p.occurrences.length === 1 ? 'gang' : 'gange'}, senest ${formatShort(last)}` : formatShort(new Date(p.createdAt).toISOString().slice(0, 10))}
                </span>
                <div className="row">
                  <button className="btn small" onClick={() => save({ ...p, occurrences: [...p.occurrences, today()] })}>Det skete igen</button>
                  <button className="btn ghost small" onClick={() => store.remove('patterns', p.id)} aria-label="Slet">Slet</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
