// Kalenderen: egne aftaler, faste ting og aftaler fra samtaler samlet pr. dag.
import { addDays, monthId } from './dates';
import { lastIndex, occurrence, suggestedOption } from './routines';
import type { Appointment, Conversation, GoogleEvent, GoogleMonth, Routine, Settings } from './types';

export interface AgendaItem {
  date: string;
  time: string; // HH:MM eller tom
  title: string;
  icon: string;
  kind: 'appointment' | 'routine' | 'event' | 'google';
  detail?: string; // fx "højre ben" eller sted
  done?: boolean; // faste ting: taget
  ref: string; // id på aftale, fast ting, samtale eller Google-kalender
  color?: string; // Google-kalenderens farve
}

export interface AgendaData {
  appointments: Record<string, Appointment>;
  routines: Record<string, Routine>;
  conversations: Record<string, Conversation>;
  google?: Record<string, GoogleMonth>;
  settings?: Pick<Settings, 'google'>;
}

/** Google-aftaler fra de valgte kalendere, der rører perioden. */
export function googleEvents(data: AgendaData, from: string, to: string): GoogleEvent[] {
  const on = new Map((data.settings?.google.calendars ?? []).filter((c) => c.on).map((c) => [c.id, c]));
  const out: GoogleEvent[] = [];
  for (const m of Object.values(data.google ?? {})) {
    // Aftaler over flere dage ligger under startmåneden
    if (m.id > monthId(to)) continue;
    for (const e of m.events) {
      if (on.has(e.cal) && e.date <= to && e.end >= from) out.push(e);
    }
  }
  return out;
}

/** Alle punkter fra `from` til `to` (begge med), sorteret efter dato og tid. */
export function agenda(data: AgendaData, from: string, to: string): AgendaItem[] {
  const out: AgendaItem[] = [];
  // Aftaler fra Dagbog, der også ligger i Google, vises kun én gang
  const inGoogle = new Set(Object.values(data.appointments).map((a) => a.google?.id).filter(Boolean));
  const taken = new Set(Object.values(data.appointments).filter((a) => a.fromTalk).map((a) => `${a.fromTalk}|${a.date}|${a.title}`));
  for (const a of Object.values(data.appointments)) {
    if (a.date >= from && a.date <= to) out.push({ date: a.date, time: a.time, title: a.title, icon: '🗓', kind: 'appointment', detail: a.place || undefined, ref: a.id });
  }
  for (const c of Object.values(data.conversations)) {
    for (const ev of c.events ?? []) {
      if (ev.date >= from && ev.date <= to && !taken.has(`${c.id}|${ev.date}|${ev.title}`)) out.push({ date: ev.date, time: ev.time, title: ev.title, icon: '💬', kind: 'event', detail: ev.place || undefined, ref: c.id });
    }
  }
  const colors = new Map((data.settings?.google.calendars ?? []).map((c) => [c.id, c.color]));
  for (const e of googleEvents(data, from, to)) {
    if (inGoogle.has(e.id)) continue;
    // Aftaler over flere dage står på hver dag (højst 60)
    let d = e.date < from ? from : e.date;
    for (let n = 0; d <= e.end && d <= to && n < 60; n++, d = addDays(d, 1)) {
      out.push({ date: d, time: d === e.date ? e.time : '', title: e.title, icon: '', kind: 'google', detail: e.place || undefined, ref: e.cal, color: colors.get(e.cal) });
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
