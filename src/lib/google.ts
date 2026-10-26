// Google: dagbogen henter selv aftalerne (kun læsning) og gemmer sin låste
// kopi på Drev (drive.file: kun filer, dagbogen selv har lavet).
// Login sker ved at gå til Google og tilbage (ingen popup og ingen fremmede
// scripts). Google sender en adgangsnøgle tilbage i adressen, som gælder en
// time og kun gemmes i fanen (sessionStorage), aldrig sammen med dagbogen.
import { addDays, addMonths, monthId, toISO } from './dates';
import { vaultDelete, vaultGet, vaultSet } from './db';
import type { GoogleCalendarInfo, GoogleEvent } from './types';

const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/drive.file';
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN = 'dagbog-gtoken';
const STATE = 'dagbog-gstate';
const ERROR = 'dagbog-gerror';
/** Henter automatisk igen, når aftalerne er ældre end dette (og der er en gyldig nøgle). */
export const STALE_MS = 15 * 60_000;
/** Automatisk login ved åbning højst så ofte. */
const AUTO_EVERY_MS = 3 * 60 * 60_000;

/** Uden for kryptering, så login kan ske, før dagbogen låses op. */
interface Hint {
  clientId: string;
  email: string;
  lastAuto: number;
}

/** Dagbogens klient-id fra Google Cloud (ikke hemmeligt). Kan også sættes i Indstillinger. */
export const GOOGLE_CLIENT_ID = '548527737265-kunne8tl24f4shdq3s84eki43qmpt3uq.apps.googleusercontent.com';

export function clientIdOf(g: { clientId: string }): string {
  return g.clientId || GOOGLE_CLIENT_ID;
}

export class GoogleError extends Error {}

/** Adressen, Google sender tilbage til (skal stå i Google Cloud). */
export function redirectUri(): string {
  return location.origin + location.pathname.replace(/index\.html$/, '');
}

export function authUrl(clientId: string, state: string, opts: { hint?: string; silent?: boolean } = {}): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: SCOPE,
    include_granted_scopes: 'true',
    state,
  });
  if (opts.hint) q.set('login_hint', opts.hint);
  if (opts.silent) q.set('prompt', 'none');
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

function session(): Storage | null {
  try {
    return sessionStorage;
  } catch {
    return null;
  }
}

/** Går til Google for at logge ind. Den nuværende side huskes og vises igen bagefter. */
export function signIn(clientId: string, opts: { hint?: string; silent?: boolean; back?: string } = {}) {
  const nonce = crypto.randomUUID();
  session()?.setItem(STATE, nonce);
  session()?.removeItem(ERROR);
  location.assign(authUrl(clientId, `${nonce}|${opts.back ?? (location.hash || '#/kalender')}`, opts));
}

/**
 * Læser svaret fra Google i adressen (kaldes ved start, før appen vises).
 * Returnerer true, hvis adressen var et svar fra Google.
 */
export function takeTokenFromUrl(): boolean {
  const h = location.hash.slice(1);
  if (!/(^|&)(access_token|error)=/.test(h)) return false;
  const p = new URLSearchParams(h);
  const [nonce, back] = (p.get('state') ?? '').split('|');
  const s = session();
  const ok = !!nonce && nonce === s?.getItem(STATE);
  s?.removeItem(STATE);
  if (ok && p.get('access_token')) {
    const exp = Date.now() + (Number(p.get('expires_in')) || 3600) * 1000;
    s?.setItem(TOKEN, JSON.stringify({ token: p.get('access_token'), exp, scope: p.get('scope') ?? '' }));
  } else if (ok && p.get('error')) {
    s?.setItem(ERROR, p.get('error')!);
  }
  history.replaceState(null, '', location.pathname + location.search + (back && back.startsWith('#/') ? back : '#/kalender'));
  return true;
}

/** Gyldig adgangsnøgle, eller null. */
export function currentToken(): string | null {
  try {
    const v = JSON.parse(session()?.getItem(TOKEN) ?? 'null') as { token: string; exp: number } | null;
    return v && v.exp > Date.now() + 60_000 ? v.token : null;
  } catch {
    return null;
  }
}

/** Gyldig adgangsnøgle, der også må gemme på Drev, eller null. */
export function driveToken(): string | null {
  try {
    const v = JSON.parse(session()?.getItem(TOKEN) ?? 'null') as { token: string; exp: number; scope?: string } | null;
    return v && v.exp > Date.now() + 60_000 && (v.scope ?? '').includes(DRIVE_SCOPE) ? v.token : null;
  } catch {
    return null;
  }
}

export function dropToken() {
  session()?.removeItem(TOKEN);
}

/** Google svarede med en fejl ved sidste login (fx "interaction_required"). */
export function lastError(): string | null {
  return session()?.getItem(ERROR) ?? null;
}

export async function saveHint(clientId: string, email: string) {
  const old = await vaultGet<Hint>('google');
  await vaultSet('google', { clientId, email, lastAuto: old?.lastAuto ?? 0 });
}

export async function forget() {
  dropToken();
  await vaultDelete('google');
}

/**
 * Ved åbning: er Google forbundet, og er der ingen gyldig nøgle, så hent en ny
 * uden at spørge (prompt=none). Google sender straks tilbage. Højst hver 3. time,
 * og ikke når appen åbnes med delt tekst.
 */
export async function autoSignIn(): Promise<boolean> {
  if (currentToken() || location.search || !navigator.onLine) return false;
  const hint = await vaultGet<Hint>('google').catch(() => undefined);
  if (!hint?.clientId || !hint.email || Date.now() - hint.lastAuto < AUTO_EVERY_MS) return false;
  await vaultSet('google', { ...hint, lastAuto: Date.now() });
  signIn(hint.clientId, { hint: hint.email, silent: true });
  return true;
}

async function get<T>(token: string, path: string, params: Record<string, string> = {}): Promise<T> {
  const url = `${API}${path}?${new URLSearchParams(params)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  } catch {
    throw new GoogleError('Ingen forbindelse til Google.');
  }
  if (res.status === 401) {
    dropToken();
    throw new GoogleError('Google-login er udløbet. Tryk Opdatér.');
  }
  if (!res.ok) throw new GoogleError(`Google svarede med fejl ${res.status}.`);
  return res.json() as Promise<T>;
}

interface ApiCalendar {
  id: string;
  summary: string;
  summaryOverride?: string;
  backgroundColor?: string;
  primary?: boolean;
  accessRole?: string;
}

interface ApiTime {
  date?: string;
  dateTime?: string;
}

export interface ApiEvent {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: ApiTime;
  end?: ApiTime;
}

/** Omsætter en aftale fra Googles API. Aflyste aftaler giver null. */
export function toEvent(e: ApiEvent, cal: string): GoogleEvent | null {
  if (e.status === 'cancelled' || !e.start) return null;
  let date: string, end: string, time = '';
  if (e.start.date) {
    date = e.start.date;
    // Heldagsaftaler: Googles slutdato er dagen efter
    end = e.end?.date ? addDays(e.end.date, -1) : date;
  } else if (e.start.dateTime) {
    const s = new Date(e.start.dateTime);
    date = toISO(s);
    time = `${String(s.getHours()).padStart(2, '0')}:${String(s.getMinutes()).padStart(2, '0')}`;
    // Slutter den lige ved midnat, tæller den sidste dag ikke med
    end = e.end?.dateTime ? toISO(new Date(new Date(e.end.dateTime).getTime() - 1)) : date;
  } else return null;
  if (end < date) end = date;
  return { id: e.id, cal, title: (e.summary ?? '').trim() || '(uden titel)', date, end, time, place: (e.location ?? '').trim() };
}

/** Grupperer aftaler efter startmåned. */
export function byMonth(events: GoogleEvent[]): Record<string, GoogleEvent[]> {
  const out: Record<string, GoogleEvent[]> = {};
  for (const e of events) (out[monthId(e.date)] ??= []).push(e);
  for (const list of Object.values(out)) list.sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
  return out;
}

/** Måneder fra og med `from` til og med `to` (YYYY-MM). */
export function monthRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = `${from}-01`; monthId(d) <= to; d = addMonths(d, 1)) out.push(monthId(d));
  return out;
}

/** Perioden, der hentes: det seneste år og 6 måneder frem (hele måneder). */
export function syncWindow(todayIso: string): { from: string; to: string } {
  return { from: monthId(addMonths(todayIso, -12)), to: monthId(addMonths(todayIso, 6)) };
}

/** Nye kalendere vises, hvis de er ens egne; abonnementer (helligdage o.l.) er slået fra. */
export function mergeCalendars(old: GoogleCalendarInfo[], fresh: ApiCalendar[]): GoogleCalendarInfo[] {
  return fresh.map((c) => {
    const before = old.find((o) => o.id === c.id);
    return {
      id: c.id,
      name: c.summaryOverride || c.summary || c.id,
      color: c.backgroundColor || '#1a73e8',
      on: before ? before.on : !!c.primary || c.accessRole === 'owner',
    };
  });
}

export interface SyncResult {
  email: string;
  calendars: ApiCalendar[];
  months: Record<string, GoogleEvent[]>;
  window: string[];
}

/** Henter alle kalendere og deres aftaler i perioden. */
export async function fetchGoogle(token: string, todayIso: string): Promise<SyncResult> {
  const { items: calendars = [] } = await get<{ items?: ApiCalendar[] }>(token, '/users/me/calendarList', { maxResults: '250' });
  const { from, to } = syncWindow(todayIso);
  const timeMin = new Date(`${from}-01T00:00:00`).toISOString();
  const timeMax = new Date(`${addMonths(`${to}-01`, 1)}T00:00:00`).toISOString();
  const events: GoogleEvent[] = [];
  for (const c of calendars) {
    let pageToken = '';
    for (let page = 0; page < 20; page++) {
      const params: Record<string, string> = { timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '2500' };
      if (pageToken) params.pageToken = pageToken;
      const r = await get<{ items?: ApiEvent[]; nextPageToken?: string }>(token, `/calendars/${encodeURIComponent(c.id)}/events`, params);
      for (const e of r.items ?? []) {
        const ev = toEvent(e, c.id);
        if (ev) events.push(ev);
      }
      if (!r.nextPageToken) break;
      pageToken = r.nextPageToken;
    }
  }
  const primary = calendars.find((c) => c.primary);
  return { email: primary?.id ?? '', calendars, months: byMonth(events), window: monthRange(from, to) };
}
