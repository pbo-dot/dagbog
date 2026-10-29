// Browser-funktioner: tale-til-tekst, oplæsning, app-ikon-prik og kalenderfil.
import { today, weekDays, currentSummaryWeek, prevMonthId, monthId } from './dates';
import type { Data } from './store';

// ---------- Tale til tekst ----------

interface SpeechRec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

function SpeechCtor(): (new () => SpeechRec) | undefined {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRec; webkitSpeechRecognition?: new () => SpeechRec };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export const speechInputAvailable = () => !!SpeechCtor();

/** Samler alle resultater i sessionen til én tekst. Chrome på Android sender
 *  ofte hver ny version af sætningen som et nyt resultat ("Dette", "Dette er",
 *  "Dette er en" …), så et resultat der starter med det forrige erstatter det. */
export function joinResults(parts: string[]): string {
  let out = '';
  for (const raw of parts) out = mergeSpeech(out, raw);
  return out;
}

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean);
const norm = (w: string) => w.toLowerCase().replace(/[.,!?;:"'()]/g, '');

/** Hvor mange ord fra `a` der går igen i `b` i samme rækkefølge (længste fælles delfølge). */
function common(a: string[], b: string[]): number {
  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = norm(a[i - 1]) === norm(b[j - 1]) ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

/**
 * Sætter ny tekst fra talegenkendelsen i forlængelse af den gamle uden gentagelser.
 * Android sender ofte hele teksten igen, lidt rettet ("jeg ude at" → "jeg er ude og"),
 * eller gentager slutningen af det forrige stykke. Så erstattes eller flettes teksten.
 */
export function mergeSpeech(prev: string, next: string): string {
  const A = words(prev);
  const B = words(next);
  if (!B.length) return prev.trim();
  if (!A.length) return B.join(' ');
  const p = prev.trim().toLowerCase(), n = next.trim().toLowerCase();
  if (n.startsWith(p)) return next.trim();
  if (p.startsWith(n)) return prev.trim();
  // Den nye tekst er en (rettet) udgave af hele den gamle plus mere: erstat
  const head = B.slice(0, A.length + 2);
  if (A.length >= 2 && common(A, head) >= Math.ceil(A.length * 0.7)) return B.join(' ');
  // Den nye tekst står allerede i den gamle
  if (B.length >= 2 && common(B, A.slice(-(B.length + 2))) >= Math.ceil(B.length * 0.8)) return A.join(' ');
  // Slutningen af den gamle gentages i starten af den nye: flet
  for (let k = Math.min(A.length, B.length); k >= 3; k--) {
    const tail = A.slice(-k);
    let same = 0;
    for (let i = 0; i < k; i++) if (norm(tail[i]) === norm(B[i])) same++;
    if (same >= k - Math.floor(k / 4)) return [...A, ...B.slice(k)].join(' ');
  }
  return [...A, ...B].join(' ');
}

/** onUpdate får hele sessionens endelige tekst + den foreløbige del. */
export function startDictation(onUpdate: (final: string, interim: string) => void, onEnd: (err?: string) => void) {
  const Ctor = SpeechCtor();
  if (!Ctor) {
    onEnd('Taleindtastning understøttes ikke i denne browser.');
    return () => {};
  }
  const rec = new Ctor();
  rec.lang = 'da-DK';
  rec.continuous = true;
  rec.interimResults = true;
  rec.onresult = (e) => {
    const finals: string[] = [];
    const interims: string[] = [];
    for (let i = 0; i < e.results.length; i++) {
      const r = e.results[i];
      (r.isFinal ? finals : interims).push(r[0].transcript);
    }
    const final = joinResults(finals);
    let interim = joinResults(interims);
    // Foreløbig tekst der gentager det endelige, vises ikke dobbelt
    if (final && interim.toLowerCase().startsWith(final.toLowerCase())) interim = interim.slice(final.length).trim();
    onUpdate(final, interim);
  };
  rec.onerror = (e) => onEnd(e.error === 'not-allowed' ? 'Mikrofonen er ikke tilladt.' : undefined);
  rec.onend = () => onEnd();
  rec.start();
  return () => rec.stop();
}

/**
 * Lang optagelse (fx en samtale): talegenkendelsen i Chrome stopper af sig selv
 * efter en pause, så den startes igen, indtil brugeren trykker stop. Teksten fra
 * hver omgang lægges efter den forrige. Returnerer en stop-funktion.
 */
export function startLongDictation(
  onUpdate: (text: string, interim: string) => void,
  onEnd: (err?: string) => void,
) {
  const Ctor = SpeechCtor();
  if (!Ctor) {
    onEnd('Optagelse understøttes ikke i denne browser.');
    return () => {};
  }
  let stopped = false;
  let done = '';
  let failures = 0;
  let rec: SpeechRec | null = null;
  const finish = (err?: string) => {
    if (stopped) return;
    stopped = true;
    rec = null;
    onEnd(err);
  };
  const run = () => {
    if (stopped) return;
    const r = new Ctor();
    rec = r;
    r.lang = 'da-DK';
    r.continuous = true;
    r.interimResults = true;
    let session = '';
    r.onresult = (e) => {
      const finals: string[] = [];
      const interims: string[] = [];
      for (let i = 0; i < e.results.length; i++) (e.results[i].isFinal ? finals : interims).push(e.results[i][0].transcript);
      session = joinResults(finals);
      let interim = joinResults(interims);
      if (session && interim.toLowerCase().startsWith(session.toLowerCase())) interim = interim.slice(session.length).trim();
      failures = 0;
      onUpdate(mergeSpeech(done, session), interim);
    };
    r.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') finish('Mikrofonen er ikke tilladt.');
      else if (e.error !== 'no-speech' && e.error !== 'aborted') failures++;
    };
    r.onend = () => {
      done = mergeSpeech(done, session);
      if (stopped) return;
      if (failures >= 5) return finish('Talegenkendelsen svarer ikke. Er du online?');
      setTimeout(run, 250);
    };
    try {
      r.start();
    } catch {
      setTimeout(run, 500);
    }
  };
  run();
  return () => {
    const r = rec;
    finish();
    r?.stop();
  };
}

// ---------- Hold skærmen tændt og dagbogen åben ----------

let keepOpen = false;

/** Under en optagelse må dagbogen ikke låse sig selv. */
export function setKeepUnlocked(v: boolean) {
  keepOpen = v;
}

export function keepUnlocked() {
  return keepOpen;
}

interface WakeLockLike {
  release(): Promise<void>;
}

/** Holder skærmen tændt, indtil den returnerede funktion kaldes. */
export async function keepScreenOn(): Promise<() => void> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<WakeLockLike> } };
    const lock = await nav.wakeLock?.request('screen');
    return () => void lock?.release().catch(() => {});
  } catch {
    return () => {};
  }
}

// ---------- Oplæsning ----------

export const speechOutputAvailable = () => 'speechSynthesis' in window;

export function speak(text: string, onEnd: () => void) {
  const synth = window.speechSynthesis;
  synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'da-DK';
  const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith('da'));
  if (voice) u.voice = voice;
  u.rate = 0.95;
  u.onend = onEnd;
  u.onerror = onEnd;
  synth.speak(u);
}

export function stopSpeaking() {
  if (speechOutputAvailable()) window.speechSynthesis.cancel();
}

// ---------- Prikker / badge ----------

export interface Waiting {
  today: boolean; // ikke skrevet i dag (efter påmindelsestid)
  week: boolean; // ny ugeopsummering ikke set
  month: boolean; // nyt månedskapitel ikke set
  due: number; // huskepunkter med frist i dag eller før
}

/** ignoreTime: til app-ikonet, som kun kan opdateres mens appen kører – så
 *  prikken sættes allerede når appen lukkes, hvis dagen ikke er skrevet. */
export function waiting(data: Data, now = new Date(), ignoreTime = false): Waiting {
  const t = today();
  const { reminder, summaryWeekday } = data.settings;
  const [h, m] = reminder.time.split(':').map(Number);
  const afterReminder = ignoreTime || now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
  const wid = currentSummaryWeek(t, summaryWeekday);
  const week = data.weeks[wid];
  const chapter = data.months[prevMonthId(monthId(t))];
  return {
    today: reminder.enabled && afterReminder && !data.entries[t] && !data.meta.skipped.includes(t),
    week: !!week && !week.seen && weekDays(wid).some((d) => data.entries[d]),
    month: !!chapter && !chapter.seen,
    // Huskepunkter med frist i dag eller overskredet (ikke dem, der er lagt væk)
    due: Object.values(data.todos ?? {}).filter((x) => !x.doneAt && !x.someday && x.due && x.due <= t).length,
  };
}

export async function updateAppBadge(w: Waiting | null) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    const n = w ? Number(w.today) + Number(w.week) + Number(w.month) + w.due : 0;
    if (n > 0) await nav.setAppBadge?.(n);
    else await nav.clearAppBadge?.();
  } catch {
    /* ikke understøttet */
  }
}

export const badgeSupported = () => 'setAppBadge' in navigator;

// ---------- Kalenderpåmindelse (.ics) ----------

function icsEscape(s: string) {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function reminderICS(opts: { time: string; text: string; url: string; weekly?: { weekday: number } }): string {
  const [h, m] = opts.time.split(':');
  const d = today().replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const byday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
  const rule = opts.weekly ? `RRULE:FREQ=WEEKLY;BYDAY=${byday[opts.weekly.weekday]}` : 'RRULE:FREQ=DAILY';
  const title = opts.weekly ? 'Ugens billede' : opts.text;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Dagbog//DA',
    'BEGIN:VEVENT',
    `UID:dagbog-${opts.weekly ? 'uge' : 'dag'}-${stamp}@dagbog`,
    `DTSTAMP:${stamp}`,
    `DTSTART:${d}T${h}${m}00`,
    'DURATION:PT5M',
    rule,
    `SUMMARY:${icsEscape(title)}`,
    `DESCRIPTION:${icsEscape(`${opts.text}\n${opts.url}`)}`,
    `URL:${opts.url}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(opts.text)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
