// Idéer under Noter: lær et emne kort for kort, gem gode idéer og citater, og "Kan du huske?".
// Billedforslag: docs/forslag-ideer.png (og -mork.png).
import { useEffect, useRef, useState } from 'react';
import { AIError, rewriteCardAI } from '../lib/ai';
import { aiReady } from '../lib/generate';
import { speak, speechOutputAvailable, stopSpeaking } from '../lib/device';
import {
  activeCourse, allIdeas, answerReview, clearMakeError, dayIdea, dayIdeaHidden, dueReviews, finishedCourses, hideDayIdea,
  dropCourse, hiddenSuggestions, hideSuggestion, ideaForCard, ideaFromShared, seeCard, setCard, SHOWN_SUGGESTIONS, startCourse, SUGGESTIONS, toggleCardIdea, useMakeState,
} from '../lib/ideas';
import { useStore } from '../lib/store';
import type { Course } from '../lib/types';
import { askSoon } from './Ask';
import { go, Icon } from '../ui';

/** Noter | Idéer øverst under Noter-fanen. */
export function NotesTabs({ active }: { active: 'noter' | 'ideer' }) {
  return (
    <div className="plan-tabs" role="tablist" aria-label="Noter eller idéer">
      <button role="tab" aria-selected={active === 'noter'} className={active === 'noter' ? 'on' : ''} onClick={() => go('noter')}>Noter</button>
      <button role="tab" aria-selected={active === 'ideer'} className={active === 'ideer' ? 'on' : ''} onClick={() => go('ideer')}>Idéer</button>
    </div>
  );
}

function CourseCardBig({ c }: { c: Course }) {
  const store = useStore();
  const left = c.cards.length - c.pos;
  return (
    <div className="card idea-course">
      <span className="small muted" style={{ fontWeight: 600 }}>{c.title} · kort {Math.min(c.pos + 1, c.cards.length)} af {c.cards.length}</span>
      <strong className="serif idea-course-title">{c.cards[Math.min(c.pos, c.cards.length - 1)]?.title}</strong>
      <span className="idea-bar"><i style={{ width: `${(c.pos / c.cards.length) * 100}%` }} /></span>
      <div className="row between" style={{ alignItems: 'center', marginTop: 4 }}>
        <span className="small muted">{left} {left === 1 ? 'kort' : 'kort'} tilbage · ca. {Math.max(1, Math.round(left * 0.7))} min</span>
        <button className="btn primary" onClick={() => go(`ideer/emne/${c.id}`)}>{c.pos ? 'Fortsæt' : 'Start'}</button>
      </div>
      <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => { if (confirm(`Drop ${c.title}? Kort, du har gemt, bliver liggende.`)) void dropCourse(store, c.id); }}>Drop emnet</button>
    </div>
  );
}

/** Noter → Idéer */
export function IdeasScreen() {
  const store = useStore();
  const { data } = store;
  const make = useMakeState();
  const [topic, setTopic] = useState('');
  const [writing, setWriting] = useState(false);
  const [nope, setNope] = useState(hiddenSuggestions);
  const [page, setPage] = useState(0);
  const canAI = aiReady(data);
  const pool = SUGGESTIONS.filter((s) => !nope.includes(s) && !Object.values(data.courses).some((c) => c.topic === s));
  const pages = Math.max(1, Math.ceil(pool.length / SHOWN_SUGGESTIONS));
  const shown = pool.slice((page % pages) * SHOWN_SUGGESTIONS, (page % pages + 1) * SHOWN_SUGGESTIONS);
  const active = activeCourse(data);
  const due = dueReviews(data);
  const ideas = allIdeas(data);
  const done = finishedCourses(data);

  // Er et nyt emne lige lavet, så åbn det
  useEffect(() => {
    if (make.madeId && data.courses[make.madeId]?.pos === 0 && !make.busy) {
      const id = make.madeId;
      go(`ideer/emne/${id}`);
    }
  }, [make.madeId, make.busy]); // eslint-disable-line react-hooks/exhaustive-deps

  const start = (t: string) => { setWriting(false); setTopic(''); void startCourse(store, t); };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="header"><h1>Noter</h1></div>
      <NotesTabs active="ideer" />

      {due.length > 0 && (
        <button className="card idea-review-row" onClick={() => go('ideer/husk')}>
          <span className="grow"><strong>Kan du huske?</strong><span className="small muted">{due.length} {due.length === 1 ? 'spørgsmål' : 'spørgsmål'} fra det, du har lært</span></span>
          <span className="btn small">Svar</span>
        </button>
      )}

      {make.busy && (
        <div className="card idea-making">
          <span className="spinner" />
          <span><strong>Claude laver kort om {make.topic} …</strong><span className="small muted">Tager ca. et halvt minut. Du kan godt gå imens.</span></span>
        </div>
      )}
      {make.error && <p className="error small" onClick={clearMakeError}>{make.error}</p>}

      {active && (
        <section className="stack-sm">
          <h3 className="overline">Lærer nu</h3>
          <CourseCardBig c={active} />
        </section>
      )}

      <section className="stack-sm">
        <h3 className="overline">Lær noget nyt</h3>
        {!canAI && <p className="small muted">Kræver din Claude-nøgle under Mere → Indstillinger.</p>}
        <div className="chips">
          {shown.map((s) => (
            <span key={s} className="chip idea-sugg">
              <button disabled={!canAI || make.busy} onClick={() => start(s)}>{s}</button>
              <button className="idea-nope" aria-label={`Fjern forslaget ${s}`} onClick={() => { hideSuggestion(s); setNope(hiddenSuggestions()); }}>×</button>
            </span>
          ))}
          <button className="chip idea-own" disabled={!canAI || make.busy} onClick={() => setWriting(true)}>+ Skriv selv …</button>
        </div>
        {pages > 1 && <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setPage(page + 1)}>Andre forslag</button>}
        {writing && (
          <form className="row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); if (topic.trim()) start(topic); }}>
            <input className="grow" type="text" autoFocus value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Fx Hvordan virker en elbil?" aria-label="Emne" />
            <button className="btn primary" disabled={!topic.trim()}>Lav kort</button>
          </form>
        )}
      </section>

      <section className="stack-sm">
        <h3 className="overline">Mine idéer{ideas.length ? ` · ${ideas.length}` : ''}</h3>
        {!ideas.length && <p className="small muted">Tryk Gem på et kort, eller del en tekst fra Chrome til Dagbog og vælg "Gem som idé".</p>}
        {ideas.map((i) => (
          <div key={i.id} className="idea-item">
            <strong className="serif">{i.title}</strong>
            <p className="serif">{i.text}</p>
            <div className="row between" style={{ alignItems: 'center' }}>
              <span className="tiny muted">{i.source}{i.url ? <> · <a href={i.url} target="_blank" rel="noopener">kilde</a></> : null}</span>
              <button className="link tiny" onClick={() => { if (confirm('Slet idéen?')) void store.remove('ideas', i.id); }}>Slet</button>
            </div>
          </div>
        ))}
      </section>

      {done.length > 0 && (
        <section className="stack-sm">
          <h3 className="overline">Læst færdig</h3>
          {done.map((c) => (
            <button key={c.id} className="card idea-done-row" onClick={() => go(`ideer/emne/${c.id}/0`)}>
              <strong>{c.title}</strong><span className="small muted">{c.cards.length} kort</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

/** Ét emne: kortene ét ad gangen, swipe eller Næste. */
export function CourseScreen({ id, start }: { id: string; start?: number }) {
  const store = useStore();
  const c = store.data.courses[id];
  const [i, setI] = useState(() => (start != null ? start : Math.min(c?.pos ?? 0, (c?.cards.length ?? 1) - 1)));
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [speaking, setSpeaking] = useState(false);
  const touch = useRef<number | null>(null);

  useEffect(() => { if (c) void seeCard(store, id, i); }, [id, i]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => stopSpeaking(), []);
  if (!c) return <div className="stack"><button className="btn" onClick={() => go('ideer')}>‹ Idéer</button><p className="muted">Emnet findes ikke længere.</p></div>;

  const card = c.cards[i];
  const last = i >= c.cards.length - 1;
  const saved = !!ideaForCard(store.data, id, i);
  const goTo = (n: number) => { stopSpeaking(); setSpeaking(false); setError(''); setI(Math.max(0, Math.min(c.cards.length - 1, n))); };
  const rewrite = async (how: 'lettere' | 'dybde') => {
    setBusy(how); setError('');
    try {
      const r = await rewriteCardAI(store.data.settings, c.title, card, how);
      await setCard(store, id, i, { title: r.title, text: r.text });
    } catch (e) { setError(e instanceof AIError ? e.message : 'Noget gik galt.'); }
    setBusy('');
  };
  const read = () => {
    if (speaking) { stopSpeaking(); setSpeaking(false); return; }
    setSpeaking(true);
    speak(`${card.title}. ${card.text}`, () => setSpeaking(false));
  };

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row between" style={{ alignItems: 'center' }}>
        <button className="btn small" onClick={() => go('ideer')}>‹ Idéer</button>
        <span className="muted" style={{ fontWeight: 600 }}>{i + 1} / {c.cards.length}</span>
      </div>
      <article className="idea-big"
        onTouchStart={(e) => { touch.current = e.touches[0].clientX; }}
        onTouchEnd={(e) => {
          const x0 = touch.current; touch.current = null;
          if (x0 == null) return;
          const dx = e.changedTouches[0].clientX - x0;
          if (dx < -60) goTo(i + 1); else if (dx > 60) goTo(i - 1);
        }}>
        <span className="overline">{c.title}</span>
        <h2 className="serif">{card.title}</h2>
        {card.text.split(/\n+/).map((p, k) => <p key={k} className="serif">{p}</p>)}
        <div className="grow" />
        <div className="idea-dots" aria-hidden="true">{c.cards.map((_, k) => <i key={k} className={k === i ? 'on' : k < c.pos ? 'seen' : ''} />)}</div>
        <div className="row wrap" style={{ gap: 8 }}>
          {speechOutputAvailable() && <button className="btn" onClick={read}><span className="ico">{speaking ? Icon.stop : Icon.speaker}</span>{speaking ? 'Stop' : 'Læs op'}</button>}
          <button className={`btn${saved ? ' primary' : ''}`} onClick={() => void toggleCardIdea(store, c, i)}><span className="ico">{saved ? Icon.check : Icon.heart}</span>{saved ? 'Gemt' : 'Gem'}</button>
          <button className="btn" onClick={() => askSoon(`Om "${card.title}" (${c.title}): ${card.text}\n\nFortæl mig mere om det.`)}><span className="ico">{Icon.chat}</span>Spørg Claude</button>
        </div>
      </article>
      {error && <p className="error small">{error}</p>}
      <div className="row between" style={{ alignItems: 'center' }}>
        <button className="btn ghost" disabled={!!busy} onClick={() => void rewrite('lettere')}>{busy === 'lettere' ? 'Skriver …' : 'Lettere'}</button>
        <button className="btn ghost" disabled={!!busy} onClick={() => void rewrite('dybde')}>{busy === 'dybde' ? 'Skriver …' : 'Mere dybde'}</button>
        {last
          ? <button className="btn primary" onClick={() => go('ideer')}>Færdig</button>
          : <button className="btn primary" onClick={() => goTo(i + 1)}>Næste ›</button>}
      </div>
      {!c.doneAt && <button className="link small" style={{ alignSelf: 'center' }} onClick={() => { if (confirm(`Drop ${c.title}? Kort, du har gemt, bliver liggende.`)) { void dropCourse(store, id); go('ideer'); } }}>Drop emnet</button>}
      {last && <p className="small muted center">Godt gået: {c.cards.length} kort om {c.title}. Om et par dage spørger Dagbog, hvad du kan huske.</p>}
    </div>
  );
}

/** Kan du huske? Ét spørgsmål ad gangen; svaret vises først efter et tryk. */
export function ReviewScreen() {
  const store = useStore();
  const [shown, setShown] = useState(false);
  const [count, setCount] = useState(0);
  const due = dueReviews(store.data);
  const total = useRef(due.length + count);
  const d = due[0];

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row between" style={{ alignItems: 'center' }}>
        <button className="btn small" onClick={() => go('ideer')}>‹ Idéer</button>
        {d && <span className="muted" style={{ fontWeight: 600 }}>{count + 1} af {Math.max(total.current, count + 1)} i dag</span>}
      </div>
      {!d ? (
        <div className="card idea-quiz">
          <span className="overline">Kan du huske?</span>
          <h2 className="serif">Det var alt for i dag.</h2>
          <button className="btn primary" onClick={() => go('ideer')}>Til Idéer</button>
        </div>
      ) : (
        <div className="card idea-quiz">
          <span className="overline">Kan du huske? · {d.course.title}</span>
          <h2 className="serif">{d.card.question}</h2>
          {shown ? (
            <>
              <p className="idea-answer serif">{d.card.answer}</p>
              <div className="row wrap" style={{ gap: 8 }}>
                <button className="btn primary" onClick={async () => { await answerReview(store, d.course.id, d.i, true); setShown(false); setCount(count + 1); }}>Det vidste jeg</button>
                <button className="btn" onClick={async () => { await answerReview(store, d.course.id, d.i, false); setShown(false); setCount(count + 1); }}>Igen snart</button>
              </div>
            </>
          ) : (
            <button className="btn primary" onClick={() => setShown(true)}>Vis svar</button>
          )}
        </div>
      )}
      {d && <p className="small muted" style={{ margin: '0 6px' }}>Ingen point og ingen stress, bare lidt gentagelse. Det, du har glemt, kommer igen før.</p>}
    </div>
  );
}

/** Skriv: "Dagens idé" (næste kort i emnet, eller en gemt idé). */
export function DayIdeaCard() {
  const { data } = useStore();
  const [hidden, setHidden] = useState(dayIdeaHidden);
  const d = dayIdea(data);
  if (hidden || !d) return null;
  const hide = () => { hideDayIdea(); setHidden(true); };
  if (d.kind === 'card') {
    const k = d.course.cards[d.i];
    return (
      <div className="day-idea">
        <span className="overline">Dagens idé · {d.course.title} {d.i + 1}/{d.course.cards.length}</span>
        <strong className="serif">{k.title}</strong>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn small" onClick={() => go(`ideer/emne/${d.course.id}`)}>Læs</button>
          <button className="btn ghost small" onClick={hide}>Senere</button>
        </div>
      </div>
    );
  }
  return (
    <div className="day-idea">
      <span className="overline">En af dine idéer</span>
      <strong className="serif">{d.idea.title}</strong>
      <p className="serif small" style={{ margin: 0 }}>{d.idea.text}</p>
      <div className="row" style={{ gap: 6 }}><button className="btn ghost small" onClick={hide}>Skjul i dag</button></div>
    </div>
  );
}

/** Noget delt fra en anden app: gem som idé, som note eller start en samtale. */
export function SharedChooser({ shared, onNote, onTalk }: { shared: { text: string; url?: string; from: string }; onNote: () => void; onTalk: () => void }) {
  const store = useStore();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canAI = aiReady(store.data);
  const long = shared.text.length > 600;
  const asIdea = async () => {
    setBusy(true); setError('');
    try { await ideaFromShared(store, shared.text, shared.url, shared.from); go('ideer'); }
    catch (e) { setError(e instanceof AIError ? e.message : 'Noget gik galt.'); setBusy(false); }
  };
  const idea = <button key="i" className="share-opt" disabled={!canAI || busy} onClick={asIdea}><strong>{busy ? 'Claude laver et kort …' : '✦ Gem som idé'}</strong><span className="small muted">Claude laver et kort på 2–3 linjer</span></button>;
  const note = <button key="n" className="share-opt" disabled={busy} onClick={onNote}><strong>Gem som note</strong><span className="small muted">Hele teksten{shared.url ? ' og linket' : ''}</span></button>;
  const talk = <button key="t" className="share-opt" disabled={busy} onClick={onTalk}><strong>Ny samtale</strong><span className="small muted">Resumé, aftaler og huskepunkter</span></button>;
  return (
    <div className="stack" style={{ gap: 14 }}>
      <h1>Delt med Dagbog</h1>
      <p className="serif share-quote">{shared.text.length > 400 ? `${shared.text.slice(0, 400).trimEnd()} …` : shared.text}</p>
      {/* Lange tekster (fx fra Optager) er oftest en samtale */}
      <div className="stack-sm">{long ? [talk, note, idea] : [idea, note, talk]}</div>
      {error && <p className="error small">{error}</p>}
    </div>
  );
}
