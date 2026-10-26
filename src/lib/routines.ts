// Faste ting på en fast plan: hvornår de skal tages, om de er taget, og hvad næste gang er.
import { addDays, fromISO, toISO } from './dates';
import type { Routine } from './types';

/** Den k'te gang (0 = første gang). */
export function occurrence(r: Routine, k: number): string {
  if (!r.monthly) return addDays(r.start, k * Math.max(1, r.everyDays));
  const s = fromISO(r.start);
  const day = s.getDate();
  const d = new Date(s.getFullYear(), s.getMonth() + k, 1, 12);
  // Fx den 31.: brug sidste dag i måneder, der er kortere
  d.setDate(Math.min(day, new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()));
  return toISO(d);
}

/** Nummeret på den seneste gang, der ligger på eller før `date` (-1 hvis ingen endnu). */
export function lastIndex(r: Routine, date: string): number {
  if (date < r.start) return -1;
  if (!r.monthly) {
    const days = Math.round((fromISO(date).getTime() - fromISO(r.start).getTime()) / 86_400_000);
    return Math.floor(days / Math.max(1, r.everyDays));
  }
  let k = 0;
  while (occurrence(r, k + 1) <= date) k++;
  return k;
}

/** Næste planlagte dag efter `date`. */
export function nextAfter(r: Routine, date: string): string {
  return occurrence(r, lastIndex(r, date) + 1);
}

/**
 * Hvad der foreslås den k'te gang: rækken fortsætter fra det sidst brugte
 * (også flere gange frem, fx i kalenderen). Uden historik: i rækkefølge fra start.
 */
export function suggestedOption(r: Routine, k: number): string | undefined {
  const n = r.options.length;
  if (!n) return undefined;
  const mod = (x: number) => ((x % n) + n) % n;
  const last = r.log.find((l) => l.option && r.options.includes(l.option));
  if (last) return r.options[mod(r.options.indexOf(last.option!) + k - lastIndex(r, last.due))];
  return r.options[mod(k)];
}

export type RoutineStatus =
  | { kind: 'due'; due: string; late: boolean; option?: string }
  | { kind: 'done'; due: string; at: number; option?: string; next: string; nextOption?: string }
  | { kind: 'none' };

/**
 * Status i dag: "due" hvis den seneste planlagte gang (i dag eller tidligere)
 * ikke er markeret, "done" hvis den er markeret i dag eller planlagt i dag.
 * Ældre glemte gange vises ikke, kun den seneste.
 */
export function routineStatus(r: Routine, today: string): RoutineStatus {
  const k = lastIndex(r, today);
  if (k < 0) return { kind: 'none' };
  const due = occurrence(r, k);
  const done = r.log.find((l) => l.due === due);
  if (!done) return { kind: 'due', due, late: due < today, option: suggestedOption(r, k) };
  const doneToday = due === today || toISO(new Date(done.at)) === today;
  if (!doneToday) return { kind: 'none' };
  return { kind: 'done', due, at: done.at, option: done.option, next: occurrence(r, k + 1), nextOption: suggestedOption(r, k + 1) };
}

/**
 * Skal den tages i morgen? Kun for ting, der ikke er daglige (ellers ville
 * linjen altid stå der), og kun når dagens gang ikke mangler.
 */
export function dueTomorrow(r: Routine, today: string): { option?: string } | null {
  if (!r.monthly && r.everyDays <= 1) return null;
  const tomorrow = addDays(today, 1);
  const k = lastIndex(r, tomorrow);
  if (k < 0 || occurrence(r, k) !== tomorrow) return null;
  if (routineStatus(r, today).kind === 'due') return null;
  return { option: suggestedOption(r, k) };
}

/** Kort tekst om hvor ofte, fx "hver 14. dag". */
export function everyText(r: Pick<Routine, 'everyDays' | 'monthly'>): string {
  if (r.monthly) return 'hver måned';
  if (r.everyDays === 1) return 'hver dag';
  if (r.everyDays === 7) return 'hver uge';
  return `hver ${r.everyDays}. dag`;
}

/** Den planlagte dag, der ligger tættest på `date` (en gang taget lidt før eller efter tiden). */
export function nearestDue(r: Routine, date: string): string {
  const k = lastIndex(r, date);
  if (k < 0) return occurrence(r, 0);
  const before = occurrence(r, k);
  const after = occurrence(r, k + 1);
  const dist = (d: string) => Math.abs(fromISO(d).getTime() - fromISO(date).getTime());
  return dist(after) < dist(before) ? after : before;
}

/**
 * Markér som taget på en bestemt dag og tid (fx glemt at trykke i søndags).
 * Ligger dagen før "Første gang", flyttes starten dertil, så planen regnes derfra.
 */
export function markTaken(r: Routine, date: string, time: string, option?: string): Routine {
  const start = date < r.start ? date : r.start;
  const moved = { ...r, start };
  const due = nearestDue(moved, date);
  const [h, m] = (time || '12:00').split(':').map(Number);
  const d = fromISO(date);
  d.setHours(h, m, 0, 0);
  const log = [{ due, at: d.getTime(), option }, ...r.log.filter((l) => l.due !== due)].sort((a, b) => b.at - a.at);
  return { ...moved, log };
}
