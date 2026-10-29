// Huskelisten: ting, der skal gøres, men ikke på et bestemt tidspunkt.
// Et punkt står i "I dag", indtil det er klaret. Det kan udsættes til en dag
// (showFrom) eller lægges væk til "Engang" (someday), så "I dag" ikke drukner.
import { addDays, formatLong, fromISO } from './dates';
import type { Todo } from './types';

/** Så mange huskepunkter vises højst under "I dag". */
export const TODAY_MAX = 3;

/** Klarede punkter vises så mange dage under "Klaret". */
const DONE_DAYS = 7;

/** Står punktet i "Nu" (og dermed i "I dag")? */
export function isNow(t: Todo, today: string): boolean {
  return !t.doneAt && !t.someday && (!t.showFrom || t.showFrom <= today);
}

/** Frist først (tidligste øverst), så de ældste. */
function byUrgency(a: Todo, b: Todo): number {
  if (a.due && b.due && a.due !== b.due) return a.due.localeCompare(b.due);
  if (a.due && !b.due) return -1;
  if (!a.due && b.due) return 1;
  return a.createdAt - b.createdAt;
}

export interface TodoGroups {
  now: Todo[];
  later: Todo[]; // udsat til en dag
  someday: Todo[];
  done: Todo[]; // klaret de seneste dage, nyeste først
}

export function groupTodos(all: Record<string, Todo>, today: string, now = Date.now()): TodoGroups {
  const list = Object.values(all);
  const open = list.filter((t) => !t.doneAt);
  return {
    now: open.filter((t) => isNow(t, today)).sort(byUrgency),
    later: open.filter((t) => !t.someday && t.showFrom && t.showFrom > today).sort((a, b) => a.showFrom!.localeCompare(b.showFrom!) || byUrgency(a, b)),
    someday: open.filter((t) => t.someday).sort(byUrgency),
    done: list.filter((t) => t.doneAt && now - t.doneAt < DONE_DAYS * 86_400_000).sort((a, b) => b.doneAt! - a.doneAt!),
  };
}

/** "Frist i dag", "Frist i morgen", "Frist fredag 31. oktober", "Fristen var i går". */
export function dueText(due: string, today: string): string {
  if (due === today) return 'Frist i dag';
  if (due === addDays(today, 1)) return 'Frist i morgen';
  if (due < today) return due === addDays(today, -1) ? 'Fristen var i går' : `Fristen var ${shortDate(due)}`;
  return `Frist ${formatLong(due).toLowerCase()}`;
}

/** Fristen er i dag, i morgen eller overskredet. */
export function dueSoon(due: string | undefined, today: string): boolean {
  return !!due && due <= addDays(today, 1);
}

/** "5. nov." */
export function shortDate(iso: string): string {
  const d = fromISO(iso);
  return `${d.getDate()}. ${['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'][d.getMonth()]}.`;
}

/** Valg til "Vis igen": i morgen, om 3 dage og om en uge. */
export function postponeChoices(today: string): Array<{ label: string; date: string }> {
  return [
    { label: 'I morgen', date: addDays(today, 1) },
    { label: 'Om 3 dage', date: addDays(today, 3) },
    { label: 'Om en uge', date: addDays(today, 7) },
  ];
}
