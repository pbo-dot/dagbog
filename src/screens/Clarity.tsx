import { useEffect, useRef, useState } from 'react';
import { AIError, clarityNext, clarityResult, LADDER, talkContext, type Clarity, type ClarityLine } from '../lib/ai';
import { addDays, today } from '../lib/dates';
import { speechInputAvailable, startDictation } from '../lib/device';
import { useStore } from '../lib/store';
import type { Note, Todo } from '../lib/types';
import { go, Header, Icon, uid } from '../ui';
import { CrisisHelp } from './Week';

/** Højst så mange svar fra personen, før Claude laver overblikket. */
const MAX_ANSWERS = 5;
const FIRST = 'Tag en rolig indånding. Fortæl frit, hvad der er sket.';

type PileId = 'facts' | 'assumptions' | 'judgments' | 'feelings' | 'unknown';
interface Card { id: string; text: string; trap?: string }
type Piles = Record<PileId, Card[]>;

const PILES: Array<{ id: PileId; label: string; hint?: string }> = [
  { id: 'facts', label: 'Fakta', hint: '📷 et kamera kunne se det' },
  { id: 'assumptions', label: 'Antagelser', hint: 'tjek dem' },
  { id: 'judgments', label: 'Vurderinger' },
  { id: 'feelings', label: 'Følelser' },
  { id: 'unknown', label: 'Ved det ikke endnu' },
];

interface Session {
  lines: ClarityLine[];
  phase: 'talk' | 'sorted' | 'next';
  result: Clarity | null;
  piles: Piles | null;
  chosen: number[];
}
const fresh = (): Session => ({ lines: [{ who: 'claude', text: FIRST }], phase: 'talk', result: null, piles: null, chosen: [0] });
// Huskes, mens dagbogen er åben, så man kan gå til en note og komme tilbage.
let session: Session = fresh();

const card = (text: string, trap?: string): Card => ({ id: uid(), text, trap: trap || undefined });

function toPiles(r: Clarity): Piles {
  return {
    facts: r.facts.map((t) => card(t)),
    assumptions: r.assumptions.map((a) => card(a.text, a.trap)),
    judgments: r.judgments.map((a) => card(a.text, a.trap)),
    feelings: r.feelings.length ? [card(r.feelings.join(' · '))] : [],
    unknown: r.unknown.map((t) => card(t)),
  };
}

/** Noten, der gemmes: bunkerne, trappen, skridtene og samtalen. */
function noteText(r: Clarity, piles: Piles, steps: string[], lines: ClarityLine[]): string {
  const out: string[] = [];
  for (const p of PILES) {
    const cards = piles[p.id];
    if (!cards.length) continue;
    out.push(`# ${p.label}`, ...cards.map((c) => `• ${c.text}${c.trap ? ` (${c.trap})` : ''}`), '');
  }
  if (r.ladder > 0) out.push('# Konflikttrappen', `Trin ${r.ladder} af 7: ${LADDER[r.ladder - 1]}. ${r.ladderText}`.trim(), '');
  if (steps.length) out.push('# Næste skridt', ...steps.map((s) => `• ${s}`), '');
  if (r.say.trim()) out.push('# Sådan kan du sige det', `"${r.say.trim().replace(/^"|"$/g, '')}"`, '');
  out.push('# Samtalen', ...lines.map((l) => `${l.who === 'claude' ? 'Claude' : 'Mig'}: ${l.text}`));
  return out.join('\n').trim();
}

/** Få overblik: fortæl, Claude spørger ind (og giver ét modspil), sorterer og finder næste skridt. */
export function ClarityScreen() {
  const store = useStore();
  const { data } = store;
  const date = today();
  const [s, setS] = useState<Session>(session);
  const update = (patch: Partial<Session>) => setS((old) => (session = { ...old, ...patch }));
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [moving, setMoving] = useState<string | null>(null);
  const stopMic = useRef<(() => void) | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const context = useRef('');

  useEffect(() => { context.current = talkContext(data, date); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { stopMic.current?.(); }, []);
  useEffect(() => { if (s.phase === 'talk') bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [s.lines, busy, s.phase]);

  const answers = s.lines.filter((l) => l.who === 'me').length;
  const crisis = s.lines.some((l) => l.kind === 'krise') || !!s.result?.crisis;

  const dictate = () => {
    if (listening) return stopMic.current?.();
    setError('');
    const before = input.trim();
    setListening(true);
    stopMic.current = startDictation(
      (final, interim) => setInput([before, final, interim].filter(Boolean).join(' ')),
      (err) => { setListening(false); stopMic.current = null; if (err) setError(err); },
    );
  };

  async function finish(lines: ClarityLine[]) {
    stopMic.current?.();
    if (!lines.some((l) => l.who === 'me')) return;
    setBusy('Claude laver overblikket …');
    try {
      const r = await clarityResult(data.settings, lines, date);
      update({ lines, result: r, piles: toPiles(r), phase: 'sorted', chosen: r.steps.length ? [0] : [] });
      window.scrollTo(0, 0);
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    } finally {
      setBusy('');
    }
  }

  async function send() {
    stopMic.current?.();
    const text = input.trim();
    if (!text || busy) return;
    const next: ClarityLine[] = [...s.lines, { who: 'me', text }];
    update({ lines: next });
    setInput('');
    setError('');
    if (next.filter((l) => l.who === 'me').length >= MAX_ANSWERS) return finish(next);
    setBusy('Claude tænker …');
    try {
      const q = await clarityNext(data.settings, context.current, next, date);
      setBusy('');
      if (!q) return finish(next);
      update({ lines: [...next, q] });
    } catch (e) {
      setBusy('');
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    }
  }

  const steps = (n: number) => (
    <div className="clarity-steps" aria-label={`Trin ${n} af 3`}>{[1, 2, 3].map((i) => <i key={i} className={i <= n ? 'on' : ''} />)}</div>
  );

  // ---------- Fortæl ----------
  if (s.phase === 'talk' || !s.result || !s.piles) {
    return (
      <div className="stack clarity" style={{ gap: 10 }}>
        <Header back="skriv" right={answers > 0 && !busy ? <button className="chip" onClick={() => finish(input.trim() ? [...s.lines, { who: 'me', text: input.trim() }] : s.lines)}>Hurtig</button> : undefined} />
        {steps(1)}
        {s.lines.map((l, i) => (
          <div key={i} className={`talk-bubble ${l.who}${l.kind === 'modspil' ? ' mod' : ''}`}>
            {l.kind === 'modspil' && <b className="mod-label">Modspil</b>}
            {l.text.replace(/\*/g, '')}
          </div>
        ))}
        {s.lines.some((l) => l.kind === 'krise') && <CrisisHelp />}
        {busy && <p className="small muted"><span className="spinner" /> {busy}</p>}
        {error && <p className="error">{error}</p>}
        <div ref={bottom} />
        <div className="clarity-compose card">
          <textarea rows={3} value={input} onChange={(e) => setInput(e.target.value)} placeholder={listening ? 'Jeg lytter …' : 'Skriv eller tal …'} aria-label="Dit svar" disabled={!!busy} />
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            {speechInputAvailable() && (
              <button className={`clarity-mic${listening ? ' on' : ''}`} onClick={dictate} disabled={!!busy} aria-label={listening ? 'Stop med at lytte' : 'Tal'}>
                <span style={{ width: 24, height: 24, display: 'inline-flex' }}>{listening ? Icon.stop : Icon.mic}</span>
              </button>
            )}
            <button className="btn primary grow" disabled={!!busy || !input.trim()} onClick={send}>Send</button>
          </div>
        </div>
        {answers > 0 && !busy && <button className="btn ghost block" onClick={() => finish(input.trim() ? [...s.lines, { who: 'me', text: input.trim() }] : s.lines)}>Færdig, vis overblikket</button>}
      </div>
    );
  }

  const r = s.result;
  const piles = s.piles;

  // ---------- Sorteret ----------
  if (s.phase === 'sorted') {
    const move = (cardId: string, to: PileId | null) => {
      const next = Object.fromEntries(PILES.map((p) => [p.id, piles[p.id].filter((c) => c.id !== cardId)])) as Piles;
      const c = PILES.flatMap((p) => piles[p.id]).find((x) => x.id === cardId);
      if (c && to) next[to] = [...next[to], c];
      update({ piles: next });
      setMoving(null);
    };
    return (
      <div className="stack clarity" style={{ gap: 10 }}>
        <Header back="skriv" right={<button className="chip" onClick={() => update({ phase: 'talk', result: null, piles: null })}>Tal videre</button>} />
        {steps(2)}
        <h1>{r.title || 'Overblik'}</h1>
        {crisis && <CrisisHelp />}
        {PILES.map((p) => piles[p.id].length > 0 && (
          <section key={p.id} className={`pile pile-${p.id}`}>
            <h3>{p.label}{p.hint && <span>{p.hint}</span>}</h3>
            {piles[p.id].map((c) => (
              <div key={c.id}>
                <button className="pile-card" onClick={() => setMoving(moving === c.id ? null : c.id)} aria-expanded={moving === c.id}>
                  {c.text}{c.trap && <span className="trap">{c.trap}</span>}
                </button>
                {moving === c.id && (
                  <div className="pile-move">
                    <span className="tiny muted">Flyt til</span>
                    {PILES.filter((x) => x.id !== p.id).map((x) => <button key={x.id} className="chip" onClick={() => move(c.id, x.id)}>{x.label}</button>)}
                    <button className="chip" onClick={() => move(c.id, null)}>Fjern</button>
                  </div>
                )}
              </div>
            ))}
          </section>
        ))}
        <p className="tiny muted" style={{ textAlign: 'center' }}>Tryk på et kort for at flytte det</p>
        <button className="btn primary block" onClick={() => { update({ phase: 'next' }); window.scrollTo(0, 0); }}>Næste skridt</button>
      </div>
    );
  }

  // ---------- Næste skridt ----------
  const toggle = (i: number) => update({ chosen: s.chosen.includes(i) ? s.chosen.filter((x) => x !== i) : [...s.chosen, i] });
  const chosenSteps = r.steps.filter((_, i) => s.chosen.includes(i));
  const save = async () => {
    setBusy('Gemmer …');
    const now = Date.now();
    const title = r.title || 'Overblik';
    const note: Note = { id: uid(), title, icon: '🧭', text: noteText(r, piles, chosenSteps, s.lines), labels: ['Overblik'], createdAt: now, updatedAt: now };
    await store.put('notes', note.id, note);
    for (const t of chosenSteps) {
      const todo: Todo = { id: uid(), text: t, from: `Overblik: ${title}`, createdAt: now };
      await store.put('todos', todo.id, todo);
    }
    const follow: Todo = { id: uid(), text: `Hvordan gik det med ${title}?`, from: 'Få overblik', showFrom: addDays(date, 2), createdAt: now };
    await store.put('todos', follow.id, follow);
    session = fresh();
    setBusy('');
    go(`noter/${note.id}`);
  };
  return (
    <div className="stack clarity" style={{ gap: 12 }}>
      <Header back="skriv" right={<button className="chip" onClick={() => update({ phase: 'sorted' })}>Sorteret</button>} />
      {steps(3)}
      <h1>Næste skridt</h1>
      {crisis && <CrisisHelp />}
      {r.ladder > 0 && (
        <div className="card stack-sm">
          <strong className="small">Konflikttrappen · trin {r.ladder} af 7</strong>
          <div className="ladder" aria-hidden="true">
            {LADDER.map((_, i) => <i key={i} className={i + 1 === r.ladder ? 'on' : i + 1 < r.ladder ? 'past' : ''} style={{ height: `${22 + i * 13}%` }}>{i + 1 === r.ladder && <em>Her</em>}</i>)}
          </div>
          <div className="row between tiny muted"><span>Uenighed</span><span>Polarisering</span></div>
          <p className="small" style={{ margin: 0 }}><b>{LADDER[r.ladder - 1]}.</b> {r.ladderText}</p>
        </div>
      )}
      {r.steps.length > 0 && (
        <div className="card">
          {r.steps.map((t, i) => (
            <label key={i} className="check-line">
              <input type="checkbox" checked={s.chosen.includes(i)} onChange={() => toggle(i)} />
              <span>{t}</span>
            </label>
          ))}
        </div>
      )}
      {r.say.trim() && (
        <div className="card stack-sm">
          <strong className="small muted">Sådan kan du sige det</strong>
          <p className="clarity-say">"{r.say.trim().replace(/^"|"$/g, '')}"</p>
        </div>
      )}
      {error && <p className="error">{error}</p>}
      <button className="btn primary block" disabled={!!busy} onClick={save}>
        {busy || (chosenSteps.length ? `Gem · ${chosenSteps.length} skridt på huskelisten` : 'Gem som note')}
      </button>
      <p className="tiny muted" style={{ textAlign: 'center', margin: 0 }}>Om 2 dage spørger huskelisten, hvordan det gik.</p>
    </div>
  );
}
