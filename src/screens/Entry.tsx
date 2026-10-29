import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { addDays, formatLong, today, weekId } from '../lib/dates';
import { speechInputAvailable, startDictation } from '../lib/device';
import { cachePhoto, compressImage, forgetPhoto } from '../lib/photos';
import { useStore } from '../lib/store';
import { MAX_PHOTOS, MOODS, type Entry, type MoodId } from '../lib/types';
import { go, Icon, MoodPicker, PhotoImg, Toast, uid } from '../ui';
import { RoutineCards } from './Routines';
import { TodoCard } from './Todos';

const QUESTIONS = [
  'Hvad fyldte mest i dag?',
  'Hvad tager du med dig fra i dag?',
  'Hvordan har din krop haft det i dag?',
  'Hvad overraskede dig i dag?',
  'Hvem tænkte du på i dag?',
  'Hvad gav dig energi – og hvad tog den?',
  'Hvad ville du ønske, du havde sagt eller gjort?',
  'Hvad var et øjeblik, du gerne vil huske?',
];

function questionFor(date: string) {
  const n = Math.floor(new Date(date).getTime() / 86400000);
  return QUESTIONS[((n % QUESTIONS.length) + QUESTIONS.length) % QUESTIONS.length];
}

type Extra = 'humor' | 'tags' | 'gode' | 'samtale';

/** "God morgen", "God dag" eller "God aften" efter klokken. */
function greeting(): string {
  const h = new Date().getHours();
  return h < 5 ? 'God nat' : h < 10 ? 'God morgen' : h < 18 ? 'God dag' : 'God aften';
}

/**
 * Skriver man i bunden af en lang tekst, rulles siden, så linjen kan ses over
 * tastaturet og Gem-knappen (som ligger fast i bunden).
 */
function keepCaretVisible(el: HTMLTextAreaElement) {
  if (document.activeElement !== el || el.selectionEnd < el.value.length - 1) return;
  const vv = window.visualViewport;
  const bottom = (vv ? vv.offsetTop + vv.height : window.innerHeight) - 96;
  const r = el.getBoundingClientRect();
  if (r.bottom > bottom) window.scrollBy(0, r.bottom - bottom);
}

function AutoGrow(props: { value: string; onChange: (v: string) => void; placeholder: string }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Når feltet kort sættes til "auto", bliver siden kortere, og browseren hopper op.
    // Derfor huskes rullepositionen og sættes tilbage.
    const y = window.scrollY;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    window.scrollTo(0, y);
    keepCaretVisible(el);
  }, [props.value]);
  return (
    <textarea
      ref={ref}
      className="writer"
      rows={1}
      value={props.value}
      placeholder={props.placeholder}
      onChange={(e) => props.onChange(e.target.value)}
      aria-label="Dagens tekst"
    />
  );
}

export function EntryScreen({ date: routeDate }: { date?: string }) {
  const store = useStore();
  const { data } = store;
  const date = routeDate ?? today();
  const existing = data.entries[date];
  const draft = data.draft?.date === date ? data.draft : null;
  const isToday = date === today();

  const [text, setText] = useState('');
  const [mood, setMood] = useState<MoodId | null>(null);
  const [tags, setTags] = useState<string[]>([]);
  const [good, setGood] = useState<string[]>(['', '', '']);
  const [open, setOpen] = useState<Set<Extra>>(new Set());
  const toggle = (k: Extra) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const [toast, setToast] = useState('');
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [micError, setMicError] = useState('');
  const [pickDate, setPickDate] = useState(false);
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const loadedFor = useRef<string | null>(null);
  const dirty = useRef(false);

  // Indlæs post / kladde når datoen skifter
  useEffect(() => {
    if (loadedFor.current === date) return;
    loadedFor.current = date;
    const src = draft ?? existing;
    setText(src?.text ?? '');
    setMood(src?.mood ?? null);
    setTags(src?.tags ?? []);
    const g = src?.good ?? [];
    setGood([g[0] ?? '', g[1] ?? '', g[2] ?? '']);
    setOpen(new Set<Extra>([...(src?.mood ? ['humor' as const] : []), ...(src?.tags?.length ? ['tags' as const] : []), ...(g.some(Boolean) ? ['gode' as const] : [])]));
    setPhotos(src?.photos ?? []);
    dirty.current = false;
  }, [date, draft, existing]);

  // Gem kladde (krypteret) løbende, så intet går tabt ved autolås
  useEffect(() => {
    if (!dirty.current) return;
    const t = setTimeout(() => {
      store.saveDraft({ date, text, mood, tags, good, photos }).catch(() => {});
    }, 800);
    return () => clearTimeout(t);
  }, [date, text, mood, tags, good, photos]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => stopRef.current?.(), []);

  const edit = <T,>(fn: (v: T) => void) => (v: T) => {
    dirty.current = true;
    fn(v);
  };

  const skipped = isToday && !existing && data.meta.skipped.includes(date);
  const intention = data.weeks[weekId(addDays(date, -7))]?.intention;

  const save = async () => {
    if (!text.trim()) return;
    stopRef.current?.();
    const now = Date.now();
    const entry: Entry = {
      date,
      text: text.trim(),
      mood,
      tags,
      good: good.map((g) => g.trim()).filter(Boolean),
      photos,
      question: existing?.question ?? (data.settings.showQuestion ? questionFor(date) : undefined),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await store.put('entries', date, entry);
    // Fotos fjernet fra en gemt dag slettes først nu
    for (const pid of existing?.photos ?? []) {
      if (!photos.includes(pid)) {
        await store.removePhoto(pid);
        forgetPhoto(pid);
      }
    }
    if (data.draft) await store.saveDraft(null);
    if (data.meta.skipped.includes(date)) {
      await store.saveMeta({ ...data.meta, skipped: data.meta.skipped.filter((d) => d !== date) });
    }
    dirty.current = false;
    setToast(existing ? 'Opdateret' : 'Gemt');
  };

  const addPhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setPhotoError('');
    setPhotoBusy(true);
    const added: string[] = [];
    try {
      for (const file of Array.from(files).slice(0, MAX_PHOTOS - photos.length)) {
        const id = uid();
        const photo = { id, date, ...(await compressImage(file)), createdAt: Date.now() };
        await store.putPhoto(photo);
        cachePhoto(photo);
        added.push(id);
      }
    } catch {
      setPhotoError('Billedet kunne ikke indlæses.');
    } finally {
      if (added.length) {
        dirty.current = true;
        setPhotos((p) => [...p, ...added].slice(0, MAX_PHOTOS));
      }
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removePhoto = async (id: string) => {
    dirty.current = true;
    setPhotos((p) => p.filter((x) => x !== id));
    // Ikke gemt endnu → slet med det samme. Ellers ved næste gem.
    if (!existing?.photos?.includes(id)) {
      await store.removePhoto(id);
      forgetPhoto(id);
    }
  };

  const skipToday = async () => {
    await store.saveMeta({ ...data.meta, skipped: [...data.meta.skipped.filter((d) => d >= addDays(today(), -60)), date] });
  };

  const unskip = async () => {
    await store.saveMeta({ ...data.meta, skipped: data.meta.skipped.filter((d) => d !== date) });
  };

  const toggleMic = () => {
    if (listening) {
      stopRef.current?.();
      return;
    }
    setMicError('');
    setListening(true);
    // Det dikterede erstatter hele tiden sit eget stykke efter den eksisterende tekst
    const base = text && !/\s$/.test(text) ? `${text} ` : text;
    stopRef.current = startDictation(
      (final, interimText) => {
        if (final) {
          dirty.current = true;
          setText(base + final);
        }
        setInterim(interimText);
      },
      (err) => {
        setListening(false);
        setInterim('');
        stopRef.current = null;
        if (err) setMicError(err);
      },
    );
  };

  if (skipped) {
    return (
      <div className="stack" style={{ paddingTop: '20vh', alignItems: 'center', textAlign: 'center' }}>
        <div className="stack-sm" style={{ width: '100%', textAlign: 'left' }}><RoutineCards /><TodoCard /></div>
        <p className="question">Fint. Vi ses i morgen.</p>
        <button className="link small" onClick={unskip}>Skriv alligevel</button>
      </div>
    );
  }

  const chip = (key: Extra, icon: ReactNode, label: string, onClick?: () => void) => (
    <button key={key} className={`chip extra ${open.has(key) ? 'on' : ''}`} aria-expanded={onClick ? undefined : open.has(key)}
      onClick={onClick ?? (() => toggle(key))}>
      <span className="extra-ico">{icon}</span>{label}
    </button>
  );
  const moodName = MOODS.find((m) => m.id === mood)?.label;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="stack-sm" style={{ gap: 12 }}>
        <div className="day-nav">
          <button className="day-arrow" onClick={() => go(`skriv/${addDays(date, -1)}`)} aria-label="Dagen før">{Icon.chevronLeft}</button>
          <button className="day-label" onClick={() => setPickDate((v) => !v)} aria-label="Skift dato">
            {formatLong(date)} <span aria-hidden="true">▾</span>
          </button>
          <button className="day-arrow" disabled={isToday} onClick={() => { const n = addDays(date, 1); go(n === today() ? 'skriv' : `skriv/${n}`); }} aria-label="Dagen efter">{Icon.chevronRight}</button>
        </div>
        {pickDate && (
          <input
            type="date"
            value={date}
            max={today()}
            onChange={(e) => {
              setPickDate(false);
              if (e.target.value) go(e.target.value === today() ? 'skriv' : `skriv/${e.target.value}`);
            }}
          />
        )}
        <div className="row between" style={{ alignItems: 'center' }}>
          <h1>{isToday ? greeting() : existing ? 'Din dag' : 'Skriv om dagen'}</h1>
          {isToday && !existing && <button className="btn small" onClick={skipToday}>Spring over</button>}
          {!isToday && <button className="btn small" onClick={() => go('skriv')}>I dag</button>}
        </div>
        {isToday && <RoutineCards />}
        {isToday && <TodoCard />}
        {data.settings.showQuestion && <p className="question">{existing?.question ?? questionFor(date)}</p>}
        {intention && <p className="small muted">Din intention for ugen: <span className="serif">{intention}</span></p>}
      </div>

      <div className="writer-wrap">
        <AutoGrow value={text} onChange={edit(setText)} placeholder="Skriv her …" />
        {interim && <p className="interim">{interim}</p>}
        <div className="row between" style={{ marginTop: 4 }}>
          <span className="tiny error">{micError}</span>
          {speechInputAvailable() && (
            <button className={`icon-btn mic ${listening ? 'on' : ''}`} onClick={toggleMic} aria-label={listening ? 'Stop optagelse' : 'Indtal'}>
              <span style={{ width: 22, height: 22, display: 'inline-flex' }}>{listening ? Icon.stop : Icon.mic}</span>
            </button>
          )}
        </div>
      </div>

      {photos.length > 0 && (
        <div className="photo-row">
          {photos.map((id) => (
            <div key={id} className="photo-thumb">
              <PhotoImg id={id} alt="Foto" />
              <button className="remove" onClick={() => removePhoto(id)} aria-label="Fjern foto">×</button>
            </div>
          ))}
        </div>
      )}
      {photoError && <p className="tiny error">{photoError}</p>}
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => addPhotos(e.target.files)} />

      <div className="chips">
        {photos.length < MAX_PHOTOS && (
          <button className="chip extra" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
            <span className="extra-ico">{photoBusy ? <span className="spinner" /> : Icon.camera}</span>{photoBusy ? 'Gemmer …' : 'Foto'}
          </button>
        )}
        {chip('humor', Icon.smile, moodName ?? 'Humør')}
        {chip('tags', Icon.tag, tags.length ? tags.join(', ') : 'Tags')}
        {chip('gode', Icon.heart, 'Gode ting')}
        {chip('samtale', Icon.chat, 'Samtale', () => go('samtale/ny'))}
      </div>

      {open.has('humor') && (
        <div className="stack-sm">
          <h3>Humør</h3>
          <MoodPicker value={mood} onChange={edit(setMood)} />
        </div>
      )}

      {open.has('tags') && (
        <div className="stack-sm">
          <h3>Tags</h3>
          <div className="chips">
            {data.settings.tags.map((t) => (
              <button
                key={t}
                className={`chip ${tags.includes(t) ? 'on' : ''}`}
                aria-pressed={tags.includes(t)}
                onClick={() => edit(setTags)(tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t])}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      )}

      {open.has('gode') && (
        <div className="stack-sm">
          <h3>Tre gode ting</h3>
          {good.map((g, i) => (
            <input
              key={i}
              type="text"
              value={g}
              placeholder={`${i + 1}.`}
              onChange={(e) => edit(setGood)(good.map((x, j) => (j === i ? e.target.value : x)))}
            />
          ))}
        </div>
      )}

      <div style={{ height: 72 }} aria-hidden="true" />
      <div className="save-bar">
        <div className="inner">
          <button className="btn primary block" onClick={save} disabled={!text.trim()}>
            {existing ? 'Gem ændringer' : 'Gem'}
          </button>
        </div>
      </div>
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}
