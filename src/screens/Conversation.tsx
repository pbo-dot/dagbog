import { useEffect, useRef, useState } from 'react';
import { AIError, summarizeConversation } from '../lib/ai';
import { diaryBlock, matchPeople, personNote, takeSharedText, withConversation } from '../lib/conversation';
import { formatFull, formatShort, today } from '../lib/dates';
import { keepScreenOn, setKeepUnlocked, speechInputAvailable, startLongDictation } from '../lib/device';
import { aiReady } from '../lib/generate';
import { useStore } from '../lib/store';
import type { Conversation } from '../lib/types';
import { DoubleConfirm, go, Header, Icon, Toast, uid } from '../ui';

const lines = (s: string) => s.split('\n').map((l) => l.replace(/^[-–•*]\s*/, '').trim()).filter(Boolean);

function PeopleChips({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const people = Object.values(useStore().data.people).sort((a, b) => a.name.localeCompare(b.name, 'da'));
  if (!people.length) return <p className="tiny muted">Tilføj personer under Mennesker for at knytte samtaler til dem.</p>;
  return (
    <div className="chips">
      {people.map((p) => (
        <button key={p.id} type="button" className={`chip ${value.includes(p.id) ? 'on' : ''}`} aria-pressed={value.includes(p.id)}
          onClick={() => onChange(value.includes(p.id) ? value.filter((x) => x !== p.id) : [...value, p.id])}>
          {p.name}
        </button>
      ))}
    </div>
  );
}

/** Liste over gemte samtaler. */
export function ConversationsScreen() {
  const { conversations, people } = useStore().data;
  const list = Object.values(conversations).sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="husk" />
      <h1>Samtaler</h1>
      <p className="small muted">
        Tryk "Ny samtale" og "Optag samtale", eller optag med Pixel Optager og del teksten til Dagbog (Del → Dagbog).
        Claude laver et resumé med aftaler og ting at huske, og det lægges i dagbogen.
      </p>
      <button className="btn primary" onClick={() => go('samtale/ny')}>Ny samtale</button>
      <div className="list">
        {list.length === 0 && <p className="small muted">Ingen samtaler endnu.</p>}
        {list.map((c) => (
          <button key={c.id} className="list-item" onClick={() => go(`samtale/${c.id}`)}>
            <span className="tiny muted">
              {formatShort(c.date)}
              {c.people.length ? ` · ${c.people.map((id) => people[id]?.name).filter(Boolean).join(', ')}` : ''}
            </span>
            <strong>{c.title}</strong>
            {c.summary && <span className="small muted" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{c.summary}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Ny samtale: indsæt tekst, få et resumé, ret det og gem. */
export function NewConversationScreen() {
  const store = useStore();
  const { data } = store;
  const [date, setDate] = useState(today());
  const [transcript, setTranscript] = useState('');
  const [peopleIds, setPeopleIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Omit<Conversation, 'id' | 'createdAt'> | null>(null);
  const [toDiary, setToDiary] = useState(true);
  const [toPeople, setToPeople] = useState(true);
  const canAI = aiReady(data);
  const [recording, setRecording] = useState(false);
  const [interim, setInterim] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const stopRef = useRef<(() => void) | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);

  // Stop optagelsen, hvis skærmen forlades
  useEffect(() => () => {
    stopRef.current?.();
    releaseRef.current?.();
    setKeepUnlocked(false);
  }, []);

  // Uret under optagelse
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(t);
  }, [recording, startedAt]);

  const record = async () => {
    if (recording) {
      stopRef.current?.();
      return;
    }
    setError('');
    const base = transcript.trim() ? `${transcript.trimEnd()}\n\n` : '';
    setRecording(true);
    setStartedAt(Date.now());
    setElapsed(0);
    setKeepUnlocked(true);
    releaseRef.current = await keepScreenOn();
    stopRef.current = startLongDictation(
      (text, interimText) => {
        if (text) setTranscript(base + text);
        setInterim(interimText);
      },
      (err) => {
        setRecording(false);
        setInterim('');
        stopRef.current = null;
        releaseRef.current?.();
        releaseRef.current = null;
        setKeepUnlocked(false);
        if (err) setError(err);
      },
    );
  };

  const clock = `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;

  // Tekst delt fra en anden app (fx Pixel Optager)
  useEffect(() => {
    const t = takeSharedText();
    if (t) setTranscript(t);
  }, []);

  const paste = async () => {
    setError('');
    try {
      const t = await navigator.clipboard.readText();
      if (t.trim()) setTranscript((cur) => (cur.trim() ? `${cur.trimEnd()}\n\n${t}` : t));
      else setError('Udklipsholderen er tom.');
    } catch {
      setError('Kunne ikke læse udklipsholderen. Hold fingeren i tekstfeltet og vælg Sæt ind.');
    }
  };

  const summarize = async () => {
    setBusy(true);
    setError('');
    try {
      const names = Object.values(data.people).map((p) => p.name);
      const ai = await summarizeConversation(data.settings, date, transcript, names);
      const found = matchPeople(ai.people, data.people);
      setDraft({
        date,
        title: ai.title,
        summary: ai.summary,
        agreements: ai.agreements,
        remember: ai.remember,
        people: [...new Set([...peopleIds, ...found])],
        transcript: transcript.trim(),
        byAI: true,
      });
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    } finally {
      setBusy(false);
    }
  };

  const withoutAI = () =>
    setDraft({ date, title: 'Samtale', summary: '', agreements: [], remember: [], people: peopleIds, transcript: transcript.trim(), byAI: false });

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const c: Conversation = { ...draft, title: draft.title.trim() || 'Samtale', id: uid(), createdAt: Date.now() };
      await store.put('conversations', c.id, c);
      if (toDiary) {
        const next = withConversation(data.entries[c.date], data.draft, c.date, diaryBlock(c, data.people));
        await store.put('entries', c.date, next.entry);
        if (next.draft !== data.draft) await store.saveDraft(next.draft);
      }
      if (toPeople) {
        for (const pid of c.people) {
          const p = data.people[pid];
          if (p) await store.put('people', pid, { ...p, notes: [{ id: uid(), date: c.date, text: personNote(c) }, ...p.notes], updatedAt: Date.now() });
        }
      }
      go(`samtale/${c.id}`);
    } catch {
      setError('Samtalen kunne ikke gemmes.');
      setBusy(false);
    }
  };

  if (draft) {
    const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });
    return (
      <div className="stack" style={{ gap: 18 }}>
        <Header back="samtale" />
        <h1>Resumé</h1>
        <p className="small muted">{draft.byAI ? 'Lavet af Claude ud fra teksten. Ret det, før du gemmer.' : 'Skriv selv et kort resumé.'}</p>
        <label className="field">Titel
          <input type="text" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="field">Resumé
          <textarea rows={5} value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
        </label>
        <label className="field">Aftaler (én pr. linje)
          <textarea rows={3} value={draft.agreements.join('\n')} onChange={(e) => set({ agreements: lines(e.target.value) })} />
        </label>
        <label className="field">Husk (én pr. linje)
          <textarea rows={3} value={draft.remember.join('\n')} onChange={(e) => set({ remember: lines(e.target.value) })} />
        </label>
        <div className="stack-sm">
          <h3>Hvem var med?</h3>
          <PeopleChips value={draft.people} onChange={(ids) => set({ people: ids })} />
        </div>
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={toDiary} onChange={(e) => setToDiary(e.target.checked)} />
          <span className="small">Læg resuméet i dagbogen for {formatFull(draft.date)}</span>
        </label>
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={toPeople} onChange={(e) => setToPeople(e.target.checked)} />
          <span className="small">Tilføj en note hos personerne</span>
        </label>
        {error && <p className="error">{error}</p>}
        <div className="row">
          <button className="btn primary" onClick={save} disabled={busy}>{busy ? <span className="spinner" /> : 'Gem samtalen'}</button>
          <button className="btn ghost" onClick={() => setDraft(null)} disabled={busy}>Tilbage til teksten</button>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 18 }}>
      <Header back="samtale" />
      <h1>Ny samtale</h1>
      <p className="small muted">
        Tryk <strong>Optag</strong>, og læg telefonen mellem jer. Eller sæt tekst ind fra fx Pixel Optager. Teksten sendes først til Claude, når du trykker "Lav resumé".
      </p>
      <label className="field">Dato
        <input type="date" value={date} max={today()} onChange={(e) => e.target.value && setDate(e.target.value)} />
      </label>
      {speechInputAvailable() && (
        <div className="stack-sm">
          <button className={`btn ${recording ? 'danger' : 'primary'} block`} onClick={record}>
            <span style={{ width: 20, height: 20, display: 'inline-flex', verticalAlign: 'middle', marginRight: 6 }}>{recording ? Icon.stop : Icon.mic}</span>
            {recording ? `Stop optagelsen (${clock})` : 'Optag samtale'}
          </button>
          {recording && <p className="tiny muted">Optager … Hold skærmen tændt og Dagbog åben; telefonen går ikke i dvale, og dagbogen låser sig ikke imens.</p>}
        </div>
      )}
      <label className="field">Tekst fra optagelsen
        <textarea rows={10} value={transcript} onChange={(e) => setTranscript(e.target.value)} placeholder="Teksten kommer her, når du optager, eller sæt den ind …" />
      </label>
      {interim && <p className="interim">{interim}</p>}
      <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={paste} disabled={recording}>Sæt ind fra udklipsholder</button>
      <div className="stack-sm">
        <h3>Hvem var med? (valgfrit)</h3>
        <PeopleChips value={peopleIds} onChange={setPeopleIds} />
      </div>
      {!canAI && <p className="small muted">AI er slået fra eller mangler en API-nøgle (Indstillinger). Du kan stadig gemme teksten med dit eget resumé.</p>}
      {error && <p className="error">{error}</p>}
      <div className="row wrap">
        {canAI && (
          <button className="btn primary" onClick={summarize} disabled={busy || recording || !transcript.trim()}>
            {busy ? <><span className="spinner" /> Claude læser …</> : 'Lav resumé'}
          </button>
        )}
        <button className={canAI ? 'btn ghost' : 'btn primary'} onClick={withoutAI} disabled={busy || recording || !transcript.trim()}>Gem uden AI</button>
      </div>
    </div>
  );
}

/** En gemt samtale. */
export function ConversationScreen({ id }: { id: string }) {
  const store = useStore();
  const c = store.data.conversations[id];
  const [showText, setShowText] = useState(false);
  const [toast, setToast] = useState('');
  if (!c) return <div className="stack"><Header back="samtale" /><p className="muted">Ikke fundet.</p></div>;
  const names = c.people.map((pid) => store.data.people[pid]).filter(Boolean);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="samtale" right={<button className="btn ghost" onClick={() => go(`husk/dag/${c.date}`)}>Dagen</button>} />
      <div className="stack-sm">
        <span className="tiny muted">{formatFull(c.date)}</span>
        <h1>{c.title}</h1>
        {names.length > 0 && (
          <div className="chips">
            {names.map((p) => <button key={p.id} className="chip small" onClick={() => go(`mennesker/${p.id}`)}>{p.name}</button>)}
          </div>
        )}
      </div>
      {c.summary && <p className="prose">{c.summary}</p>}
      {c.agreements.length > 0 && (
        <section className="stack-sm">
          <h3>Aftaler</h3>
          <ul className="serif" style={{ margin: 0, paddingLeft: 20 }}>{c.agreements.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      )}
      {c.remember.length > 0 && (
        <section className="stack-sm">
          <h3>Husk</h3>
          <ul className="serif" style={{ margin: 0, paddingLeft: 20 }}>{c.remember.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>
      )}
      {c.byAI && <p className="tiny muted">Resuméet er lavet af Claude ud fra teksten fra optagelsen. Det kan indeholde fejl; tjek teksten, hvis noget er vigtigt.</p>}
      <section className="stack-sm">
        <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowText((v) => !v)}>
          {showText ? 'Skjul teksten fra optagelsen' : 'Vis teksten fra optagelsen'}
        </button>
        {showText && <p className="prose small">{c.transcript}</p>}
        {showText && (
          <button className="btn ghost small" style={{ alignSelf: 'flex-start' }}
            onClick={() => navigator.clipboard.writeText(c.transcript).then(() => setToast('Kopieret'), () => setToast('Kunne ikke kopiere'))}>
            <span style={{ width: 16, height: 16, display: 'inline-flex' }}>{Icon.pen}</span> Kopiér teksten
          </button>
        )}
      </section>
      <DoubleConfirm label="Slet samtalen" first="Slet samtalen? Teksten i dagbogen og noterne hos personerne bliver liggende."
        second="Er du helt sikker?" onConfirm={async () => { await store.remove('conversations', id); go('samtale'); }} />
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}
