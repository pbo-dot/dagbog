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

