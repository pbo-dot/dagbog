import { useEffect, useMemo, useState } from 'react';
import { AIError, searchDiary, type AIHit } from '../lib/ai';
import { addDays, addMonths, formatFull, formatMonth, formatShort, fromISO, monthId, today, WEEKDAYS } from '../lib/dates';
import { aiReady, generateMonth, monthEntries } from '../lib/generate';
import { excerpt, highlight, localSearch, tokenize } from '../lib/search';
import { waiting } from '../lib/device';
import { useStore } from '../lib/store';
import { MOODS, type Entry } from '../lib/types';
import { DoubleConfirm, go, Header, Icon, MoodTag, PhotoGallery, PhotoImg } from '../ui';

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

function Search() {
  const data = useStore().data;
  const [q, setQ] = useState('');
  const [aiHits, setAiHits] = useState<AIHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const entries = useMemo(() => Object.values(data.entries), [data.entries]);
  const local = useMemo(() => localSearch(q, entries), [q, entries]);
  const canAI = aiReady(data);

  useEffect(() => setAiHits(null), [q]);

  const runAI = async () => {
    if (!q.trim() || !canAI) return;
    setBusy(true);
    setError('');
    try {
      setAiHits((await searchDiary(data.settings, q, entries)).filter((h) => data.entries[h.date]));
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Søgningen fejlede.');
    } finally {
      setBusy(false);
    }
  };

  const terms = tokenize(q);
  return (
    <div className="stack-sm">
      <form className="row" onSubmit={(e) => { e.preventDefault(); runAI(); }}>
        <input type="search" className="grow" value={q} onChange={(e) => setQ(e.target.value)} placeholder='Fx "Aarhus" eller "hvornår var jeg træt af arbejdet"' enterKeyHint="search" />
        {canAI && (
          <button className="icon-btn" aria-label="Søg med AI" disabled={!q.trim() || busy} title="Søg med naturligt sprog">
            {busy ? <span className="spinner" /> : <span style={{ width: 20, height: 20, display: 'inline-flex' }}>{Icon.sparkle}</span>}
          </button>
        )}
      </form>
      {canAI && q.trim() && !aiHits && !busy && <p className="tiny muted">Tryk på stjernen eller Enter for at lade AI søge efter betydning, ikke kun ord.</p>}
      {error && <p className="error">{error}</p>}

      {aiHits && (
        <div className="list">
          {aiHits.length === 0 && <p className="small muted" style={{ padding: '8px 0' }}>AI fandt ingen dage, der passer.</p>}
          {aiHits.map((h) => {
            const e = data.entries[h.date];
            const text = h.quotes[0] && e.text.includes(h.quotes[0]) ? excerpt(e.text, h.quotes, 220) : excerpt(e.text, terms);
            return (
              <button key={h.date} className="list-item" onClick={() => go(`husk/dag/${h.date}`)}>
                <div className="row between"><span className="small">{formatShort(h.date)}</span><MoodTag mood={e.mood} /></div>
                <span className="small serif"><Highlighted text={text} terms={h.quotes.length ? h.quotes : terms} /></span>
              </button>
            );
          })}
        </div>
      )}

      {!aiHits && q.trim() && (
        <div className="list">
          {local.length === 0 && <p className="small muted" style={{ padding: '8px 0' }}>Ingen dage med de ord.{canAI ? ' Prøv AI-søgning.' : ''}</p>}
          {local.map((h) => (
            <button key={h.entry.date} className="list-item" onClick={() => go(`husk/dag/${h.entry.date}`)}>
              <div className="row between"><span className="small">{formatShort(h.entry.date)}</span><MoodTag mood={h.entry.mood} /></div>
              <span className="small serif"><Highlighted text={excerpt(h.entry.text, h.terms)} terms={h.terms} /></span>
              {h.entry.tags.length > 0 && <span className="tiny muted">{h.entry.tags.join(' · ')}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
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
      <button className="card tappable" onClick={() => go('uge')}>
        <div className="row between">
          <div className="row" style={{ gap: 8 }}>
            <span style={{ width: 20, height: 20, display: 'inline-flex', color: 'var(--accent)' }}>{Icon.week}</span>
            <strong>Ugen</strong>
          </div>
          {weekDot && <span className="dot" style={{ position: 'static' }} aria-label="Ny ugeopsummering" />}
        </div>
        <span className="small muted" style={{ display: 'block' }}>Ugeopsummering og tre ord</span>
      </button>
      {aiReady(data) && (
        <button className="card tappable" onClick={() => go('spoerg')}>
          <div className="row" style={{ gap: 8 }}>
            <span style={{ width: 20, height: 20, display: 'inline-flex' }}>{Icon.sparkle}</span>
            <strong>Spørg dagbogen</strong>
          </div>
          <span className="small muted" style={{ display: 'block' }}>Fx "Hvad lavede jeg i januar?" eller "Hvad sagde lægen sidst?"</span>
        </button>
      )}
      <ThatDay />
      <button className="card tappable" onClick={() => go('huskeliste')}>
        <div className="row between">
          <strong>Huskeliste</strong>
          <span className="tiny muted">{Object.values(data.todos).filter((t) => !t.doneAt).length || 'Ny'}</span>
        </div>
        <span className="small muted" style={{ display: 'block' }}>Ting, der skal gøres, men ikke på et bestemt tidspunkt</span>
      </button>
      <button className="card tappable" onClick={() => go('faste')}>
        <div className="row between">
          <strong>Faste ting</strong>
          <span className="tiny muted">{Object.keys(data.routines).length || 'Ny'}</span>
        </div>
        <span className="small muted" style={{ display: 'block' }}>Medicin, indsprøjtninger og andet på en fast plan</span>
      </button>
      <button className="card tappable" onClick={() => go('mennesker')}>
        <div className="row between">
          <strong>Mennesker</strong>
          <span className="tiny muted">{Object.keys(data.people).length || 'Ny'}</span>
        </div>
        <span className="small muted" style={{ display: 'block' }}>Familie, venner og hvad der er vigtigt for dem</span>
      </button>
      <button className="card tappable" onClick={() => go('samtale')}>
        <div className="row between">
          <strong>Samtaler</strong>
          <span className="tiny muted">{Object.keys(data.conversations).length || 'Ny'}</span>
        </div>
        <span className="small muted" style={{ display: 'block' }}>Resuméer af samtaler med aftaler og ting at huske</span>
        {inboxCount > 0 && <span className="small" style={{ display: 'block', color: 'var(--accent)', marginTop: 4 }}>{inboxCount} {inboxCount === 1 ? 'ny optagelse venter' : 'nye optagelser venter'}</span>}
      </button>
      <section className="stack-sm">
        <h3>Søg</h3>
        <Search />
      </section>
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
