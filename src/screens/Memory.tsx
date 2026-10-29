import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { AIError } from '../lib/ai';
import { addDays, addMonths, formatFull, formatMonth, formatShort, fromISO, monthId, today, WEEKDAYS } from '../lib/dates';
import { aiReady, generateMonth, monthEntries } from '../lib/generate';
import { excerpt, highlight, localSearch, rankByTerms, tokenize } from '../lib/search';
import { waiting } from '../lib/device';
import { useStore } from '../lib/store';
import { MOODS, type Entry } from '../lib/types';
import { DoubleConfirm, go, Header, Icon, MoodTag, PhotoGallery, PhotoImg } from '../ui';
import { askSoon } from './Ask';

function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return <>{highlight(text, terms).map((p, i) => (p.hit ? <mark key={i}>{p.t}</mark> : <span key={i}>{p.t}</span>))}</>;
}

function findNear(entries: Record<string, Entry>, iso: string, radius = 3): Entry | undefined {
  if (entries[iso]) return entries[iso];
  for (let r = 1; r <= radius; r++) {
    const e = entries[addDays(iso, -r)] ?? entries[addDays(iso, r)];
    if (e) return e;
  }
}

function ThatDay() {
  const { entries } = useStore().data;
  const t = today();
  const cards = [
    { label: 'I dag for et år siden', iso: addMonths(t, -12) },
    { label: 'For tre måneder siden', iso: addMonths(t, -3) },
    { label: 'For en måned siden', iso: addMonths(t, -1) },
  ]
    .map((c) => ({ ...c, entry: findNear(entries, c.iso) }))
    .filter((c): c is typeof c & { entry: Entry } => !!c.entry);

  if (!cards.length) return null;
  return (
    <div className="memory-cards">
      {cards.map((c) => (
        <button key={c.label} className="card tappable memory-card" onClick={() => go(`husk/dag/${c.entry.date}`)}>
          <span className="tiny muted">{c.label}{c.entry.date !== c.iso ? ' (cirka)' : ''}</span>
          {c.entry.photos?.[0] && <PhotoImg id={c.entry.photos[0]} className="memory-photo" alt="" />}
          <span className="when">{formatFull(c.entry.date)}</span>
          <span className="serif small" style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.entry.text}</span>
          <span style={{ marginTop: 'auto' }}><MoodTag mood={c.entry.mood} /></span>
        </button>
      ))}
    </div>
  );
}

/** Ét søgefelt for det hele: dage, noter, mennesker og huskeliste, og "Spørg Claude" med samme ord. */
function Search() {
  const data = useStore().data;
  const [q, setQ] = useState('');
  const [allDays, setAllDays] = useState(false);
  const entries = useMemo(() => Object.values(data.entries), [data.entries]);
  const local = useMemo(() => localSearch(q, entries), [q, entries]);
  const canAI = aiReady(data);
  const terms = tokenize(q);
  const notes = useMemo(() => rankByTerms(Object.values(data.notes), terms, (n) => n.title, (n) => `${n.text}\n${(n.labels ?? []).join(' ')}`).slice(0, 5), [data.notes, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const people = useMemo(() => rankByTerms(Object.values(data.people), terms, (p) => p.name, (p) => `${p.relation ?? ''}\n${p.important}\n${p.notes.map((x) => x.text).join('\n')}`).slice(0, 5), [data.people, q]); // eslint-disable-line react-hooks/exhaustive-deps
  const todos = rankByTerms(Object.values(data.todos).filter((t) => !t.doneAt), terms, (t) => t.text, () => '').slice(0, 5);
  const days = allDays ? local : local.slice(0, 5);
  const nothing = q.trim() && !local.length && !notes.length && !people.length && !todos.length;

  return (
    <div className="stack-sm">
      <form className="search-bar" role="search" onSubmit={(e) => { e.preventDefault(); if (canAI && q.trim()) askSoon(q.trim()); }}>
        <span className="search-ico" aria-hidden="true">{Icon.search}</span>
        <input type="search" className="grow" value={q} onChange={(e) => { setQ(e.target.value); setAllDays(false); }}
          placeholder={canAI ? 'Søg eller spørg …' : 'Søg i dagbogen …'} aria-label="Søg eller spørg" enterKeyHint={canAI ? 'send' : 'search'} />
        {canAI && !q.trim() && (
          <button type="button" className="search-ask" onClick={() => go('spoerg')} aria-label="Spørg dagbogen">
            <span style={{ width: 20, height: 20, display: 'inline-flex' }}>{Icon.sparkle}</span>
          </button>
        )}
      </form>
      {canAI && q.trim() && (
        <button className="ask-row" onClick={() => askSoon(q.trim())}>
          <span style={{ width: 20, height: 20, display: 'inline-flex', flex: 'none' }}>{Icon.sparkle}</span>
          <span className="grow">Spørg Claude: <strong>"{q.trim()}"</strong></span>
          <span aria-hidden="true">›</span>
        </button>
      )}
      {nothing && <p className="small muted" style={{ padding: '4px 2px' }}>Ingen ord fundet.{canAI ? ' Claude kan søge efter betydningen.' : ''}</p>}
      {todos.length > 0 && (
        <div className="stack-sm"><h3>Huskeliste</h3><div className="card list" style={{ padding: '0 16px' }}>
          {todos.map((t) => <button key={t.id} className="list-item" onClick={() => go(`huskeliste/${t.id}`)}><span>☐ <Highlighted text={t.text} terms={terms} /></span></button>)}
        </div></div>
      )}
      {notes.length > 0 && (
        <div className="stack-sm"><h3>Noter</h3><div className="card list" style={{ padding: '0 16px' }}>
          {notes.map((n) => (
            <button key={n.id} className="list-item" onClick={() => go(`noter/${n.id}`)}>
              <strong><Highlighted text={n.title} terms={terms} /></strong>
              <span className="small muted"><Highlighted text={excerpt(n.text, terms, 120)} terms={terms} /></span>
            </button>
          ))}
        </div></div>
      )}
      {people.length > 0 && (
        <div className="stack-sm"><h3>Mennesker</h3><div className="card list" style={{ padding: '0 16px' }}>
          {people.map((p) => <button key={p.id} className="list-item" onClick={() => go(`mennesker/${p.id}`)}><strong>{p.name}</strong>{p.relation && <span className="small muted">{p.relation}</span>}</button>)}
        </div></div>
      )}
      {local.length > 0 && (
        <div className="stack-sm"><h3>Dage · {local.length}</h3><div className="card list" style={{ padding: '0 16px' }}>
          {days.map((h) => (
            <button key={h.entry.date} className="list-item" onClick={() => go(`husk/dag/${h.entry.date}`)}>
              <div className="row between"><span className="small">{formatShort(h.entry.date)}</span><MoodTag mood={h.entry.mood} /></div>
              <span className="small serif"><Highlighted text={excerpt(h.entry.text, h.terms)} terms={h.terms} /></span>
            </button>
          ))}
          {local.length > days.length && <button className="today-later" onClick={() => setAllDays(true)}>Vis alle {local.length} dage ›</button>}
        </div></div>
      )}
    </div>
  );
}

function HubRow({ icon, title, text, onClick, dot }: { icon: ReactNode; title: string; text: string; onClick: () => void; dot?: boolean }) {
  return (
    <button className="list-item hub-row" onClick={onClick}>
      <span className="hub-ico">{icon}</span>
      <span className="grow"><strong style={{ display: 'block' }}>{title}</strong><span className="small muted">{text}</span></span>
      {dot && <span className="dot" style={{ position: 'static' }} aria-label="Nyt" />}
      <span style={{ width: 18, height: 18, display: 'inline-flex', flex: 'none' }} className="muted">{Icon.chevronRight}</span>
    </button>
  );
}

export function MemoryScreen() {
  const { data, inbox } = useStore();
  const inboxCount = inbox.filter((i) => i.done).length;
  const empty = Object.keys(data.entries).length === 0;
  const weekDot = waiting(data).week;
  const written = Object.keys(data.entries).sort();
  const years = written.length ? [...new Set([written[0].slice(0, 4), written[written.length - 1].slice(0, 4)])].join('–') : '';
  return (
    <div className="stack" style={{ gap: 24 }}>
      <Header title="Husk" />
      <Search />
      {empty && <p className="muted">Her samles dine minder, når du er begyndt at skrive.</p>}
      {!empty && (
        <button className="card tappable overview-card" onClick={() => go('husk/overblik')}>
          <span className="note-ico" style={{ background: 'var(--surface)' }}>
            <span style={{ width: 22, height: 22, display: 'inline-flex', color: 'var(--accent)' }}>{Icon.grid}</span>
          </span>
          <span className="grow">
            <strong style={{ display: 'block' }}>Overblik</strong>
            <span className="small muted">{written.length} {written.length === 1 ? 'dag' : 'dage'} skrevet · {years}</span>
          </span>
        </button>
      )}
      <ThatDay />
      <div className="card list hub">
        <HubRow icon={Icon.week} title="Ugen" text="Ugeopsummering og tre ord" onClick={() => go('uge')} dot={weekDot} />
        <HubRow icon={Icon.chat} title="Samtaler" text={inboxCount > 0 ? `${inboxCount} ${inboxCount === 1 ? 'ny optagelse venter' : 'nye optagelser venter'}` : 'Resuméer med aftaler og ting at huske'} onClick={() => go('samtale')} dot={inboxCount > 0} />
        <HubRow icon={Icon.people} title="Mennesker" text="Familie, venner og hvad der er vigtigt for dem" onClick={() => go('mennesker')} />
        <HubRow icon={Icon.patterns} title="Mønstre" text="Tanker og mønstre, der går igen" onClick={() => go('moenstre')} />
      </div>
    </div>
  );
}

export function MonthScreen({ id }: { id: string }) {
  const store = useStore();
  const { data } = store;
  const chapter = data.months[id];
  const days = monthEntries(data, id).reverse();
  const canAI = aiReady(data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (chapter && !chapter.seen) store.put('months', id, { ...chapter, seen: true });
  }, [id, chapter]); // eslint-disable-line react-hooks/exhaustive-deps

  const generate = async () => {
    setBusy(true);
    setError('');
    try {
      await store.put('months', id, { ...(await generateMonth(data, id)), seen: true });
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    } finally {
      setBusy(false);
    }
  };

  const monthDone = id < monthId(today());

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back={`husk/overblik/${id.slice(0, 4)}`} />
      <h1>{formatMonth(id)}</h1>

      <section className="stack-sm">
        <h3>{days.length} {days.length === 1 ? 'dag' : 'dage'} skrevet</h3>
        {days.length > 0 && (
          <div className="card agenda">
            {days.map((e) => (
              <button key={e.date} className="agenda-row" onClick={() => go(`husk/dag/${e.date}`)}>
                <span className="agenda-date"><b>{fromISO(e.date).getDate()}</b><span>{WEEKDAYS[fromISO(e.date).getDay()].slice(0, 3)}</span></span>
                <span className="agenda-bar" style={{ background: e.mood ? `var(--mood-${e.mood})` : 'var(--accent)' }} />
                <span className="grow" style={{ minWidth: 0 }}>
                  <span className="small serif" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{e.text}</span>
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="card stack-sm">
        <div className="row between">
          <h3>Månedens kapitel</h3>
          {chapter && <button className="btn ghost small" onClick={() => setEditing((v) => !v)}>{editing ? 'Færdig' : 'Ret'}</button>}
        </div>
        {error && <p className="error">{error}</p>}
        {!chapter && (
          <>
            <p className="small muted">
              {monthDone ? 'Der er intet kapitel for denne måned endnu.' : 'Kapitlet skrives som et udkast, når måneden er slut.'}
            </p>
            <div className="row wrap">
              {canAI && days.length > 0 && (
                <button className="btn" onClick={generate} disabled={busy}>{busy ? <><span className="spinner" /> Skriver …</> : monthDone ? 'Skriv udkast' : 'Skriv udkast allerede nu'}</button>
              )}
              <button className="btn ghost" onClick={() => { store.put('months', id, { id, title: '', text: '', themes: [], generatedAt: Date.now(), edited: true, seen: true }); setEditing(true); }}>Skriv selv</button>
            </div>
          </>
        )}
        {chapter && editing && (
          <div className="stack-sm">
            <input type="text" value={chapter.title} placeholder="Titel" onChange={(e) => store.put('months', id, { ...chapter, title: e.target.value, edited: true })} />
            <textarea rows={10} value={chapter.text} onChange={(e) => store.put('months', id, { ...chapter, text: e.target.value, edited: true })} />
            <input type="text" value={chapter.themes.join(', ')} placeholder="Temaer, adskilt af komma"
              onChange={(e) => store.put('months', id, { ...chapter, themes: e.target.value.split(',').map((s) => s.trim()).filter(Boolean), edited: true })} />
          </div>
        )}
        {chapter && !editing && (
          <>
            {chapter.title && <h2 className="serif">{chapter.title}</h2>}
            <p className="prose">{chapter.text || <span className="muted">Tomt.</span>}</p>
            <div className="chips" style={{ gap: 6 }}>{chapter.themes.map((t) => <span key={t} className="label-chip">{t}</span>)}</div>
            <p className="tiny muted">{chapter.edited ? 'Rettet af dig.' : 'Udkast lavet af Claude – ret frit.'}</p>
            {canAI && !chapter.edited && (
              <button className="btn ghost small" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={generate} disabled={busy}>
                {busy ? 'Skriver …' : 'Skriv nyt udkast'}
              </button>
            )}
          </>
        )}
      </section>

    </div>
  );
}

function DayConversations({ date }: { date: string }) {
  const list = Object.values(useStore().data.conversations).filter((c) => c.date === date);
  if (!list.length) return null;
  return (
    <section className="stack-sm">
      <h3>Samtaler</h3>
      <div className="list">
        {list.map((c) => (
          <button key={c.id} className="list-item" onClick={() => go(`samtale/${c.id}`)}>
            <strong>{c.title}</strong>
          </button>
        ))}
      </div>
    </section>
  );
}

export function DayScreen({ date }: { date: string }) {
  const store = useStore();
  const e = store.data.entries[date];
  if (!e) {
    return (
      <div className="stack">
        <Header back="husk" />
        <p className="muted">Der er ikke skrevet noget denne dag.</p>
        <button className="btn" onClick={() => go(date === today() ? 'skriv' : `skriv/${date}`)}>Skriv om dagen</button>
      </div>
    );
  }
  const good = e.good.filter(Boolean);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back={`husk/maaned/${monthId(date)}`} right={<button className="btn ghost" onClick={() => go(date === today() ? 'skriv' : `skriv/${date}`)}>Ret</button>} />
      <div className="stack-sm">
        <h1>{formatFull(date)}</h1>
        <div className="row wrap" style={{ gap: 12 }}>
          <MoodTag mood={e.mood} />
          {e.tags.map((t) => <span key={t} className="label-chip">{t}</span>)}
        </div>
      </div>
      {e.question && <p className="small muted serif" style={{ fontStyle: 'italic' }}>{e.question}</p>}
      <p className="prose">{e.text}</p>
      <PhotoGallery ids={e.photos ?? []} />
      <DayConversations date={date} />
      {good.length > 0 && (
        <section className="stack-sm">
          <h3>Tre gode ting</h3>
          <ol className="serif" style={{ margin: 0, paddingLeft: 20 }}>{good.map((g, i) => <li key={i}>{g}</li>)}</ol>
        </section>
      )}
      <div style={{ marginTop: 24 }}>
        <DoubleConfirm
          label="Slet denne dag"
          first="Vil du slette denne dag fra dagbogen?"
          second="Er du helt sikker? Det kan ikke fortrydes."
          onConfirm={async () => { await store.remove('entries', date); go(`husk/maaned/${monthId(date)}`); }}
        />
      </div>
    </div>
  );
}

const SHORT_MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** Et helt år: en række pr. måned og en prik pr. dag (farvet efter humør, når der er skrevet). */
export function OverviewScreen({ year: routeYear }: { year?: string }) {
  const { data } = useStore();
  const dates = Object.keys(data.entries).sort();
  const thisYear = today().slice(0, 4);
  const first = dates[0]?.slice(0, 4) ?? thisYear;
  const year = routeYear && /^\d{4}$/.test(routeYear) ? routeYear : thisYear;
  const inYear = dates.filter((d) => d.startsWith(year));
  const perMonth = SHORT_MONTHS.map((_, i) => inYear.filter((d) => d.slice(5, 7) === String(i + 1).padStart(2, '0')).length);
  const best = Math.max(...perMonth);
  const talks = Object.values(data.conversations).filter((c) => c.date.startsWith(year)).length;
  const t = today();

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header back="husk" />
      <h1>Overblik</h1>
      <div className="row between">
        <button className="day-arrow" disabled={year <= first} onClick={() => go(`husk/overblik/${Number(year) - 1}`)} aria-label="Året før">{Icon.chevronLeft}</button>
        <strong className="serif" style={{ fontSize: '1.4rem' }}>{year}</strong>
        <button className="day-arrow" disabled={year >= thisYear} onClick={() => go(`husk/overblik/${Number(year) + 1}`)} aria-label="Året efter">{Icon.chevronRight}</button>
      </div>
      <div className="stat-row">
        <div className="card"><b>{inYear.length}</b><span className="small muted">{inYear.length === 1 ? 'dag' : 'dage'} skrevet</span></div>
        <div className="card"><b>{talks}</b><span className="small muted">{talks === 1 ? 'samtale' : 'samtaler'}</span></div>
        <div className="card"><b>{best ? SHORT_MONTHS[perMonth.indexOf(best)] : '–'}</b><span className="small muted">flest dage</span></div>
      </div>
      <div className="card year-grid">
        {SHORT_MONTHS.map((m, i) => {
          const id = `${year}-${String(i + 1).padStart(2, '0')}`;
          const days = new Date(Number(year), i + 1, 0).getDate();
          return (
            <button key={m} className="month-line" onClick={() => go(`husk/maaned/${id}`)} aria-label={`${formatMonth(id)}: ${perMonth[i]} dage skrevet`}>
              <span className="mn">{m}</span>
              <span className="month-dots">
                {Array.from({ length: days }, (_, d) => {
                  const iso = `${id}-${String(d + 1).padStart(2, '0')}`;
                  const e = data.entries[iso];
                  return <i key={d} className={iso > t ? 'future' : ''} style={e ? { background: e.mood ? `var(--mood-${e.mood})` : 'var(--accent)' } : undefined} />;
                })}
              </span>
              <span className="cnt">{perMonth[i] || ''}</span>
            </button>
          );
        })}
      </div>
      <div className="row wrap tiny muted" style={{ gap: 12 }}>
        <span><i className="legend-dot" style={{ background: 'var(--accent)' }} />skrevet</span>
        {MOODS.map((m) => <span key={m.id}><i className="legend-dot" style={{ background: `var(--mood-${m.id})` }} />{m.label.toLowerCase()}</span>)}
      </div>
    </div>
  );
}
