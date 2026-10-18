// Datoer håndteres som lokale kalenderdatoer "YYYY-MM-DD".

export const WEEKDAYS = ['søndag', 'mandag', 'tirsdag', 'onsdag', 'torsdag', 'fredag', 'lørdag'];
export const MONTHS = [
  'januar', 'februar', 'marts', 'april', 'maj', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'december',
];

const pad = (n: number) => String(n).padStart(2, '0');

export function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISO(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

export function today(): string {
  return toISO(new Date());
}

export function addDays(iso: string, n: number): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(iso: string, n: number): string {
  const d = fromISO(iso);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return toISO(d);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Lørdag 18. oktober" (+ år hvis ikke i år) */
export function formatLong(iso: string): string {
  const d = fromISO(iso);
  const year = d.getFullYear() !== new Date().getFullYear() ? ` ${d.getFullYear()}` : '';
  return `${cap(WEEKDAYS[d.getDay()])} ${d.getDate()}. ${MONTHS[d.getMonth()]}${year}`;
}

/** "18. okt. 2026" */
export function formatShort(iso: string): string {
  const d = fromISO(iso);
  return `${d.getDate()}. ${MONTHS[d.getMonth()].slice(0, 3)}. ${d.getFullYear()}`;
}

export function monthId(iso: string): string {
  return iso.slice(0, 7);
}

export function formatMonth(id: string): string {
  const [y, m] = id.split('-').map(Number);
  return `${cap(MONTHS[m - 1])} ${y}`;
}

export function prevMonthId(id: string): string {
  return monthId(addMonths(`${id}-01`, -1));
}

// ISO-uger (mandag–søndag)
export function weekId(iso: string): string {
  const d = fromISO(iso);
  const day = (d.getDay() + 6) % 7; // mandag = 0
  d.setDate(d.getDate() - day + 3); // torsdag i ugen
  const year = d.getFullYear();
  const firstMonday = fromISO(weekStart(toISO(new Date(year, 0, 4, 12))));
  const thisMonday = fromISO(weekStart(toISO(d)));
  const week = 1 + Math.round((thisMonday.getTime() - firstMonday.getTime()) / (7 * 86400000));
  return `${year}-W${pad(week)}`;
}

export function weekStart(iso: string): string {
  const d = fromISO(iso);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toISO(d);
}

/** Mandag i en given ISO-uge */
export function weekIdStart(id: string): string {
  const [y, w] = id.split('-W').map(Number);
  const jan4 = toISO(new Date(y, 0, 4, 12));
  return addDays(weekStart(jan4), (w - 1) * 7);
}

export function weekDays(id: string): string[] {
  const start = weekIdStart(id);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function formatWeek(id: string): string {
  const days = weekDays(id);
  const a = fromISO(days[0]);
  const b = fromISO(days[6]);
  const w = Number(id.split('-W')[1]);
  const range =
    a.getMonth() === b.getMonth()
      ? `${a.getDate()}.–${b.getDate()}. ${MONTHS[b.getMonth()]}`
      : `${a.getDate()}. ${MONTHS[a.getMonth()].slice(0, 3)}. – ${b.getDate()}. ${MONTHS[b.getMonth()].slice(0, 3)}.`;
  return `Uge ${w} · ${range}`;
}

/** Dagen i ugen (id) hvor opsummeringen "lander", fx søndag. */
export function summaryDayOf(id: string, weekday: number): string {
  return weekDays(id)[(weekday + 6) % 7];
}

/** Den seneste uge hvis opsummeringsdag er nået. */
export function currentSummaryWeek(todayIso: string, weekday: number): string {
  const thisWeek = weekId(todayIso);
  return summaryDayOf(thisWeek, weekday) <= todayIso ? thisWeek : weekId(addDays(todayIso, -7));
}

/** "Lørdag 18. oktober 2026" – altid med år */
export function formatFull(iso: string): string {
  const d = fromISO(iso);
  return `${cap(WEEKDAYS[d.getDay()])} ${d.getDate()}. ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
