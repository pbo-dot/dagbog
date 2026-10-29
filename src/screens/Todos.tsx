import { useEffect, useRef, useState } from 'react';
import { addDays, today } from '../lib/dates';
import { speechInputAvailable, startDictation } from '../lib/device';
import { useStore } from '../lib/store';
import { TODAY_MAX, dueSoon, dueText, groupTodos, postponeChoices, shortDate } from '../lib/todos';
import type { Todo } from '../lib/types';
import { go, Header, Icon, uid } from '../ui';

/** Afkrydsning med ét tryk. Et klaret punkt kan fortrydes med et tryk mere. */
function TodoRow({ todo, onMenu, dim }: { todo: Todo; onMenu: (t: Todo) => void; dim?: boolean }) {
  const store = useStore();
  const t = today();
  const done = !!todo.doneAt;
  const toggle = () => store.put('todos', todo.id, { ...todo, doneAt: done ? undefined : Date.now() });
  const meta = [
    todo.due && !done ? dueText(todo.due, t) : '',
    todo.showFrom && todo.showFrom > t && !todo.someday && !done ? `vises fra ${shortDate(todo.showFrom)}` : '',
    todo.from ?? '',
  ].filter(Boolean);
  return (
    <div className={`todo-row${done ? ' done' : ''}`}>
      <button className={`todo-check${done ? ' on' : ''}${dim ? ' dim' : ''}`} onClick={toggle} aria-label={done ? `Fortryd: ${todo.text}` : `Klaret: ${todo.text}`}>
        {done && <span style={{ width: 16, height: 16, display: 'inline-flex' }}>{Icon.check}</span>}
      </button>
      <button className="grow todo-text" onClick={() => go(`huskeliste/${todo.id}`)}>
        <strong>{todo.text}</strong>
        {meta.length > 0 && (
          <span className={`small ${todo.due && dueSoon(todo.due, t) && !done ? 'error' : 'muted'}`} style={{ display: 'block' }}>{meta.join(' · ')}</span>
        )}
      </button>
      {!done && <button className="todo-more" onClick={() => onMenu(todo)} aria-label={`Flere valg for ${todo.text}`}>⋯</button>}
    </div>
  );
}

/** Panelet nedefra: vis igen senere, læg væk til "Engang", ret eller slet. */
function TodoSheet({ todo, onClose }: { todo: Todo; onClose: () => void }) {
  const store = useStore();
  const t = today();
  const [pick, setPick] = useState(false);
  const save = async (patch: Partial<Todo>) => {
    await store.put('todos', todo.id, { ...todo, ...patch });
    onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="sheet-wrap" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={todo.text} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grab" />
        <strong className="sheet-title">{todo.text}</strong>
        <h3>Vis igen</h3>
        <div className="chips">
          {postponeChoices(t).map((c) => (
            <button key={c.label} className="chip" onClick={() => save({ showFrom: c.date, someday: false })}>{c.label}</button>
          ))}
          <button className={`chip ${pick ? 'on' : ''}`} onClick={() => setPick(!pick)}>Vælg dato …</button>
        </div>
        {pick && <input type="date" min={addDays(t, 1)} onChange={(e) => e.target.value && save({ showFrom: e.target.value, someday: false })} aria-label="Vis igen fra" />}
        {(todo.someday || (todo.showFrom && todo.showFrom > t)) && (
          <button className="sheet-item" onClick={() => save({ showFrom: undefined, someday: false })}>
            <span className="sheet-ico">↩</span><span>Vis i "I dag" nu</span>
          </button>
        )}
        {!todo.someday && (
          <button className="sheet-item" onClick={() => save({ someday: true, showFrom: undefined })}>
            <span className="sheet-ico">🌙</span>
            <span><strong>Læg væk til "Engang"</strong><span className="small muted" style={{ display: 'block' }}>Vises ikke i "I dag", før du henter det</span></span>
          </button>
        )}
        <button className="sheet-item" onClick={() => { onClose(); go(`huskeliste/${todo.id}`); }}>
          <span className="sheet-ico">✎</span><span>Ret eller sæt frist</span>
        </button>
        <button className="sheet-item danger" onClick={async () => { await store.remove('todos', todo.id); onClose(); }}>
          <span className="sheet-ico">🗑</span><span>Slet</span>
        </button>
      </div>
    </div>
  );
}

/** Huskepunkterne under "I dag" på Skriv-siden: højst tre, fristen først. */
export function TodoCard() {
  const { data } = useStore();
  const [menu, setMenu] = useState<Todo | null>(null);
  // Punkter, der krydses af her, bliver stående (overstreget), så de kan fortrydes.
  const [since] = useState(() => Date.now());
  const t = today();
  const g = groupTodos(data.todos, t);
  const recent = g.done.filter((d) => d.doneAt! >= since);
  const shown = g.now.slice(0, TODAY_MAX);
  const rest = g.now.length - shown.length;
  if (!shown.length && !recent.length) return null;
  return (
    <section className="today" aria-label="Huskeliste">
      <div className="today-head row between">
        <span>Huskeliste</span>
        {g.now.length > TODAY_MAX && <span className="muted">{TODAY_MAX} af {g.now.length}</span>}
      </div>
      {shown.map((todo) => <TodoRow key={todo.id} todo={todo} onMenu={setMenu} />)}
      {recent.map((todo) => <TodoRow key={todo.id} todo={todo} onMenu={setMenu} />)}
      <button className="today-later" onClick={() => go('huskeliste')}>
        {rest > 0 ? `${rest} mere · Hele huskelisten ›` : 'Hele huskelisten ›'}
      </button>
      {menu && <TodoSheet todo={menu} onClose={() => setMenu(null)} />}
    </section>
  );
}

/** Hele huskelisten: Nu, Senere, Engang og Klaret. */
export function TodosScreen() {
  const { data } = useStore();
  const [menu, setMenu] = useState<Todo | null>(null);
  const [showSomeday, setShowSomeday] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const g = groupTodos(data.todos, today());
  const group = (title: string, list: Todo[], dim = false) => list.length > 0 && (
    <section className="stack-sm">
      <h3>{title} · {list.length}</h3>
      <div className="card todo-list">{list.map((todo) => <TodoRow key={todo.id} todo={todo} onMenu={setMenu} dim={dim} />)}</div>
    </section>
  );
  const fold = (title: string, list: Todo[], open: boolean, set: (v: boolean) => void) => list.length > 0 && (
    <section className="stack-sm">
      <button className="fold" onClick={() => set(!open)} aria-expanded={open}>{title} · {list.length} {open ? '▾' : '›'}</button>
      {open && <div className="card todo-list">{list.map((todo) => <TodoRow key={todo.id} todo={todo} onMenu={setMenu} dim />)}</div>}
    </section>
  );
  const empty = !g.now.length && !g.later.length && !g.someday.length && !g.done.length;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="husk" right={<button className="btn primary small" onClick={() => go('huskeliste/ny')}>
        <span style={{ width: 18, height: 18, display: 'inline-flex', marginRight: 4 }}>{Icon.plus}</span>Nyt
      </button>} />
      <h1>Huskeliste</h1>
      {empty && <p className="muted">Ting, du skal huske at få gjort, men ikke på et bestemt tidspunkt.</p>}
      {group('Nu', g.now)}
      {group('Senere', g.later, true)}
      {fold('Engang', g.someday, showSomeday, setShowSomeday)}
      {fold('Klaret i denne uge', g.done, showDone, setShowDone)}
      {menu && <TodoSheet todo={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

type When = 'now' | 'date' | 'someday';

/** Nyt huskepunkt, eller ret et eksisterende. */
export function TodoEditScreen({ id }: { id?: string }) {
  const store = useStore();
  const old = id ? store.data.todos[id] : undefined;
  const t = today();
  const [text, setText] = useState(old?.text ?? '');
  const [due, setDue] = useState(old?.due ?? '');
  const [dueOpen, setDueOpen] = useState(!!old?.due && ![t, addDays(t, 1)].includes(old.due));
  const [when, setWhen] = useState<When>(old?.someday ? 'someday' : old?.showFrom && old.showFrom > t ? 'date' : 'now');
  const [showFrom, setShowFrom] = useState(old?.showFrom && old.showFrom > t ? old.showFrom : addDays(t, 1));
  const [listening, setListening] = useState(false);
  const [error, setError] = useState('');
  const stopMic = useRef<(() => void) | null>(null);
  useEffect(() => () => stopMic.current?.(), []);

  if (id && !old) return <div className="stack"><Header back="huskeliste" /><p className="muted">Huskepunktet findes ikke længere.</p></div>;

  const toggleMic = () => {
    if (listening) return stopMic.current?.();
    setError('');
    setListening(true);
    const base = text && !/\s$/.test(text) ? `${text} ` : text;
    stopMic.current = startDictation(
      (final, interim) => setText(base + [final, interim].filter(Boolean).join(' ')),
      (err) => {
        setListening(false);
        stopMic.current = null;
        if (err) setError(err);
      },
    );
  };

  const save = async () => {
    stopMic.current?.();
    const clean = text.trim();
    if (!clean) return setError('Skriv, hvad du skal huske.');
    const todo: Todo = {
      ...(old ?? { id: uid(), createdAt: Date.now() }),
      text: clean,
      due: due || undefined,
      someday: when === 'someday' || undefined,
      showFrom: when === 'date' ? showFrom : undefined,
    };
    await store.put('todos', todo.id, todo);
    go('huskeliste');
  };

  const dueChips: Array<{ label: string; value: string }> = [
    { label: 'Ingen', value: '' },
    { label: 'I dag', value: t },
    { label: 'I morgen', value: addDays(t, 1) },
  ];

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="huskeliste" />
      <h1>{old ? 'Ret huskepunkt' : 'Nyt huskepunkt'}</h1>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <textarea className="grow" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Fx ring til forsikringen" aria-label="Hvad skal du huske?" autoFocus={!old} />
        {speechInputAvailable() && (
          <button type="button" className={`icon-btn mic ${listening ? 'on' : ''}`} onClick={toggleMic} aria-label={listening ? 'Stop' : 'Indtal'}>
            <span style={{ width: 22, height: 22, display: 'inline-flex' }}>{listening ? Icon.stop : Icon.mic}</span>
          </button>
        )}
      </div>
      <section className="stack-sm">
        <h3>Frist</h3>
        <div className="chips">
          {dueChips.map((c) => (
            <button key={c.label} className={`chip ${!dueOpen && due === c.value ? 'on' : ''}`} onClick={() => { setDue(c.value); setDueOpen(false); }}>{c.label}</button>
          ))}
          <button className={`chip ${dueOpen ? 'on' : ''}`} onClick={() => { setDueOpen(true); if (!due) setDue(addDays(t, 7)); }}>Vælg dato …</button>
        </div>
        {dueOpen && <input type="date" value={due} min={t} onChange={(e) => setDue(e.target.value)} aria-label="Frist" />}
      </section>
      <section className="stack-sm">
        <h3>Vis i "I dag"</h3>
        <div className="chips">
          <button className={`chip ${when === 'now' ? 'on' : ''}`} onClick={() => setWhen('now')}>Fra nu</button>
          <button className={`chip ${when === 'date' ? 'on' : ''}`} onClick={() => setWhen('date')}>Fra en dato …</button>
          <button className={`chip ${when === 'someday' ? 'on' : ''}`} onClick={() => setWhen('someday')}>Engang</button>
        </div>
        {when === 'date' && <input type="date" value={showFrom} min={addDays(t, 1)} onChange={(e) => e.target.value && setShowFrom(e.target.value)} aria-label="Vis fra" />}
      </section>
      {error && <p className="error">{error}</p>}
      <button className="btn primary block" onClick={save}>Gem</button>
      {old && (
        <button className="btn danger" onClick={async () => { await store.remove('todos', old.id); go('huskeliste'); }}>Slet</button>
      )}
    </div>
  );
}

/** "+ Huskeliste" ved et punkt fra en samtale eller ugens løse ender. Viser ✓, når det er der. */
export function AddTodoButton({ text, from }: { text: string; from: string }) {
  const store = useStore();
  const clean = text.trim();
  const there = Object.values(store.data.todos).find((t) => t.text.trim().toLowerCase() === clean.toLowerCase());
  if (there) {
    return <button className="btn ghost small add-todo" onClick={() => go('huskeliste')}>{there.doneAt ? '✓ Klaret' : '✓ På huskelisten'}</button>;
  }
  return (
    <button className="btn small add-todo" onClick={() => {
      const todo: Todo = { id: uid(), text: clean, from, createdAt: Date.now() };
      store.put('todos', todo.id, todo);
    }} aria-label={`Læg på huskelisten: ${clean}`}>+ Huskeliste</button>
  );
}
