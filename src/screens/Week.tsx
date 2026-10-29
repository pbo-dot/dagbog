import { useEffect, useState } from 'react';
import { AIError, goDeeper, weekTextFor } from '../lib/ai';
import { addDays, currentSummaryWeek, formatLong, formatWeek, today, weekDays, weekId, weekIdStart } from '../lib/dates';
import { speak, speechOutputAvailable, stopSpeaking } from '../lib/device';
import { aiReady, generateWeek } from '../lib/generate';
import { useStore } from '../lib/store';
import type { WeekSummary } from '../lib/types';
import { go, Header, Icon, MoodTag, uid } from '../ui';
import { AddTodoButton } from './Todos';

export function CrisisHelp() {
  return (
    <div className="card crisis stack-sm">
      <p><strong>Det lyder som om, du har det rigtig svært lige nu.</strong> Du behøver ikke stå alene med det.</p>
      <p className="small">
        Tal med nogen i dag: <a href="tel:70201201">Livslinien 70 201 201</a> (anonymt, hele døgnet), egen læge eller lægevagten <a href="tel:1813">1813</a>. Er du i akut fare, så ring <a href="tel:112">112</a>.
      </p>
      <p className="tiny muted">Appen er ikke terapi og kan ikke erstatte et menneske.</p>
    </div>
  );
}

export function WeekScreen({ id: routeId }: { id?: string }) {
  const store = useStore();
  const { data } = store;
  const id = routeId ?? currentSummaryWeek(today(), data.settings.summaryWeekday);
  const week = data.weeks[id];
  const days = weekDays(id).filter((d) => data.entries[d]);
  const canAI = aiReady(data);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [deeperBusy, setDeeperBusy] = useState(false);
  const [followUp, setFollowUp] = useState('');
  const [writingIntention, setWritingIntention] = useState(false);
  const [intention, setIntention] = useState('');

  // Markér som set
  useEffect(() => {
    if (week && !week.seen) store.put('weeks', id, { ...week, seen: true });
  }, [id, week]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setIntention(week?.intention ?? '');
    setWritingIntention(false);
    setEditing(false);
    return () => stopSpeaking();
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const save = (w: WeekSummary) => store.put('weeks', id, w);

  const generate = async (ai: boolean) => {
    setBusy(true);
    setError('');
    try {
      await save({ ...(await generateWeek(data, id, ai)), seen: true });
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    } finally {
      setBusy(false);
    }
  };

  const deeper = async (question?: string) => {
    if (!week) return;
    setDeeperBusy(true);
    setError('');
    const history = [...(week.deeper ?? [])];
    if (question) history.push({ role: 'user', text: question });
    try {
      // Første kald har ingen historik; opfølgninger sender hele samtalen
      const answer = await goDeeper(data.settings, formatWeek(id), weekTextFor(id, data.entries), history);
      await save({ ...week, deeper: [...history, { role: 'assistant', text: answer }] });
      setFollowUp('');
    } catch (e) {
      setError(e instanceof AIError ? e.message : 'Noget gik galt.');
    } finally {
      setDeeperBusy(false);
    }
  };

  const readAloud = () => {
    if (!week) return;
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    const parts = [
      week.threeWords.length ? `Ugens billede: ${week.threeWords.join(', ')}.` : '',
      week.takeaway,
      week.summary,
      ...week.patterns,
      week.reflection,
    ].filter(Boolean);
    setSpeaking(true);
    speak(parts.join(' \n'), () => setSpeaking(false));
  };

  const prev = weekId(addDays(weekIdStart(id), -7));
  const next = weekId(addDays(weekIdStart(id), 7));
  const isCurrent = id === weekId(today());

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="husk" />
      <div className="row between">
        <button className="icon-btn" onClick={() => go(`uge/${prev}`)} aria-label="Forrige uge"><span style={{ width: 20, height: 20, display: 'inline-flex' }}>{Icon.chevronLeft}</span></button>
        <div className="center">
          <h2>{formatWeek(id)}</h2>
          <p className="tiny muted">{days.length} {days.length === 1 ? 'dag' : 'dage'} skrevet</p>
        </div>
        <button className="icon-btn" onClick={() => go(`uge/${next}`)} disabled={isCurrent} aria-label="Næste uge"><span style={{ width: 20, height: 20, display: 'inline-flex' }}>{Icon.chevronRight}</span></button>
      </div>

      {error && <p className="error">{error}</p>}

      {!week && (
        <div className="card stack-sm center">
          {days.length === 0 ? (
            <p className="muted">Ingen dage skrevet i denne uge.</p>
          ) : (
            <>
              <p className="muted small">Der er ingen opsummering af ugen endnu.</p>
              {canAI ? (
                <button className="btn primary" onClick={() => generate(true)} disabled={busy}>
                  {busy ? <><span className="spinner" /> Den kloge ven læser …</> : 'Lav ugens opsummering'}
                </button>
              ) : (
                <button className="btn" onClick={() => generate(false)}>Lav en enkel opsummering</button>
              )}
              {!canAI && <p className="tiny muted">AI-analyse er slået fra eller mangler nøgle. Se Indstillinger.</p>}
            </>
          )}
        </div>
      )}

      {week && (
        <>
          {week.crisis && <CrisisHelp />}

          <section className="stack-sm">
            <div className="row between">
              <h3>Ugens billede</h3>
              <button className="btn ghost small" onClick={() => setEditing((v) => !v)}>{editing ? 'Færdig' : 'Ret'}</button>
            </div>
            {editing ? (
              <div className="stack-sm">
                <div className="row">
                  {[0, 1, 2].map((i) => (
                    <input key={i} type="text" value={week.threeWords[i] ?? ''} placeholder={`Ord ${i + 1}`}
                      onChange={(e) => {
                        const w = [...week.threeWords];
                        w[i] = e.target.value;
                        save({ ...week, threeWords: w });
                      }} />
                  ))}
                </div>
                <textarea rows={2} value={week.takeaway} placeholder="Det tager jeg med mig …" onChange={(e) => save({ ...week, takeaway: e.target.value })} />
              </div>
            ) : (
              <>
                {week.threeWords.filter(Boolean).length ? (
                  <div className="three-words">{week.threeWords.filter(Boolean).map((w, i) => <span key={i}>{w}</span>)}</div>
                ) : (
                  <button className="link" style={{ alignSelf: 'flex-start' }} onClick={() => setEditing(true)}>Skriv tre ord om ugen</button>
                )}
                {week.takeaway && <p className="serif" style={{ fontSize: '1.1rem' }}>{week.takeaway}</p>}
              </>
            )}
          </section>

          <section className="stack-sm">
            <h3>Ugeopsummering</h3>
            <p className="prose">{week.summary}</p>
            {week.themes.length > 0 && <p className="small"><span className="muted">Hovedtemaer:</span> {week.themes.join(', ')}</p>}
            {week.feelings.length > 0 && <p className="small"><span className="muted">Følelser der gik igen:</span> {week.feelings.join(', ')}</p>}
          </section>

          {week.patterns.length > 0 && (
            <section className="stack-sm">
              <h3>Mønstre</h3>
              {week.patterns.map((p, i) => {
                const saved = Object.values(data.patterns).some((x) => x.text === p);
                return (
                  <div key={i} className="card stack-sm">
                    <p className="serif">{p}</p>
                    <button className="btn ghost small" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} disabled={saved}
                      onClick={() => {
                        const pid = uid();
                        store.put('patterns', pid, { id: pid, text: p, createdAt: Date.now(), occurrences: [], source: week.byAI ? 'ai' : 'manual' });
                      }}>
                      {saved ? 'Gemt i mønsterbogen' : '+ Gem i mønsterbogen'}
                    </button>
                  </div>
                );
              })}
            </section>
          )}

          {(week.looseEnds ?? []).length > 0 && (
            <section className="stack-sm">
              <h3>Løse ender</h3>
              <div className="card stack-sm">
                {week.looseEnds!.map((l, i) => (
                  <div key={i} className="todo-pick-row">
                    <span className="grow small">{l}</span>
                    <AddTodoButton text={l} from="fra ugens løse ender" />
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="stack-sm">
            <h3>Til eftertanke</h3>
            <p className="serif" style={{ fontSize: '1.1rem' }}>{week.reflection}</p>
          </section>

          {canAI && (
            <section className="stack-sm">
              {(week.deeper ?? []).map((t, i) => (
                <div key={i} className={t.role === 'assistant' ? 'prose' : 'small muted'} style={t.role === 'user' ? { fontStyle: 'italic' } : undefined}>
                  {t.role === 'user' ? `Du: ${t.text}` : t.text}
                </div>
              ))}
              {!week.deeper?.length ? (
                <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => deeper()} disabled={deeperBusy}>
                  {deeperBusy ? <><span className="spinner" /> Tænker …</> : 'Gå dybere'}
                </button>
              ) : (
                <form className="row" onSubmit={(e) => { e.preventDefault(); if (followUp.trim()) deeper(followUp.trim()); }}>
                  <input type="text" className="grow" value={followUp} onChange={(e) => setFollowUp(e.target.value)} placeholder="Spørg eller svar …" />
                  <button className="btn" disabled={deeperBusy || !followUp.trim()}>{deeperBusy ? <span className="spinner" /> : 'Send'}</button>
                </form>
              )}
            </section>
          )}

          <section className="card stack-sm">
            <h3>Næste uge</h3>
            <p className="serif" style={{ fontSize: '1.1rem' }}>{week.nextWeekQuestion}</p>
            {writingIntention ? (
              <div className="stack-sm">
                <textarea rows={2} autoFocus value={intention} onChange={(e) => setIntention(e.target.value)} placeholder="Næste uge vil jeg …" />
                <div className="row">
                  <button className="btn primary" onClick={async () => { await save({ ...week, intention: intention.trim() }); setWritingIntention(false); }}>Gem</button>
                  <button className="btn ghost" onClick={() => setWritingIntention(false)}>Fortryd</button>
                </div>
              </div>
            ) : (
              <>
                {week.intention && <p className="small"><span className="muted">Du skrev:</span> {week.intention}</p>}
                <button className="btn" style={{ alignSelf: 'flex-start' }} onClick={() => setWritingIntention(true)}>
                  {week.intention ? 'Ret' : 'Skriv til ugen'}
                </button>
              </>
            )}
          </section>

          <div className="row wrap">
            {speechOutputAvailable() && (
              <button className="btn" onClick={readAloud}>
                <span style={{ width: 18, height: 18, display: 'inline-flex' }}>{speaking ? Icon.stop : Icon.speaker}</span>
                {speaking ? 'Stop' : 'Læs højt'}
              </button>
            )}
            <button className="btn ghost small" onClick={() => generate(canAI)} disabled={busy}>
              {busy ? <><span className="spinner" /> Laver ny …</> : 'Lav opsummeringen igen'}
            </button>
          </div>
          {week.byAI && <p className="tiny muted">Lavet af Claude ud fra ugens tekst og humør. Den er ikke en sandhed, men et blik udefra.</p>}
        </>
      )}

      {days.length > 0 && (
        <section className="stack-sm">
          <h3>Ugens dage</h3>
          <div className="list">
            {days.map((d) => (
              <button key={d} className="list-item" onClick={() => go(`husk/dag/${d}`)}>
                <div className="row between"><span className="small">{formatLong(d)}</span><MoodTag mood={data.entries[d].mood} /></div>
                <span className="small muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{data.entries[d].text}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
