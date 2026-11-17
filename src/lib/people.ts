// Mennesker: fødselsdage og grupper.
import { fromISO } from './dates';
import type { Person } from './types';

export interface NextBirthday {
  date: string; // næste fødselsdag (YYYY-MM-DD)
  days: number; // dage til (0 = i dag)
  age: number | null; // alder på dagen, hvis fødselsåret kendes
}

/** Næste fødselsdag fra og med i dag. Fødselsdagen kan være "YYYY-MM-DD" eller "--MM-DD". */
export function nextBirthday(p: Pick<Person, 'birthday'>, todayIso: string): NextBirthday | null {
  const m = p.birthday?.match(/^(\d{4}|-)-?(\d{2})-(\d{2})$/);
  if (!m) return null;
  const born = m[1] === '-' ? null : Number(m[1]);
  let year = Number(todayIso.slice(0, 4));
  let date = '';
  for (let i = 0; i < 2; i++, year++) {
    // 29. februar fejres 28. februar i år uden skuddag
    const d = new Date(year, Number(m[2]) - 1, Number(m[3]));
    if (d.getMonth() !== Number(m[2]) - 1) d.setDate(0);
    date = `${year}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (date >= todayIso) break;
  }
  const days = Math.round((fromISO(date).getTime() - fromISO(todayIso).getTime()) / 86_400_000);
  return { date, days, age: born ? Number(date.slice(0, 4)) - born : null };
}

/** Nuværende alder, hvis fødselsåret kendes. */
export function currentAge(p: Pick<Person, 'birthday'>, todayIso: string): number | null {
  const n = nextBirthday(p, todayIso);
  if (!n || n.age === null) return null;
  return n.days === 0 ? n.age : n.age - 1;
}

/** Personer med fødselsdag inden for `within` dage, nærmeste først. */
export function upcomingBirthdays(people: Person[], todayIso: string, within = 60): { person: Person; next: NextBirthday }[] {
  return people
    .map((person) => ({ person, next: nextBirthday(person, todayIso) }))
    .filter((x): x is { person: Person; next: NextBirthday } => !!x.next && x.next.days <= within)
    .sort((a, b) => a.next.days - b.next.days);
}

/** "i dag", "i morgen", "om 5 dage". */
export function inDays(days: number): string {
  return days === 0 ? 'i dag' : days === 1 ? 'i morgen' : `om ${days} dage`;
}

export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('');


/**
 * Navnet i en fødselsdag fra kalenderen, fx "Birgittes fødselsdag", "Hans' fødselsdag", "Fødselsdag: Mor",
 * "Birgitte's birthday" eller "Birgitte fylder 50" (så kendes året også). Ellers null.
 */
export function birthdayFromTitle(title: string): { name: string; age?: number } | null {
  const t = title.replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/\s+/g, ' ').trim();
  const pats: RegExp[] = [
    /^(.+?)(?:['’]s|['’]|s) (?:fødselsdag|birthday)$/i,
    /^(.+?) (?:har )?fødselsdag$/i,
    /^(?:fødselsdag|birthday)(?: ?[:\-–] ?| )(.+)$/i,
  ];
  const age = t.match(/^(.+?) fylder (\d{1,3})(?: år)?$/i);
  if (age) return { name: age[1].trim(), age: Number(age[2]) };
  for (const p of pats) {
    const m = t.match(p);
    if (m && m[1].trim().length >= 2 && !/^(hos|for|i|til|med|fest)\b/i.test(m[1].trim())) return { name: m[1].trim() };
  }
  return null;
}

/** Er denne kalender-aftale fødselsdagen for en person under Mennesker (samme navn og dag)? Så vises den kun én gang. */
export function isPersonBirthday(title: string, date: string, people: Person[]): boolean {
  const b = birthdayFromTitle(title);
  if (!b) return false;
  const n = b.name.toLowerCase();
  return people.some((p) => p.birthday?.slice(-5) === date.slice(-5) && p.name.toLowerCase() === n);
}

export interface CalendarBirthday {
  name: string;
  birthday: string; // YYYY-MM-DD, eller --MM-DD når året ikke kendes
  person?: Person; // findes allerede under Mennesker (uden fødselsdag)
}

/** Fødselsdage i de hentede Google-aftaler, som ikke allerede står under Mennesker. Én pr. navn. */
export function calendarBirthdays(events: Array<{ title: string; date: string }>, people: Person[], todayIso = new Date().toISOString().slice(0, 10)): CalendarBirthday[] {
  const byName = new Map(people.map((p) => [p.name.toLowerCase(), p]));
  const found = new Map<string, CalendarBirthday>();
  for (const e of events) {
    const b = birthdayFromTitle(e.title);
    if (!b) continue;
    const key = b.name.toLowerCase();
    const person = byName.get(key);
    if (person?.birthday) continue;
    const year = b.age !== undefined ? Number(e.date.slice(0, 4)) - b.age : null;
    const birthday = year ? `${year}${e.date.slice(4)}` : `--${e.date.slice(5)}`;
    const before = found.get(key);
    if (!before || (before.birthday.startsWith('--') && year)) found.set(key, { name: b.name, birthday, person });
  }
  // Den næste først
  const days = (b: CalendarBirthday) => nextBirthday(b, todayIso)?.days ?? 400;
  return [...found.values()].sort((a, b) => days(a) - days(b));
}
