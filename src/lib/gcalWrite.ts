// Aftaler fra Dagbog til Google Kalender: oprettes, rettes og slettes i Google.
// Aftaler, der kommer fra Google, røres aldrig.
import { addDays } from './dates';
import { GoogleError } from './google';
import type { Appointment } from './types';

const API = 'https://www.googleapis.com/calendar/v3';
const ZONE = 'Europe/Copenhagen';

interface ApiTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

/** "2026-10-29T10:30:00" + minutter, uden tidszone (Google bruger ZONE). */
export function plusMinutes(date: string, time: string, minutes: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const [h, min] = time.split(':').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d, h, min + minutes));
  return t.toISOString().slice(0, 19);
}

/** Aftalen, som Google vil have den. Uden klokkeslæt bliver den en heldagsaftale. */
export function toApiEvent(a: Pick<Appointment, 'title' | 'date' | 'time' | 'place'>, minutes = 60) {
  const start: ApiTime = a.time ? { dateTime: `${a.date}T${a.time}:00`, timeZone: ZONE } : { date: a.date };
  const end: ApiTime = a.time ? { dateTime: plusMinutes(a.date, a.time, minutes), timeZone: ZONE } : { date: addDays(a.date, 1) };
  return { summary: a.title, location: a.place || undefined, description: 'Fra Dagbog', start, end };
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers } });
  } catch {
    throw new GoogleError('Ingen forbindelse til Google.');
  }
  return res;
}

const eventsUrl = (cal: string) => `${API}/calendars/${encodeURIComponent(cal)}/events`;

/** Opretter eller retter aftalen i Google. Giver aftalens plads i Google. */
export async function pushAppointment(token: string, a: Appointment, cal: string): Promise<{ cal: string; id: string }> {
  const body = JSON.stringify(toApiEvent(a, a.minutes ?? 60));
  if (a.google) {
    const r = await call(token, `${eventsUrl(a.google.cal)}/${encodeURIComponent(a.google.id)}`, { method: 'PATCH', body });
    if (r.ok) return { cal: a.google.cal, id: a.google.id };
    // Slettet i Google imellemtiden: lav den igen
    if (r.status !== 404 && r.status !== 410) throw new GoogleError(`Google Kalender svarede med fejl ${r.status}.`);
  }
  const r = await call(token, eventsUrl(cal), { method: 'POST', body });
  if (!r.ok) throw new GoogleError(r.status === 403 ? 'Dagbog må ikke skrive i den kalender.' : `Google Kalender svarede med fejl ${r.status}.`);
  const e = (await r.json()) as { id: string };
  return { cal, id: e.id };
}

/** Sletter aftalen i Google. Er den allerede væk, er det fint. */
export async function deleteEvent(token: string, cal: string, id: string): Promise<void> {
  const r = await call(token, `${eventsUrl(cal)}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 404 && r.status !== 410) throw new GoogleError(`Google Kalender svarede med fejl ${r.status}.`);
}

/** Skal aftalen sendes (igen)? */
export function needsPush(a: Appointment): boolean {
  return !!a.toGoogle && (!a.google || a.google.at < (a.changedAt ?? a.createdAt));
}
