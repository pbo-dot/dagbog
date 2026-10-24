// Kalenderen: egne aftaler, faste ting og aftaler fra samtaler samlet pr. dag.
import { addDays } from './dates';
import { lastIndex, occurrence, suggestedOption } from './routines';
import type { Appointment, Conversation, Routine } from './types';

export interface AgendaItem {
  date: string;
  time: string; // HH:MM eller tom
  title: string;
  icon: string;
  kind: 'appointment' | 'routine' | 'event';
  detail?: string; // fx "højre ben" eller sted
  done?: boolean; // faste ting: taget
  ref: string; // id på aftale, fast ting eller samtale
}

export interface AgendaData {
  appointments: Record<string, Appointment>;
  routines: Record<string, Routine>;
  conversations: Record<string, Conversation>;
}

/** Alle punkter fra `from` til `to` (begge med), sorteret efter dato og tid. */
export function agenda(data: AgendaData, from: string, to: string): AgendaItem[] {
  const out: AgendaItem[] = [];
  for (const a of Object.values(data.appointments)) {
    if (a.date >= from && a.date <= to) out.push({ date: a.date, time: a.time, title: a.title, icon: '🗓', kind: 'appointment', detail: a.place || undefined, ref: a.id });
  }
  for (const c of Object.values(data.conversations)) {
    for (const ev of c.events ?? []) {
      if (ev.date >= from && ev.date <= to) out.push({ date: ev.date, time: ev.time, title: ev.title, icon: '💬', kind: 'event', detail: ev.place || undefined, ref: c.id });
    }
  }
  for (const r of Object.values(data.routines)) {
    let k = Math.max(0, lastIndex(r, addDays(from, -1)) + 1);
    for (let guard = 0; guard < 400; guard++, k++) {
      const d = occurrence(r, k);
      if (d > to) break;
      if (d < from) continue;
      const log = r.log.find((l) => l.due === d);
      out.push({ date: d, time: '', title: r.name, icon: r.icon, kind: 'routine', detail: log?.option ?? suggestedOption(r, k), done: !!log, ref: r.id });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99') || a.title.localeCompare(b.title, 'da'));
}

/** "kl. 10.00" eller tom. */
export const at = (time: string) => (time ? `kl. ${time.replace(':', '.')}` : '');
