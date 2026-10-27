import { useRef, useState } from 'react';
import { AIError, askDiary, askScope, type AskAI } from '../lib/ai';
import { findPeriod, type Period } from '../lib/period';
import { formatShort, today } from '../lib/dates';
import { aiReady } from '../lib/generate';
import { useStore } from '../lib/store';
import type { ChatTurn } from '../lib/types';
import { go, Header, Icon } from '../ui';
import { ProposalCard } from './Proposal';

interface Turn {
  question: string;
  answer: AskAI;
  period: Period | null;
  shown: string; // hvad der blev sendt med, fx "januar 2026 · 23 dage"
}

const IDEAS = [
  'Hvad lavede jeg i januar?',
  'Hvornår var jeg sidst hos lægen, og hvad blev der sagt?',
  'Hvilke aftaler har jeg de næste uger?',
  'Hvad har gjort mig glad det sidste halve år?',
  'Lav en pakkeliste til Fanø',
];

// Samtalen huskes, mens dagbogen er åben, så man kan kigge på en dag og komme tilbage.
let saved: Turn[] = [];
const remember = (t: Turn[]) => {
  saved = t;
};

/** Spørg dagbogen: Claude svarer ud fra dagbog, samtaler og noter om mennesker. */
export function AskScreen() {
  const { data } = useStore();
  const [turns, setTurns] = useState<Turn[]>(() => saved);
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const bottom = useRef<HTMLDivElement>(null);
  const canAI = aiReady(data);

  const ask = async (q: string) => {
    const text = q.trim();
    if (!text || busy) return;
    setBusy(true);
    setError('');
    try {
      const history: ChatTurn[] = turns.flatMap((t) => [
        { role: 'user' as const, text: t.question },
        { role: 'assistant' as const, text: t.answer.answer },
      ]);
      // Nævner spørgsmålet ingen periode, gælder den forrige (fx "og hvem var jeg sammen med?").
      const period = findPeriod(text, today()) ?? turns[turns.length - 1]?.period ?? null;
      const scope = askScope(data, period, today());
      const answer = await askDiary(data.settings, scope, today(), history, text);
      const next = [...turns, { question: text, answer, period, shown: scope.shown }];
      remember(next);
      setTurns(next);
      setQuestion('');
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: 'smooth' }), 50);
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    remember([]);
    setTurns([]);
    setError('');
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="husk" right={turns.length ? <button className="btn ghost small" onClick={reset}>Nyt spørgsmål</button> : undefined} />
      <h1>Spørg dagbogen</h1>
      {!canAI && <p className="small muted">Kræver AI og en API-nøgle under Indstillinger.</p>}
      {canAI && !turns.length && (
        <>
          <p className="small muted">Spørg om alt, du har skrevet, eller bed om en note, en aftale eller en fast ting.</p>
          <div className="chips">
            {IDEAS.map((q) => <button key={q} className="chip" onClick={() => ask(q)} disabled={busy}>{q}</button>)}
          </div>
        </>
      )}

      {turns.map((t, i) => (
        <section key={i} className="stack-sm">
          <p className="small" style={{ fontWeight: 600 }}>{t.question}</p>
          <p className="prose">{t.answer.answer}</p>
          {(t.answer.proposals ?? []).map((p, j) => <ProposalCard key={j} proposal={p} />)}
          <p className="tiny muted">Læste: {t.shown}</p>
          {t.answer.sources.length > 0 && (
            <div className="list">
              {t.answer.sources.map((s, j) => (
                <button key={j} className="list-item" onClick={() => go(data.entries[s.date] ? `husk/dag/${s.date}` : 'samtale')}>
                  <span className="tiny muted">{/^\d{4}-\d{2}-\d{2}$/.test(s.date) ? formatShort(s.date) : s.date}</span>
                  <span className="small">{s.note}</span>
                </button>
              ))}
            </div>
          )}
        </section>
      ))}
      {turns.length > 0 && <p className="tiny muted">Svarene er lavet af Claude ud fra det, du har skrevet. Tjek dagene, hvis noget er vigtigt.</p>}

      {canAI && (
        <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); ask(question); }}>
          <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)}
            placeholder={turns.length ? 'Spørg videre …' : 'Spørg eller bed om noget …'} aria-label="Spørgsmål" />
          {error && <p className="error">{error}</p>}
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={busy || !question.trim()}>
            {busy ? <><span className="spinner" /> Claude tænker …</> : <><span style={{ width: 18, height: 18, display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}>{Icon.sparkle}</span>Spørg</>}
          </button>
        </form>
      )}
      <div ref={bottom} />
    </div>
  );
}
