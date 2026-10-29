import { useEffect, useRef, useState } from 'react';
import { AIError, askDiary, askScope, DEEP_MODEL, focusScope, webLookup, type AskAnswer, type AskMode, type WebFindings } from '../lib/ai';
import { krText, modelName, overLimitText } from '../lib/usage';
import { findPeriod, type Period } from '../lib/period';
import { formatShort, today } from '../lib/dates';
import { speechInputAvailable, startDictation } from '../lib/device';
import { aiReady } from '../lib/generate';
import { useStore } from '../lib/store';
import type { ChatTurn } from '../lib/types';
import { go, Header, Icon } from '../ui';
import { ProposalCard } from './Proposal';

interface Turn {
  question: string;
  answer: AskAnswer;
  period: Period | null;
  shown: string; // hvad der blev sendt med, fx "januar 2026 · 23 dage"
  web?: WebFindings | null; // det, der blev slået op på nettet
  focused?: boolean; // kun det, der passede til ordene, blev sendt med
  full?: boolean; // "Søg i hele dagbogen"
  deep?: boolean; // "Svar grundigere" (Opus)
}

const MODES: Array<{ id: AskMode; label: string; hint: string }> = [
  { id: 'diary', label: '📔 Dagbogen', hint: 'Kun det, du har skrevet. Grundig.' },
  { id: 'web', label: '🌐 + Nettet', hint: 'Slår også op på nettet, fx vejr og åbningstider. Koster lidt mere.' },
  { id: 'fast', label: '⚡ Hurtig', hint: 'Korte spørgsmål. Hurtigere og billigere.' },
];

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function savedMode(): AskMode {
  try {
    const m = localStorage.getItem('dagbog-ask-mode');
    return m === 'web' || m === 'fast' ? m : 'diary';
  } catch {
    return 'diary';
  }
}

const IDEAS = [
  'Hvad lavede jeg i januar?',
  'Hvornår var jeg sidst hos lægen, og hvad blev der sagt?',
  'Hvilke aftaler har jeg de næste uger?',
  'Hvad har gjort mig glad det sidste halve år?',
  'Lav en pakkeliste til Fanø',
  'Lav en pakkeliste til sommerhuset ud fra Fanø-listen og det, jeg plejer at glemme',
  'Hvad skal jeg huske før besøget hos mine forældre?',
  'Hvad har jeg skrevet, at jeg skal gøre, men ikke har gjort?',
];

// Et spørgsmål, der skal stilles, når Spørg dagbogen åbnes (fx "Gaveidéer" fra Skriv-siden)
let pending: string | null = null;
export function askSoon(question: string) {
  pending = question;
  go('spoerg');
}

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
  const [mode, setModeState] = useState<AskMode>(savedMode);
  const [phase, setPhase] = useState('');
  const setMode = (m: AskMode) => {
    setModeState(m);
    try { localStorage.setItem('dagbog-ask-mode', m); } catch { /* ikke afgørende */ }
  };
  const bottom = useRef<HTMLDivElement>(null);
  // Tal i stedet for at skrive, fx i bilen
  const [listening, setListening] = useState(false);
  const stopMic = useRef<(() => void) | null>(null);
  useEffect(() => () => stopMic.current?.(), []);
  const toggleMic = () => {
    if (listening) return stopMic.current?.();
    setError('');
    setListening(true);
    const base = question && !/\s$/.test(question) ? `${question} ` : question;
    stopMic.current = startDictation(
      (final, interim) => setQuestion(base + [final, interim].filter(Boolean).join(' ')),
      (err) => {
        setListening(false);
        stopMic.current = null;
        if (err) setError(err);
      },
    );
  };
  const canAI = aiReady(data);

  const ask = async (q: string, again?: { full?: boolean; deep?: boolean }) => {
    const text = q.trim();
    if (!text || busy) return;
    // "Søg i hele dagbogen" og "Svar grundigere" stiller det sidste spørgsmål igen
    const before = again ? turns.slice(0, -1) : turns;
    const full = !!again?.full;
    const deep = !!again?.deep;
    setBusy(true);
    setError('');
    try {
      const history: ChatTurn[] = before.flatMap((t) => [
        { role: 'user' as const, text: t.question },
        { role: 'assistant' as const, text: t.answer.answer },
      ]);
      // Nævner spørgsmålet ingen periode, gælder den forrige (fx "og hvem var jeg sammen med?").
      const last = before[before.length - 1];
      const period = findPeriod(text, today()) ?? last?.period ?? null;
      // Et opslag ("telefonnummeret til hjemmeplejen") sender kun det, der passer til ordene.
      const focus = period || full ? null : focusScope(data, last?.focused ? `${last.question} ${text}` : text, today());
      const scope = focus ?? askScope(data, period, today());
      let web: WebFindings | null = null;
      if (mode === 'web') {
        setPhase('Claude søger på nettet …');
        web = await webLookup(data.settings, today(), history, text);
      }
      setPhase(mode === 'fast' ? 'Claude svarer …' : 'Claude læser din dagbog …');
      // Opslag i få noter klares af den billige model; "Svar grundigere" bruger Opus.
      const model = deep ? DEEP_MODEL : focus && mode === 'diary' ? data.settings.ai.searchModel : undefined;
      const answer = await askDiary(data.settings, scope, today(), history, text, mode, web, model);
      const next = [...before, { question: text, answer, period, shown: scope.shown, web, focused: !!focus, full, deep }];
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

  useEffect(() => {
    if (!pending) return;
    const q = pending;
    pending = null;
    ask(q);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      {canAI && overLimitText(data.usage, data.settings.ai.limitKr) && (
        <button className="notice small" style={{ textAlign: 'left' }} onClick={() => go('forbrug')}>{overLimitText(data.usage, data.settings.ai.limitKr)} Se forbrug ›</button>
      )}
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
          <p className="tiny muted">Læste: {t.shown}{data.settings.ai.showCost && t.answer.cost ? ` · ≈ ${krText(t.answer.cost.usd)} · ${modelName(t.answer.cost.model)}` : ''}</p>
          {i === turns.length - 1 && (t.focused || !t.deep) && (
            <div className="row wrap" style={{ gap: 4 }}>
              {t.focused && <button className="btn ghost small" disabled={busy} onClick={() => ask(t.question, { full: true })}>Søg i hele dagbogen</button>}
              {!t.deep && <button className="btn ghost small" disabled={busy} onClick={() => ask(t.question, { full: t.full, deep: true })}>Svar grundigere</button>}
            </div>
          )}
          {t.web && t.web.links.length > 0 && (
            <div className="stack-sm" style={{ gap: 6 }}>
              <span className="proposal-field">Fra nettet</span>
              {t.web.links.map((l) => (
                <a key={l.url} className="web-src" href={l.url} target="_blank" rel="noopener noreferrer">
                  <span className="ico">🌐</span>
                  <span className="grow"><strong>{host(l.url)}</strong> · {l.title}</span>
                </a>
              ))}
            </div>
          )}
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
          <div className="seg-chips" role="group" aria-label="Hvordan skal Claude svare?">
            {MODES.map((m) => (
              <button key={m.id} type="button" className={`chip ${mode === m.id ? 'on' : ''}`} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
            ))}
          </div>
          <p className="tiny muted" style={{ margin: 0 }}>{MODES.find((m) => m.id === mode)?.hint}</p>
          <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)}
            placeholder={turns.length ? 'Spørg videre …' : 'Spørg eller bed om noget …'} aria-label="Spørgsmål" />
          {error && <p className="error">{error}</p>}
          <div className="row" style={{ alignItems: 'center' }}>
            <button className="btn primary" disabled={busy || !question.trim()} onClick={() => stopMic.current?.()}>
              {busy ? <><span className="spinner" /> {phase || 'Claude tænker …'}</> : <><span style={{ width: 18, height: 18, display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}>{Icon.sparkle}</span>Spørg</>}
            </button>
            {speechInputAvailable() && !busy && (
              <button type="button" className={`icon-btn mic ${listening ? 'on' : ''}`} onClick={toggleMic} aria-label={listening ? 'Stop' : 'Indtal spørgsmålet'}>
                <span style={{ width: 22, height: 22, display: 'inline-flex' }}>{listening ? Icon.stop : Icon.mic}</span>
              </button>
            )}
          </div>
        </form>
      )}
      <div ref={bottom} />
    </div>
  );
}
