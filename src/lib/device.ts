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

export function startDictation(onFinal: (text: string) => void, onInterim: (text: string) => void, onEnd: (err?: string) => void) {
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
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) onFinal(r[0].transcript.trim());
      else interim += r[0].transcript;
    }
    onInterim(interim);
  };
  rec.onerror = (e) => onEnd(e.error === 'not-allowed' ? 'Mikrofonen er ikke tilladt.' : undefined);
  rec.onend = () => onEnd();
  rec.start();
  return () => rec.stop();
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
  };
}

export async function updateAppBadge(w: Waiting | null) {
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  try {
    const n = w ? Number(w.today) + Number(w.week) + Number(w.month) : 0;
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
