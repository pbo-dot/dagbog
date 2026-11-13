// Påmindelser om huskepunkter med frist: lægges i Google Kalender, som giver beskeden på telefonen,
// også når Dagbog er lukket. Dagbog kan kun rette i Google, mens appen er åben.
import type { Todo, TodoEvent } from './types';

export const REMIND_TIME = '09:00';

export interface ReminderPlan {
  put: Array<{ todo: Todo; key: string; old?: TodoEvent }>; // skal oprettes eller rettes
  remove: Array<{ todoId: string; ev: TodoEvent }>; // skal slettes i Google
}

/** Det, der sidst blev sendt: ændrer frist, tid, kalender eller tekst sig, rettes påmindelsen. */
export const reminderKey = (t: Todo, time: string, cal: string) => `${t.due}|${time}|${cal}|${t.text}`;

/** Skal punktet have en påmindelse? Åbent, med frist, ikke lagt væk. */
export const wantsReminder = (t: Todo | undefined): t is Todo => !!t && !!t.due && !t.doneAt && !t.someday;

/**
 * Hvad skal ændres i Google? `index` er påmindelserne, der ligger der nu.
 * Nye påmindelser laves kun for frister fra i dag og frem; en gammel, der er overskredet, får lov at ligge.
 */
export function planReminders(todos: Record<string, Todo>, index: Record<string, TodoEvent>, today: string, time: string, cal: string, on: boolean): ReminderPlan {
  const plan: ReminderPlan = { put: [], remove: [] };
  for (const [todoId, ev] of Object.entries(index)) {
    if (!on || !wantsReminder(todos[todoId])) plan.remove.push({ todoId, ev });
  }
  if (!on) return plan;
  for (const t of Object.values(todos)) {
    if (!wantsReminder(t)) continue;
    const key = reminderKey(t, time, cal);
    const old = index[t.id];
    if (t.due! >= today && old?.key !== key) plan.put.push({ todo: t, key, old });
  }
  return plan;
}
