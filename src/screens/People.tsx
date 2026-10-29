import { useMemo, useState } from 'react';
import { formatShort, today } from '../lib/dates';
import { excerpt } from '../lib/search';
import { useStore } from '../lib/store';
import { currentAge, initials, inDays, nextBirthday, upcomingBirthdays } from '../lib/people';
import { MONTHS } from '../lib/dates';
import { PERSON_GROUPS, type Pattern, type Person, type PersonGroup } from '../lib/types';

/** "17. maj" */
const formatDayMonth = (iso: string) => `${Number(iso.slice(-2))}. ${MONTHS[Number(iso.slice(-5, -3)) - 1]}`;
/** "2. december 1937" eller "17. maj", når året ikke kendes */
const formatBirthday = (b: string) => (b.startsWith('--') ? formatDayMonth(b) : `${formatDayMonth(b)} ${b.slice(0, 4)}`);
import { DoubleConfirm, go, Header, Icon, uid } from '../ui';

export function PeopleScreen() {
  const store = useStore();
  const t = today();
  const all = Object.values(store.data.people).sort((a, b) => a.name.localeCompare(b.name, 'da'));
  const [group, setGroup] = useState<PersonGroup | 'alle'>('alle');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const soon = upcomingBirthdays(all, t, 60)[0];

  const add = async () => {
    const n = name.trim();
    if (!n) return;
    const id = uid();
    await store.put('people', id, { id, name: n, important: '', notes: [], updatedAt: Date.now(), group: group === 'alle' ? undefined : group });
    setName('');
    go(`mennesker/${id}`);
  };

  const sections = [...PERSON_GROUPS, { id: undefined, label: 'Andre' }]
    .filter((g) => group === 'alle' || g.id === group)
    .map((g) => ({ ...g, people: all.filter((p) => p.group === g.id) }))
    .filter((g) => g.people.length > 0);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header back="husk" />
      <h1>Mennesker</h1>
      {soon && (
        <button className="card tappable birthday" onClick={() => go(`mennesker/${soon.person.id}`)}>
          <span className="avatar">🎂</span>
          <span className="grow">
            <strong style={{ display: 'block' }}>{soon.person.name} {soon.next.days === 0 ? 'har fødselsdag i dag' : 'fylder år'}{soon.next.age ? ` (${soon.next.age})` : ''}</strong>
            <span className="small muted">{inDays(soon.next.days)} · {formatDayMonth(soon.next.date)}</span>
          </span>
        </button>
      )}
      {all.length > 0 && (
        <div className="chips">
          {[{ id: 'alle' as const, label: 'Alle' }, ...PERSON_GROUPS].map((g) => (
            <button key={g.id} className={`chip ${group === g.id ? 'on' : ''}`} aria-pressed={group === g.id} onClick={() => setGroup(g.id)}>{g.label}</button>
          ))}
        </div>
      )}
      {all.length === 0 && <p className="small muted">Noter om dem, der betyder noget for dig. Tilføj den første med knappen nederst.</p>}
      {sections.map((g) => (
        <section key={g.label} className="stack-sm">
          <h3>{g.label}</h3>
          <div className="card list" style={{ padding: '2px 16px' }}>
            {g.people.map((p) => {
              const next = nextBirthday(p, t);
              return (
                <button key={p.id} className="person-row" onClick={() => go(`mennesker/${p.id}`)}>
                  <span className="avatar">{initials(p.name)}</span>
                  <span className="grow">
                    <strong style={{ display: 'block' }}>{p.name}</strong>
                    <span className="small muted">{p.relation || p.important || p.notes[0]?.text || ' '}</span>
                  </span>
                  {next && <span className="small" style={{ color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}>{formatDayMonth(next.date)}</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
      {adding ? (
        <form className="card stack-sm" onSubmit={(e) => { e.preventDefault(); add(); }}>
          <label className="field">Navn
            <input type="text" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Fx Birgitte" />
          </label>
          <div className="row">
            <button className="btn primary" disabled={!name.trim()}>Tilføj</button>
            <button type="button" className="btn ghost" onClick={() => setAdding(false)}>Fortryd</button>
          </div>
        </form>
      ) : (
        <button className="fab" onClick={() => setAdding(true)}><span style={{ width: 22, height: 22, display: 'inline-flex' }}>{Icon.plus}</span>Person</button>
      )}
      <div style={{ height: 64 }} aria-hidden="true" />
    </div>
  );
}

export function PersonScreen({ id }: { id: string }) {
  const store = useStore();
  const person = store.data.people[id];
  const [note, setNote] = useState('');
  const [editing, setEditing] = useState(false);
  const t = today();

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
  const age = currentAge(person, t);
  const first = person.name.split(' ')[0] || 'dem';
  const yearKnown = !!person.birthday && !person.birthday.startsWith('--');

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header back="mennesker" right={<button className="btn small" onClick={() => setEditing((v) => !v)}>{editing ? 'Færdig' : 'Ret'}</button>} />
      <div className="person-hero">
        <span className="avatar big">{initials(person.name)}</span>
        <h1>{person.name}</h1>
        <span className="small muted">
          {[person.relation, person.birthday ? formatBirthday(person.birthday) : '', age !== null ? `${age} år` : ''].filter(Boolean).join(' · ')}
        </span>
      </div>

      {editing ? (
        <section className="card stack-sm">
          <label className="field">Navn
            <input type="text" value={person.name} onChange={(e) => save({ ...person, name: e.target.value })} />
          </label>
          <label className="field">Relation
            <input type="text" value={person.relation ?? ''} placeholder="Fx Datter, Mor, Ven" onChange={(e) => save({ ...person, relation: e.target.value })} />
          </label>
          <label className="field">Gruppe
            <select value={person.group ?? ''} onChange={(e) => save({ ...person, group: (e.target.value || undefined) as PersonGroup | undefined })}>
              <option value="">Ingen</option>
              {PERSON_GROUPS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
            </select>
          </label>
          <div className="row">
            <label className="field grow">Fødselsdag
              <input type="date" value={person.birthday ? (yearKnown ? person.birthday : `2000${person.birthday.slice(1)}`) : ''}
                onChange={(e) => save({ ...person, birthday: e.target.value ? (yearKnown || !person.birthday ? e.target.value : `-${e.target.value.slice(4)}`) : undefined })} />
            </label>
          </div>
          {person.birthday && (
            <label className="row" style={{ gap: 10 }}>
              <input type="checkbox" checked={!yearKnown} onChange={(e) => save({ ...person, birthday: e.target.checked ? `-${person.birthday!.slice(person.birthday!.startsWith('--') ? 1 : 4)}` : `2000${person.birthday!.slice(1)}` })} />
              <span className="small">Året kendes ikke</span>
            </label>
          )}
          <label className="field">Familie
            <textarea rows={2} value={person.family ?? ''} placeholder="Fx Gift med Kamma. Børn: Per og Dorte." onChange={(e) => save({ ...person, family: e.target.value })} />
          </label>
        </section>
      ) : person.family ? (
        <section className="card"><p className="small">{person.family}</p></section>
      ) : null}

      <section className="stack-sm">
        <h3>Vigtigt for {first} lige nu</h3>
        <textarea rows={2} value={person.important} onChange={(e) => save({ ...person, important: e.target.value })} placeholder="Fx nyt job, glæder sig til ferien" />
      </section>

      <section className="stack-sm">
        <h3>Noter</h3>
        <form className="row" style={{ alignItems: 'flex-end' }} onSubmit={(e) => {
          e.preventDefault();
          if (!note.trim()) return;
          save({ ...person, notes: [{ id: uid(), date: today(), text: note.trim() }, ...person.notes] });
          setNote('');
        }}>
          <textarea className="grow" rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ny note …" />
          <button className="icon-btn" aria-label="Tilføj note" disabled={!note.trim()}><span style={{ width: 20, height: 20, display: 'inline-flex' }}>{Icon.plus}</span></button>
        </form>
        {person.notes.length > 0 && (
          <div className="card list" style={{ padding: '2px 16px' }}>
            {person.notes.map((n) => (
              <div key={n.id} className="list-item">
                <div className="row between">
                  <span className="tiny muted">{formatShort(n.date)}</span>
                  <button className="btn ghost small" style={{ minHeight: 32, padding: '4px 8px' }} onClick={() => save({ ...person, notes: person.notes.filter((x) => x.id !== n.id) })}>Fjern</button>
                </div>
                <span className="serif">{n.text}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {mentions.length > 0 && (
        <section className="stack-sm">
          <h3>Nævnt i dagbogen</h3>
          <div className="card list" style={{ padding: '2px 16px' }}>
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
