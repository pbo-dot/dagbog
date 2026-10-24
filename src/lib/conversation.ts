// Samtaler: resuméet lægges i dagens dagbog og som noter på de personer, der var med.
import type { CalendarEvent, Conversation, Draft, Entry, Person } from './types';

/** Teksten, der lægges i dagbogen for samtalens dag. */
export function diaryBlock(c: Conversation, people: Record<string, Person>): string {
  const names = c.people.map((id) => people[id]?.name).filter(Boolean);
  const lines = [`Samtale: ${c.title}${names.length ? ` (med ${names.join(', ')})` : ''}`];
  if (c.summary) lines.push(c.summary);
  if (c.agreements.length) lines.push(`Aftaler:\n${c.agreements.map((a) => `– ${a}`).join('\n')}`);
  if (c.remember.length) lines.push(`Husk:\n${c.remember.map((a) => `– ${a}`).join('\n')}`);
  return lines.join('\n');
}

function append(text: string, block: string): string {
  const t = text.trimEnd();
  return t ? `${t}\n\n${block}` : block;
}

/**
 * Dagens post med samtalen tilføjet nederst (en ny post, hvis dagen er tom).
 * Er der en kladde for dagen, får den også teksten, så den ikke overskriver den,
 * når kladden gemmes.
 */
export function withConversation(entry: Entry | undefined, draft: Draft | null, date: string, block: string, now = Date.now()): { entry: Entry; draft: Draft | null } {
  const next: Entry = entry
    ? { ...entry, text: append(entry.text, block), updatedAt: now }
    : { date, text: block, mood: null, tags: [], good: [], createdAt: now, updatedAt: now };
  const nextDraft = draft && draft.date === date ? { ...draft, text: append(draft.text, block) } : draft;
  return { entry: next, draft: nextDraft };
}

/** Personer fra listen, hvis fornavn optræder i et af navnene fra resuméet. */
export function matchPeople(names: string[], people: Record<string, Person>): string[] {
  const wanted = names.map((n) => n.trim().toLowerCase()).filter(Boolean);
  return Object.values(people)
    .filter((p) => {
      const first = p.name.trim().split(/\s+/)[0]?.toLowerCase();
      return !!first && first.length > 1 && wanted.some((n) => n.split(/\s+/).includes(first));
    })
    .map((p) => p.id);
}

/** Kort note til en person om samtalen. */
export function personNote(c: Conversation): string {
  const first = c.agreements[0] ?? c.remember[0];
  return `Samtale: ${c.title}${first ? ` – ${first}` : ''}`;
}

/** Tekst delt til appen (fx fra Pixel Optager), læst fra adressen ved start. */
let shared: string | null = null;
let sharedAudio = false;

export function readSharedText(): void {
  const q = new URLSearchParams(location.search);
  if (q.get('lyd')) {
    sharedAudio = true;
    history.replaceState(null, '', location.pathname + location.hash);
    return;
  }
  const text = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n\n').trim();
  if (!text) return;
  shared = text;
  // Fjern teksten fra adressen, så den ikke bliver liggende i historikken.
  history.replaceState(null, '', location.pathname + location.hash);
}

export function hasSharedText(): boolean {
  return shared !== null || sharedAudio;
}

export interface SharedAudio {
  blob: Blob;
  name: string;
  modified: number;
}

/** En lydfil delt fra en anden app (fx Optager). Hentes én gang og slettes fra cachen. */
export async function takeSharedAudio(): Promise<SharedAudio | null> {
  if (!sharedAudio) return null;
  sharedAudio = false;
  try {
    const cache = await caches.open('dagbog-delt-lyd');
    const res = await cache.match('lyd');
    if (!res) return null;
    await cache.delete('lyd');
    return {
      blob: await res.blob(),
      name: decodeURIComponent(res.headers.get('X-Name') ?? 'optagelse'),
      modified: Number(res.headers.get('X-Modified')) || Date.now(),
    };
  } catch {
    return null;
  }
}

export function takeSharedText(): string | null {
  const t = shared;
  shared = null;
  return t;
}

// ---------- Kalender ----------

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Start og slut for en aftale; uden klokkeslæt er det en heldagsaftale. */
function eventTimes(ev: CalendarEvent) {
  const [y, m, d] = ev.date.split('-').map(Number);
  const tm = /^(\d{1,2}):(\d{2})$/.exec(ev.time.trim());
  if (!tm) return { allDay: true as const, y, m, d };
  const start = new Date(y, m - 1, d, Number(tm[1]), Number(tm[2]));
  const end = new Date(start.getTime() + Math.max(5, ev.durationMinutes || 60) * 60_000);
  return { allDay: false as const, start, end };
}

const stamp = (t: Date) =>
  `${t.getFullYear()}${pad2(t.getMonth() + 1)}${pad2(t.getDate())}T${pad2(t.getHours())}${pad2(t.getMinutes())}00`;

/** Google Kalender i browseren med aftalen udfyldt; den gemmes først, når man trykker Gem. */
export function googleCalendarUrl(ev: CalendarEvent, details: string): string {
  const t = eventTimes(ev);
  let dates: string;
  if (t.allDay) {
    const next = new Date(t.y, t.m - 1, t.d + 1);
    dates = `${t.y}${pad2(t.m)}${pad2(t.d)}/${next.getFullYear()}${pad2(next.getMonth() + 1)}${pad2(next.getDate())}`;
  } else {
    dates = `${stamp(t.start)}/${stamp(t.end)}`;
  }
  const q = new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates, details });
  if (ev.place) q.set('location', ev.place);
  if (!t.allDay) q.set('ctz', Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Copenhagen');
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/**
 * På Android: åbner telefonens kalender-app med aftalen udfyldt (den gemmes
 * først, når man trykker Gem). Ellers Google Kalender i browseren.
 */
export function calendarLink(ev: CalendarEvent, details: string, android = /Android/i.test(navigator.userAgent)): string {
  const web = googleCalendarUrl(ev, details);
  if (!android) return web;
  const t = eventTimes(ev);
  const begin = t.allDay ? Date.UTC(t.y, t.m - 1, t.d) : t.start.getTime();
  const end = t.allDay ? Date.UTC(t.y, t.m - 1, t.d + 1) : t.end.getTime();
  const e = encodeURIComponent;
  return (
    'intent:#Intent;action=android.intent.action.INSERT;type=vnd.android.cursor.item/event;' +
    `S.title=${e(ev.title)};S.description=${e(details)};` +
    (ev.place ? `S.eventLocation=${e(ev.place)};` : '') +
    `l.beginTime=${begin};l.endTime=${end};B.allDay=${t.allDay};` +
    `S.browser_fallback_url=${e(web)};end`
  );
}
