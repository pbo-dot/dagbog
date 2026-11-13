// "Før du mødes" og dagens spørgsmål: bygger på kalenderen, Mennesker, samtaler og huskelisten.
// Alt regnes på telefonen, uden Claude.
import { agenda, type AgendaItem } from './agenda';
import { addDays } from './dates';
import type { Appointment, Conversation, Entry, GoogleMonth, Person, PersonNote, Routine, Settings, Todo } from './types';

export interface MeetData {
  appointments: Record<string, Appointment>;
  routines: Record<string, Routine>;
  conversations: Record<string, Conversation>;
  google?: Record<string, GoogleMonth>;
  settings?: Pick<Settings, 'google'>;
  people: Record<string, Person>;
  todos: Record<string, Todo>;
}

export interface MeetPrep {
  person: Person;
  item: AgendaItem;
  tomorrow: boolean;
  lastNote?: PersonNote;
  lastTalk?: Conversation;
  todos: Todo[];
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Står navnet som et helt ord i teksten? (Danske bogstaver tæller som bogstaver.) */
export function mentions(text: string, name: string): boolean {
  if (name.length < 3) return false;
  return new RegExp(`(^|[^a-zæøåäöüé0-9])${esc(name.toLowerCase())}([^a-zæøåäöüé0-9]|$)`).test(text.toLowerCase());
}

/**
 * Hvem i Mennesker handler aftalen om? Hele navnet, eller fornavnet, hvis kun én har det fornavn.
 */
export function peopleIn(text: string, people: Person[]): Person[] {
  const first = (p: Person) => p.name.trim().split(/\s+/)[0] ?? '';
  const count = new Map<string, number>();
  for (const p of people) count.set(first(p).toLowerCase(), (count.get(first(p).toLowerCase()) ?? 0) + 1);
  return people.filter((p) => mentions(text, p.name.trim()) || (count.get(first(p).toLowerCase()) === 1 && mentions(text, first(p))));
}

/**
 * Aftaler i dag (der ikke er begyndt for over en time siden) og i morgen med en fra Mennesker,
 * og det, der er værd at have i hovedet: det vigtige lige nu, den seneste note, den seneste
 * samtale og åbne huskepunkter om personen. Personer uden noget at vise springes over.
 */
export function meetPreps(data: MeetData, today: string, nowHM: string): MeetPrep[] {
  const people = Object.values(data.people);
  if (!people.length) return [];
  const tomorrow = addDays(today, 1);
  const out: MeetPrep[] = [];
  const seen = new Set<string>();
  const hourAgo = (() => { const [h, m] = nowHM.split(':').map(Number); const t = Math.max(0, h * 60 + m - 60); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; })();
  for (const item of agenda(data, today, tomorrow)) {
    if (item.kind === 'routine') continue;
    if (item.date === today && item.time && item.time < hourAgo) continue;
    for (const person of peopleIn(`${item.title} ${item.detail ?? ''}`, people)) {
      if (seen.has(person.id)) continue;
      const first = person.name.trim().split(/\s+/)[0];
      const lastNote = [...person.notes].sort((a, b) => b.date.localeCompare(a.date))[0];
      const lastTalk = Object.values(data.conversations).filter((c) => c.people.includes(person.id)).sort((a, b) => b.date.localeCompare(a.date))[0];
      const todos = Object.values(data.todos).filter((t) => !t.doneAt && mentions(t.text, first));
      if (!person.important.trim() && !lastNote && !lastTalk && !todos.length) continue;
      seen.add(person.id);
      out.push({ person, item, tomorrow: item.date === tomorrow, lastNote, lastTalk, todos });
    }
  }
  return out;
}

const GENERIC = [
  'Hvad fyldte mest i dag?',
  'Hvad tager du med dig fra i dag?',
  'Hvordan har din krop haft det i dag?',
  'Hvad overraskede dig i dag?',
  'Hvem tænkte du på i dag?',
  'Hvad gav dig energi – og hvad tog den?',
  'Hvad ville du ønske, du havde sagt eller gjort?',
  'Hvad var et øjeblik, du gerne vil huske?',
];

function generic(date: string): string {
  const n = Math.floor(new Date(date).getTime() / 86400000);
  return GENERIC[((n % GENERIC.length) + GENERIC.length) % GENERIC.length];
}

/**
 * Dagens spørgsmål over skrivefeltet. For i dag vælges det ud fra dagen: en aftale med klokkeslæt
 * ("Hvordan gik …?", før den: "Hvad håber du på?"), et huskepunkt klaret i dag, eller humøret i går.
 * Ellers et af de faste spørgsmål. Andre dage: altid et fast spørgsmål.
 */
export function dayQuestion(data: MeetData & { entries: Record<string, Entry> }, date: string, today: string, nowHM: string, now = Date.now()): string {
  if (date !== today) return generic(date);
  const timed = agenda(data, today, today).filter((i) => i.kind !== 'routine' && i.time);
  const people = Object.values(data.people);
  const withPerson = (i: AgendaItem) => peopleIn(`${i.title} ${i.detail ?? ''}`, people)[0];
  const past = timed.filter((i) => i.time <= nowHM);
  const done = past.find(withPerson) ?? past[past.length - 1];
  if (done) {
    const p = withPerson(done);
    return p ? `Hvordan gik det med ${p.name.trim().split(/\s+/)[0]} i dag?` : `Hvordan gik "${done.title}"?`;
  }
  const next = timed[0];
  if (next) return `I dag kl. ${next.time.replace(':', '.')}: "${next.title}". Hvad håber du på?`;
  const cleared = Object.values(data.todos).filter((t) => t.doneAt && now - t.doneAt < 16 * 3_600_000).sort((a, b) => b.doneAt! - a.doneAt!)[0];
  if (cleared) return `Du fik klaret "${cleared.text}". Hvordan var det?`;
  const mood = data.entries[addDays(today, -1)]?.mood;
  if (mood === 'presset') return 'I går var du presset. Hvordan er det i dag?';
  if (mood === 'traet') return 'I går var du træt. Hvordan har du det i dag?';
  if (mood === 'tom') return 'I går føltes tomt. Hvad har fyldt i dag?';
  return generic(date);
}
