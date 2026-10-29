import { useEffect, useRef, useState } from 'react';
import { AIError, talkContext, talkDraft, talkNext, type TalkDraft, type TalkLine } from '../lib/ai';
import { today } from '../lib/dates';
import { speak, speechInputAvailable, speechOutputAvailable, startDictation } from '../lib/device';
import { useStore } from '../lib/store';
import { MOODS, type Entry, type MoodId } from '../lib/types';
import { go, Header, Icon } from '../ui';
import { AddTodoButton } from './Todos';

/** Højst så mange svar, før Claude skriver dagen. */
const MAX_ANSWERS = 3;
const FIRST = 'Hvordan har din dag været?';

function loudSaved(): boolean {
  try {
    return localStorage.getItem('dagbog-tal-hoejt') !== 'nej';
  } catch {
    return true;
  }
}

/** Tal med dagbogen: fortæl om dagen, Claude spørger ind og skriver dagen. */
export function TalkScreen() {
  const store = useStore();
  const { data } = store;
  const date = today();
  const [lines, setLines] = useState<TalkLine[]>([{ who: 'claude', text: FIRST }]);
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [loud, setLoudState] = useState(loudSaved);
  const [draft, setDraft] = useState<TalkDraft | null>(null);
  const stopMic = useRef<(() => void) | null>(null);
  // Hvad der sker, når talegenkendelsen stopper
  const onStop = useRef<'answer' | 'skip' | 'finish' | 'cancel'>('answer');
  const stopVoice = useRef<(() => void) | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const linesRef = useRef(lines);
  useEffect(() => { linesRef.current = lines; }, [lines]);
  const context = useRef('');
  const loudRef = useRef(loud);
  useEffect(() => { loudRef.current = loud; }, [loud]);

  const setLoud = (v: boolean) => {
    setLoudState(v);
    if (!v) stopVoice.current?.();
    try { localStorage.setItem('dagbog-tal-hoejt', v ? 'ja' : 'nej'); } catch { /* ikke afgørende */ }
  };

  const answers = lines.filter((l) => l.who === 'me').length;

  const stopAll = () => {
    onStop.current = 'cancel';
    stopMic.current?.();
    stopMic.current = null;
    stopVoice.current?.();
    stopVoice.current = null;
  };
  useEffect(() => stopAll, []);
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [lines, heard, busy]);

  /** Lyt efter svaret. Når talegenkendelsen stopper (pause eller tryk), sendes det. */
  const listen = () => {
    if (!speechInputAvailable()) return setError('Telefonen kan ikke lytte her. Skriv i stedet på Skriv-siden.');
    setError('');
    setHeard('');
    setListening(true);
    onStop.current = 'answer';
    let said = '';
    stopMic.current = startDictation(
      (final, interim) => {
        said = final;
        setHeard([final, interim].filter(Boolean).join(' '));
      },
      (err) => {
        setListening(false);
        stopMic.current = null;
        setHeard('');
        const act = onStop.current;
        onStop.current = 'answer';
        if (err) return setError(err);
        if (act === 'cancel') return;
        if (act === 'skip') return answer('', true);
        if (act === 'finish') return write(said.trim() ? [...linesRef.current, { who: 'me', text: said.trim() }] : linesRef.current);
        if (said.trim()) answer(said.trim());
      },
    );
  };

  /** Stil spørgsmålet (højt, hvis slået til), og lyt bagefter. */
  const ask = (q: string) => {
    if (loudRef.current && speechOutputAvailable()) stopVoice.current = speak(q, () => { stopVoice.current = null; listen(); });
    else listen();
  };

  useEffect(() => {
    context.current = talkContext(data, date);
    ask(FIRST);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function answer(text: string, skipped = false) {
    const next: TalkLine[] = [...linesRef.current, { who: 'me', text: skipped ? '(Vil ikke svare på det.)' : text }];
    setLines(next);
    const count = next.filter((l) => l.who === 'me').length;
    if (count >= MAX_ANSWERS) return write(next);
    setBusy('Claude tænker …');
    try {
      const q = await talkNext(data.settings, context.current, next, date);
      if (!q) return write(next);
      setLines([...next, { who: 'claude', text: q }]);
      setBusy('');
      ask(q);
    } catch (e) {
      setBusy('');
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    }
  }


  async function write(all: TalkLine[]) {
    stopAll();
    if (!all.some((l) => l.who === 'me' && !l.text.startsWith('('))) return go('skriv');
    setBusy('Claude skriver din dag …');
    try {
      setDraft(await talkDraft(data.settings, all, data.settings.tags, date));
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    } finally {
      setBusy('');
    }
  }


  const save = async () => {
    if (!draft?.text.trim()) return;
    // Lægges efter det, der allerede er skrevet i dag (også en kladde)
    const old: Partial<Entry> | null = data.draft?.date === date ? data.draft : data.entries[date] ?? null;
    const now = Date.now();
    const entry: Entry = {
      date,
      text: [old?.text?.trim(), draft.text.trim()].filter(Boolean).join('\n\n'),
      mood: (old?.mood ?? (draft.mood || null)) as MoodId | null,
      tags: [...new Set([...(old?.tags ?? []), ...draft.tags])],
      good: old?.good ?? [],
      photos: old?.photos ?? [],
      question: data.entries[date]?.question,
      createdAt: data.entries[date]?.createdAt ?? now,
      updatedAt: now,
    };
    await store.put('entries', date, entry);
    if (data.draft) await store.saveDraft(null);
    go('skriv');
  };

  if (draft) {
    const set = (patch: Partial<TalkDraft>) => setDraft({ ...draft, ...patch });
    return (
      <div className="stack" style={{ gap: 16 }}>
        <Header back="skriv" />
        <div className="stack-sm" style={{ gap: 2 }}>
          <h1>Din dag</h1>
          <span className="small muted">Skrevet ud fra det, du fortalte</span>
        </div>
        <textarea className="talk-entry" rows={8} value={draft.text} onChange={(e) => set({ text: e.target.value })} aria-label="Dagens tekst" />
        <div className="chips">
          {MOODS.map((m) => <button key={m.id} className={`chip ${draft.mood === m.id ? 'on' : ''}`} onClick={() => set({ mood: draft.mood === m.id ? '' : m.id })}>{m.label}</button>)}
        </div>
        <div className="chips">
          {data.settings.tags.map((t) => <button key={t} className={`chip ${draft.tags.includes(t) ? 'on' : ''}`} onClick={() => set({ tags: draft.tags.includes(t) ? draft.tags.filter((x) => x !== t) : [...draft.tags, t] })}>{t}</button>)}
        </div>
        {draft.todos.length > 0 && (
          <div className="card stack-sm">
            {draft.todos.map((t) => <div key={t} className="row between" style={{ alignItems: 'center', gap: 8 }}><span>☐ {t}</span><AddTodoButton text={t} from={`Fortalt ${date}`} /></div>)}
          </div>
        )}
        {error && <p className="error">{error}</p>}
        <button className="btn primary block" disabled={!draft.text.trim()} onClick={save}>Gem dagen</button>
        <button className="btn block" onClick={() => { setDraft(null); const q = 'Er der mere, du vil fortælle?'; setLines([...lines, { who: 'claude', text: q }]); ask(q); }}>Tal videre</button>
      </div>
    );
  }

  return (
    <div className="stack talk" style={{ gap: 10 }}>
      <Header back="skriv" right={speechOutputAvailable() ? (
        <button className={`chip ${loud ? 'on' : ''}`} onClick={() => setLoud(!loud)} aria-pressed={loud}>{loud ? '🔊 Læs højt' : '🔇 Læs ikke højt'}</button>
      ) : undefined} />
      {lines.map((l, i) => <p key={i} className={`talk-bubble ${l.who}`}>{l.text}</p>)}
      {heard && <p className="talk-bubble me live">{heard}</p>}
      {busy && <p className="small muted"><span className="spinner" /> {busy}</p>}
      {error && <p className="error">{error}</p>}
      <div ref={bottom} style={{ height: 190 }} />
      <div className="talk-dock">
        <button className={`talk-mic ${listening ? 'on' : ''}`} disabled={!!busy} onClick={() => (listening ? stopMic.current?.() : (stopVoice.current?.(), listen()))}
          aria-label={listening ? 'Færdig med at tale' : 'Tal'}>
          <span style={{ width: 34, height: 34, display: 'inline-flex' }}>{listening ? Icon.stop : Icon.mic}</span>
        </button>
        <span className="small muted">{listening ? 'Jeg lytter … tryk, når du er færdig' : busy ? '' : 'Tryk for at tale'}</span>
        <div className="row" style={{ gap: 8, width: '100%' }}>
          <button className="btn grow" disabled={!!busy} onClick={() => {
            stopVoice.current?.();
            if (stopMic.current) { onStop.current = 'skip'; stopMic.current(); } else answer('', true);
          }}>Spring over</button>
          <button className="btn grow" disabled={!!busy || (answers === 0 && !heard)} onClick={() => {
            if (stopMic.current) { onStop.current = 'finish'; stopMic.current(); } else write(linesRef.current);
          }}>Færdig</button>
        </div>
      </div>
    </div>
  );
}
