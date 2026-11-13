// Påmindelser: lægges i Google Kalender, som giver beskeden på telefonen, også når Dagbog er lukket.
// Huskepunkter med frist, faste ting med klokkeslæt, "skriv i dagbogen" og fødselsdage.
// Dagbog kan kun rette i Google, mens appen er åben.
import { plusMinutes } from './gcalWrite';
import { nextBirthday } from './people';
import { lastIndex, occurrence } from './routines';
import type { Person, Routine, Settings, Todo, TodoEvent } from './types';

export const REMIND_TIME = '09:00';
const ZONE = 'Europe/Copenhagen';
const WEEK_BEFORE = 7 * 24 * 60;

/** Én påmindelse, som den skal ligge i Google. `ref` er nøglen i listen, `sig` det, der sidst blev sendt. */
export interface Wanted {
  ref: string;
  sig: string;
  body: object;
  /** Må den oprettes nu? (Et huskepunkt med overskredet frist får ikke en ny.) */
  create: boolean;
}

export interface ReminderPlan {
  put: Array<{ want: Wanted; old?: TodoEvent }>; // skal oprettes eller rettes
  remove: Array<{ ref: string; ev: TodoEvent }>; // skal slettes i Google
}

/** En aftale på 15 minutter med besked på telefonen til tiden (og evt. før), evt. gentaget. */
export function reminderEvent(o: { summary: string; description: string; date: string; time: string; rrule?: string; popups?: number[] }) {
  return {
    summary: o.summary,
    description: o.description,
    start: { dateTime: `${o.date}T${o.time}:00`, timeZone: ZONE },
    end: { dateTime: plusMinutes(o.date, o.time, 15), timeZone: ZONE },
    ...(o.rrule ? { recurrence: [`RRULE:${o.rrule}`] } : {}),
    reminders: { useDefault: false, overrides: (o.popups ?? [0]).map((minutes) => ({ method: 'popup', minutes })) },
  };
}

/** Skal punktet have en påmindelse? Åbent, med frist, ikke lagt væk. */
export const wantsReminder = (t: Todo | undefined): t is Todo => !!t && !!t.due && !t.doneAt && !t.someday;

/** Gentagelsen for en fast ting. Den 29.–31. i måneden: sidste dag i kortere måneder, som i Dagbog. */
export function routineRule(r: Pick<Routine, 'everyDays' | 'monthly' | 'start'>): string {
  if (!r.monthly) return `FREQ=DAILY;INTERVAL=${Math.max(1, r.everyDays)}`;
  const day = Number(r.start.slice(8, 10));
  if (day <= 28) return 'FREQ=MONTHLY';
  const days = [];
  for (let d = 28; d <= day; d++) days.push(d);
  return `FREQ=MONTHLY;BYMONTHDAY=${days.join(',')};BYSETPOS=-1`;
}

/** Første gang fra og med i dag. */
export function firstFrom(r: Routine, today: string): string {
  const k = lastIndex(r, today);
  return k >= 0 && occurrence(r, k) === today ? today : occurrence(r, k + 1);
}

export interface ReminderData {
  todos: Record<string, Todo>;
  routines: Record<string, Routine>;
  people: Record<string, Person>;
  settings: Pick<Settings, 'google' | 'reminder'>;
}

/** Alle påmindelser, der skal ligge i Google lige nu. `appUrl` sættes i "skriv i dagbogen". */
export function wantedReminders(data: ReminderData, today: string, cal: string, appUrl = ''): Wanted[] {
  const remind = data.settings.google.remind;
  if (!remind?.on) return [];
  const time = remind.time || REMIND_TIME;
  const out: Wanted[] = [];
  for (const t of Object.values(data.todos)) {
    if (!wantsReminder(t)) continue;
    out.push({
      ref: t.id,
      sig: `${t.due}|${time}|${cal}|${t.text}`,
      body: reminderEvent({ summary: t.text, description: 'Huskepunkt fra Dagbog', date: t.due!, time }),
      create: t.due! >= today,
    });
  }
  for (const r of Object.values(data.routines)) {
    if (!r.remindAt) continue;
    const rrule = routineRule(r);
    out.push({
      ref: `r:${r.id}`,
      sig: `${r.icon}|${r.name}|${r.remindAt}|${rrule}|${r.start}|${cal}`,
      body: reminderEvent({ summary: `${r.icon} ${r.name}`.trim(), description: 'Fast ting fra Dagbog', date: firstFrom(r, today), time: r.remindAt, rrule }),
      create: true,
    });
  }
  if (remind.write && data.settings.reminder.enabled) {
    const { time: at, text } = data.settings.reminder;
    out.push({
      ref: 'w',
      sig: `${at}|${text}|${cal}`,
      body: reminderEvent({ summary: text || 'Skriv i dagbogen', description: appUrl ? `Åbn Dagbog: ${appUrl}` : 'Fra Dagbog', date: today, time: at, rrule: 'FREQ=DAILY' }),
      create: true,
    });
  }
  if (remind.birthdays) {
    for (const p of Object.values(data.people)) {
      const next = nextBirthday(p, today);
      if (!next) continue;
      out.push({
        ref: `b:${p.id}`,
        sig: `${p.birthday!.slice(-5)}|${p.name}|${time}|${cal}`,
        body: reminderEvent({ summary: `🎂 ${p.name} har fødselsdag`, description: 'Fødselsdag fra Dagbog (besked på dagen og en uge før)', date: next.date, time, rrule: 'FREQ=YEARLY', popups: [0, WEEK_BEFORE] }),
        create: true,
      });
    }
  }
  return out;
}

/** Hvad skal ændres i Google? `index` er påmindelserne, der ligger der nu. */
export function planReminders(wanted: Wanted[], index: Record<string, TodoEvent>): ReminderPlan {
  const plan: ReminderPlan = { put: [], remove: [] };
  const refs = new Set(wanted.map((w) => w.ref));
  for (const [ref, ev] of Object.entries(index)) {
    if (!refs.has(ref)) plan.remove.push({ ref, ev });
  }
  for (const want of wanted) {
    const old = index[want.ref];
    if (want.create && old?.key !== want.sig) plan.put.push({ want, old });
  }
  return plan;
}
