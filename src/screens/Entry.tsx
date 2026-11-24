import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { agenda } from '../lib/agenda';
import { PlacesMap, stayPoints } from './PlacesMap';
import { PhonePhotos } from './PhonePhotos';
import { DayStoryCard } from './DayStory';
import { addDays, addMonths, formatLong, formatMonth, fromISO, monthId, today, toISO, weekId } from '../lib/dates';
import { speechInputAvailable, startDictation } from '../lib/device';
import { aiReady } from '../lib/generate';
import { routineStatus } from '../lib/routines';
import { dayQuestion, meetPreps } from '../lib/meet';
import { dayDescs, dayStays, dayThumbs, openAppUrl, stayTime } from '../lib/places';
import { groupTodos, shortDate } from '../lib/todos';
import { isPersonBirthday, nextBirthday, upcomingBirthdays } from '../lib/people';
import { cachePhoto, compressImage, forgetPhoto } from '../lib/photos';
import { useStore } from '../lib/store';
import { MAX_PHOTOS, MOODS, type Entry, type MoodId } from '../lib/types';
import { go, Icon, MoodPicker, PhotoImg, PhotoViewer, Toast, uid } from '../ui';
import { BackupNudge } from './Backup';
import { RoutineCards } from './Routines';
import { DayIdeaCard } from './Ideas';
import { TodoCard } from './Todos';

/** Klokken nu som "HH:MM". */
function nowHM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * Dagens billeder fra telefonen (hjælpe-appen "Dagbog Billeder") over skrivefeltet, så de hjælper
 * med at huske: stederne, en række billeder at rulle i, og Claudes beskrivelser med et tryk.
 */
function DayPhotos({ date }: { date: string }) {
  const { data } = useStore();
  const [showText, setShowText] = useState(false);
  const [showMap, setShowMap] = useState(false);
  const ids = dayThumbs(data.phonePhotos, date);
  // Stederne fra Google Maps-tidslinjen (eller billederne), også på dage uden billeder
  const stays = dayStays(data.phonePhotos, date, data.visits, data.settings.places?.fixed);
  if (!ids.length && !stays.length) return null;
  const descs = dayDescs(data.phonePhotos, date);
  return (
    <section className="day-photos" aria-label="Dagens steder og billeder">
      {stays.length > 0 && (
        <span className="small muted">
          {stays.slice(0, 5).map((x, i) => <span key={i}>{i ? ' · ' : ''}{x.city} <span className="tiny">{stayTime(x)}</span></span>)}
          {stays.length > 5 ? ' …' : ''}
        </span>
      )}
      {stays.some((x) => x.lat !== undefined) && (
        <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowMap((v) => !v)} aria-expanded={showMap}>
          {showMap ? 'Skjul kortet' : 'Vis på kort'}
        </button>
      )}
      {showMap && <PlacesMap points={stayPoints(stays, stayTime)} fixed={data.settings.places?.fixed} height={220} />}
      <DayStoryCard date={date} compact />
      <PhonePhotos ids={ids} />
      {descs.length > 0 && !data.stories[date]?.text && (
        <button className="link small" style={{ alignSelf: 'flex-start' }} onClick={() => setShowText((v) => !v)} aria-expanded={showText}>
          {showText ? 'Skjul Claudes beskrivelser' : 'Vis Claudes beskrivelser'}
        </button>
      )}
      {showText && (
        <ul className="small serif" style={{ margin: 0, paddingLeft: 18 }}>
          {descs.map((x, i) => <li key={i}><span className="muted">{x.time}</span> {x.text}</li>)}
        </ul>
      )}
    </section>
  );
}

/**
 * Månedskalender til at vælge dag på Skriv: en prik for skrevne dage og et billede-mærke for dage
 * med billeder fra telefonen, så man kan se, hvor der er noget.
 */
const MONTH_SHORT = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

function DateGrid({ date, onPick }: { date: string; onPick: (d: string) => void }) {
  const { data } = useStore();
  const [month, setMonth] = useState(monthId(date));
  const t = today();
  const first = `${month}-01`;
  const lead = (new Date(`${first}T12:00:00`).getDay() + 6) % 7; // mandag først
  const days = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
  const photoDays = new Set((data.phonePhotos[month]?.photos ?? []).map((p) => toISO(new Date(p.t))));
  const cells: Array<string | null> = [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  // Tryk på måneden: vælg år og måned, og bladr så videre derfra
  const [year, setYear] = useState<number | null>(null);
  const marks = useMemo(() => {
    const text = new Set(Object.keys(data.entries).map((d) => d.slice(0, 7)));
    const photos = new Set(Object.values(data.phonePhotos).filter((m) => m.photos.some((p) => !p.hidden)).map((m) => m.id));
    const firstYear = Math.min(Number(t.slice(0, 4)), ...[...text, ...photos, ...Object.keys(data.visits)].map((m) => Number(m.slice(0, 4))));
    return { text, photos, firstYear };
  }, [data.entries, data.phonePhotos, data.visits, t]);
  if (year !== null) {
    const nowM = monthId(t);
    return (
      <section className="card date-grid" aria-label="Vælg måned">
        <div className="row between" style={{ alignItems: 'center' }}>
          <button className="day-arrow" disabled={year <= marks.firstYear} onClick={() => setYear(year - 1)} aria-label="Året før">{Icon.chevronLeft}</button>
          <button className="dg-title" onClick={() => setYear(null)}>{year}</button>
          <button className="day-arrow" disabled={year >= Number(t.slice(0, 4))} onClick={() => setYear(year + 1)} aria-label="Året efter">{Icon.chevronRight}</button>
        </div>
        <div className="dg-months">
          {MONTH_SHORT.map((name, i) => {
            const id = `${year}-${String(i + 1).padStart(2, '0')}`;
            return (
              <button key={id} className={`dg-month${id === month ? ' on' : ''}`} disabled={id > nowM} onClick={() => { setMonth(id); setYear(null); }}
                aria-label={`${formatMonth(id)}${marks.text.has(id) ? ', skrevet' : ''}${marks.photos.has(id) ? ', billeder' : ''}`}>
                <span>{name}</span>
                <span className="dg-marks">
                  {marks.text.has(id) && <i className="dg-text" />}
                  {marks.photos.has(id) && <i className="dg-photo" />}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    );
  }
  return (
    <section className="card date-grid" aria-label="Vælg dag">
      <div className="row between" style={{ alignItems: 'center' }}>
        <button className="day-arrow" onClick={() => setMonth(monthId(addMonths(first, -1)))} aria-label="Måneden før">{Icon.chevronLeft}</button>
        <button className="dg-title" onClick={() => setYear(Number(month.slice(0, 4)))} aria-label="Vælg år og måned">{formatMonth(month)} ▾</button>
        <button className="day-arrow" disabled={month >= monthId(t)} onClick={() => setMonth(monthId(addMonths(first, 1)))} aria-label="Måneden efter">{Icon.chevronRight}</button>
      </div>
      <div className="dg-cells">
        {['M', 'T', 'O', 'T', 'F', 'L', 'S'].map((d, i) => <span key={i} className="dg-head">{d}</span>)}
        {cells.map((d, i) => d === null ? <span key={i} /> : (
          <button key={d} className={`dg-day${d === date ? ' on' : ''}${d === t ? ' today' : ''}`} disabled={d > t} onClick={() => onPick(d)}
            aria-label={`${formatLong(d)}${data.entries[d] ? ', skrevet' : ''}${photoDays.has(d) ? ', billeder' : ''}`}>
            <span>{Number(d.slice(8))}</span>
            <span className="dg-marks">
              {data.entries[d] && <i className="dg-text" />}
              {photoDays.has(d) && <i className="dg-photo" />}
            </span>
          </button>
        ))}
      </div>
      <div className="row" style={{ gap: 16, justifyContent: 'center' }}>
        <span className="tiny muted"><i className="dg-text" /> skrevet</span>
        <span className="tiny muted"><i className="dg-photo" /> billeder</span>
      </div>
    </section>
  );
}

const MEET_KEY = 'dagbog-moedes-skjult';

/**
 * "Før du mødes": har du en aftale i dag eller i morgen med en fra Mennesker, vises det, du
 * har skrevet om personen (vigtigt lige nu, seneste note, seneste samtale, huskepunkter).
 * × skjuler kortet resten af dagen.
 */
function MeetCards() {
  const { data } = useStore();
  const t = today();
  const [hidden, setHidden] = useState<string[]>(() => { try { const v = JSON.parse(localStorage.getItem(MEET_KEY) ?? '{}') as { day?: string; ids?: string[] }; return v.day === t ? v.ids ?? [] : []; } catch { return []; } });
  const preps = meetPreps(data, t, nowHM()).filter((m) => !hidden.includes(m.person.id)).slice(0, 2);
  if (!preps.length) return null;
  const hide = (id: string) => setHidden((old) => { const ids = [...old, id]; try { localStorage.setItem(MEET_KEY, JSON.stringify({ day: t, ids })); } catch { /* ikke afgørende */ } return ids; });
  const cut = (x: string, n = 140) => (x.length > n ? `${x.slice(0, n).trimEnd()} …` : x);
  return (
    <>
      {preps.map((m) => {
        const first = m.person.name.trim().split(/\s+/)[0];
        return (
          <section key={m.person.id} className="card meet-card" aria-label={`Før du mødes med ${first}`}>
            <div className="row between">
              <button className="meet-head" onClick={() => go(`mennesker/${m.person.id}`)}>
                <strong>Før du mødes med {first}</strong>
                <span className="small muted">{m.tomorrow ? 'I morgen' : 'I dag'}{m.item.time ? ` kl. ${m.item.time.replace(':', '.')}` : ''} · {m.item.title}</span>
              </button>
              <button className="icon-btn" onClick={() => hide(m.person.id)} aria-label={`Skjul ${first} i dag`}>×</button>
            </div>
            <ul className="meet-list">
              {m.person.important.trim() && <li><span className="meet-k">Vigtigt lige nu</span>{cut(m.person.important.trim())}</li>}
              {m.lastNote && <li><span className="meet-k">Sidst, {shortDate(m.lastNote.date)}</span>{cut(m.lastNote.text)}</li>}
              {m.lastTalk && <li><span className="meet-k">Samtale {shortDate(m.lastTalk.date)}</span>{cut(m.lastTalk.remember.slice(0, 2).join(' · ') || m.lastTalk.summary || m.lastTalk.title)}</li>}
              {m.todos.slice(0, 2).map((x) => <li key={x.id}><span className="meet-k">Huskeliste</span>{cut(x.text, 80)}</li>)}
            </ul>
          </section>
        );
      })}
    </>
  );
}

const FOLD_KEY = 'dagbog-idag-aaben';

/**
 * "I dag" på Skriv: én linje med tal ("1 aftale · 2 faste ting · 5 huskepunkter"), så skrivefeltet
 * står øverst. Et tryk folder aftaler, faste ting og huskeliste ud; valget huskes.
 */
function TodayFold() {
  const { data } = useStore();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(FOLD_KEY) === '1'; } catch { return false; } });
  const t = today();
  const plans = agenda(data, t, t).filter((i) => i.kind !== 'routine' && !isPersonBirthday(i.title, i.date, Object.values(data.people))).length;
  const routines = Object.values(data.routines).filter((r) => routineStatus(r, t).kind === 'due').length;
  const bdays = upcomingBirthdays(Object.values(data.people), t, 0).length;
  const g = groupTodos(data.todos, t);
  const overdue = g.now.some((x) => x.due && x.due <= t) || Object.values(data.routines).some((r) => { const s = routineStatus(r, t); return s.kind === 'due' && s.late; });
  const n = (k: number, one: string, many: string) => (k ? `${k} ${k === 1 ? one : many}` : '');
  const parts = [n(plans, 'aftale', 'aftaler'), n(bdays, 'fødselsdag', 'fødselsdage'), n(routines, 'fast ting', 'faste ting'), n(g.now.length, 'huskepunkt', 'huskepunkter')].filter(Boolean);
  // Intet at tælle: de små kort (fx "Taget ✓") vises som de er
  if (!parts.length) return <><RoutineCards /><TodoCard /></>;
  const flip = () => setOpen((v) => { try { localStorage.setItem(FOLD_KEY, v ? '0' : '1'); } catch { /* ikke afgørende */ } return !v; });
  return (
    <div className="stack-sm">
      <button className="today-fold" onClick={flip} aria-expanded={open}>
        <span className="grow"><strong>I dag</strong><span>{parts.join(' · ')}</span></span>
        {overdue && <span className="fold-dot" aria-label="Noget er overskredet" />}
        <span className="fold-chev" aria-hidden="true">{open ? '▾' : '›'}</span>
      </button>
      {open && <><RoutineCards /><TodoCard /></>}
    </div>
  );
}

/** Så mange dage efter sidste hentning minder Skriv om at hente nye billeder. */
const PHOTO_NUDGE_DAYS = 7;

/** Det nyeste billede fra denne telefon (ms), eller 0. */
function newestOwnPhoto(months: ReturnType<typeof useStore>['data']['phonePhotos']): number {
  let max = 0;
  for (const m of Object.values(months)) for (const ph of m.photos) if (ph.id < 1e12 && ph.t > max) max = ph.t;
  return max;
}

/** "Billeder: 9 dage siden sidst · Hent nu" (kun på Android, og kun når hjælpe-appen har været brugt). */
function PhotoNudge() {
  const { data } = useStore();
  const p = data.settings.places;
  if (!p?.thumbFrom || !/Android/i.test(navigator.userAgent)) return null;
  // Før 17. nov. blev hentningen ikke gemt: brug så det nyeste billede fra denne telefon
  // (numre under 1.000.000.000.000; den gamle telefon og Takeout ligger over). thumbFrom er
  // dagen, appen skal fortsætte fra, og kan ligge langt tilbage.
  const last = p.fetchedAt ?? newestOwnPhoto(data.phonePhotos);
  if (!last) return null;
  const days = Math.floor((Date.now() - last) / 864e5);
  if (!(days >= PHOTO_NUDGE_DAYS)) return null;
  return (
    <button className="backup-nudge photo-nudge" onClick={() => { location.href = openAppUrl(p.thumbFrom); }}>
      <span className="grow"><strong>Billeder: {days} dage siden sidst</strong><span className="small muted">Tryk for at hente de nye</span></span>
      <span className="btn small">Hent nu</span>
    </button>
  );
}

const AHEAD_KEY = 'dagbog-frem-aaben';
const AHEAD_DAYS = 3;
const WEEKDAYS = ['Søndag', 'Mandag', 'Tirsdag', 'Onsdag', 'Torsdag', 'Fredag', 'Lørdag'];

interface AheadRow { date: string; time: string; icon: string; title: string; detail: string; to: string }

/** "De næste 3 dage": aftaler, fødselsdage, faste ting (ikke de daglige) og frister fra i morgen, foldet ind som "I dag". */
function AheadFold() {
  const { data } = useStore();
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(AHEAD_KEY) === '1'; } catch { return false; } });
  const t = today();
  const from = addDays(t, 1);
  const to = addDays(t, AHEAD_DAYS);
  const rows: AheadRow[] = [];
  let plans = 0, routines = 0;
  const people = Object.values(data.people);
  for (const i of agenda(data, from, to)) {
    if (i.kind !== 'routine' && isPersonBirthday(i.title, i.date, people)) continue; // står allerede som fødselsdag
    if (i.kind === 'routine') {
      const r = data.routines[i.ref];
      if (!r || (!r.monthly && (r.everyDays ?? 0) <= 1)) continue; // daglige fylder kun
      routines++;
    } else plans++;
    rows.push({
      date: i.date, time: i.time, icon: i.kind === 'google' ? '🗓' : i.icon || '🗓', title: i.title,
      detail: i.detail ?? '', to: i.kind === 'routine' ? `faste/${i.ref}` : i.kind === 'event' ? `samtale/${i.ref}` : 'kalender',
    });
  }
  let bdays = 0;
  for (const p of Object.values(data.people)) {
    const b = nextBirthday(p, t);
    if (b && b.days >= 1 && b.days <= AHEAD_DAYS) {
      bdays++;
      rows.push({ date: b.date, time: '', icon: '🎂', title: `${p.name} har fødselsdag`, detail: b.age ? `${b.age} år` : '', to: `mennesker/${p.id}` });
    }
  }
  let dues = 0;
  for (const x of Object.values(data.todos)) {
    if (!x.doneAt && x.due && x.due >= from && x.due <= to) {
      dues++;
      rows.push({ date: x.due, time: '', icon: '☑', title: x.text, detail: 'frist', to: `huskeliste/${x.id}` });
    }
  }
  const n = (k: number, one: string, many: string) => (k ? `${k} ${k === 1 ? one : many}` : '');
  const parts = [n(plans, 'aftale', 'aftaler'), n(bdays, 'fødselsdag', 'fødselsdage'), n(routines, 'fast ting', 'faste ting'), n(dues, 'frist', 'frister')].filter(Boolean);
  if (!parts.length) return null;
  rows.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
  const flip = () => setOpen((v) => { try { localStorage.setItem(AHEAD_KEY, v ? '0' : '1'); } catch { /* ikke afgørende */ } return !v; });
  const dayName = (d: string) => (d === from ? 'I morgen' : WEEKDAYS[fromISO(d).getDay()]);
  return (
    <div className="stack-sm">
      <button className="today-fold" onClick={flip} aria-expanded={open}>
        <span className="grow"><strong>De næste {AHEAD_DAYS} dage</strong><span>{parts.join(' · ')}</span></span>
        <span className="fold-chev" aria-hidden="true">{open ? '▾' : '›'}</span>
      </button>
      {open && (
        <div className="card ahead">
          {rows.map((r, k) => (
            <div key={k}>
              {(k === 0 || rows[k - 1].date !== r.date) && <span className="overline ahead-day">{dayName(r.date)} {fromISO(r.date).getDate()}.</span>}
              <button className="ahead-row" onClick={() => go(r.to)}>
                <span className="ahead-icon" aria-hidden="true">{r.icon}</span>
                <span className="grow">
                  <strong>{r.title}</strong>
                  {(r.time || r.detail) && <span className="small muted">{[r.time ? `kl. ${r.time.replace(':', '.')}` : '', r.detail].filter(Boolean).join(' · ')}</span>}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
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
  const [viewing, setViewing] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Android viser ikke kameraet i billedvælgeren, så kameraet har sin egen knap
  const cameraRef = useRef<HTMLInputElement>(null);
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
      question: existing?.question ?? (data.settings.showQuestion ? dayQuestion(data, date, today(), nowHM()) : undefined),
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
      if (cameraRef.current) cameraRef.current.value = '';
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
        {pickDate && <DateGrid date={date} onPick={(d) => { setPickDate(false); go(d === today() ? 'skriv' : `skriv/${d}`); }} />}
        <div className="row between" style={{ alignItems: 'center' }}>
          <h1>{isToday ? greeting() : existing ? 'Din dag' : 'Skriv om dagen'}</h1>
          {isToday && !existing && <button className="btn small" onClick={skipToday}>Spring over</button>}
          {!isToday && <button className="btn small" onClick={() => go('skriv')}>I dag</button>}
        </div>
        {isToday && aiReady(data) && (
          <div className="talk-row">
            {speechInputAvailable() && (
              <button className="talk-start" onClick={() => go('tal')}>
                <span className="talk-start-ico" aria-hidden="true">{Icon.mic}</span>
                <span><strong>{existing ? 'Fortæl mere' : 'Fortæl om dagen'}</strong><span>Claude lytter</span></span>
              </button>
            )}
            <button className="talk-start clarity-start" onClick={() => go('overblik')}>
              <span className="talk-start-ico" aria-hidden="true">🧭</span>
              <span><strong>Få overblik</strong><span>Når noget er svært</span></span>
            </button>
          </div>
        )}
        {isToday && <BackupNudge />}
        {isToday && <PhotoNudge />}
        {isToday && <TodayFold />}
        {isToday && <AheadFold />}
        {isToday && <DayIdeaCard />}
        {isToday && <MeetCards />}
        {data.settings.showQuestion && <p className="question">{existing?.question ?? dayQuestion(data, date, today(), nowHM())}</p>}
        {intention && <p className="small muted">Din intention for ugen: <span className="serif">{intention}</span></p>}
        <DayPhotos date={date} />
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
              <PhotoImg id={id} alt="Foto" onClick={() => setViewing(id)} />
              <button className="remove" onClick={() => removePhoto(id)} aria-label="Fjern foto">×</button>
            </div>
          ))}
        </div>
      )}
      {viewing && <PhotoViewer id={viewing} ids={photos} onClose={() => setViewing(null)} />}
      {photoError && <p className="tiny error">{photoError}</p>}
      <input ref={fileRef} type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={(e) => addPhotos(e.target.files)} />
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={(e) => addPhotos(e.target.files)} />

      <div className="chips">
        {photos.length < MAX_PHOTOS && (<>
          <button className="chip extra" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
            <span className="extra-ico">{photoBusy ? <span className="spinner" /> : Icon.image}</span>{photoBusy ? 'Gemmer …' : 'Billeder'}
          </button>
          <button className="chip extra" onClick={() => cameraRef.current?.click()} disabled={photoBusy}>
            <span className="extra-ico">{Icon.camera}</span>Kamera
          </button>
        </>)}
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

      {text.trim() && (<>
        <div style={{ height: 72 }} aria-hidden="true" />
        <div className="save-bar">
          <div className="inner">
            <button className="btn primary block" onClick={save}>
              {existing ? 'Gem ændringer' : 'Gem'}
            </button>
          </div>
        </div>
      </>)}
      {toast && <Toast text={toast} onDone={() => setToast('')} />}
    </div>
  );
}
