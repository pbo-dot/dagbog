// Forslag fra "Spørg dagbogen": Claude foreslår nye ting, og de gemmes først, når personen trykker Gem.
import type { Proposal } from './ai';
import { today } from './dates';
import { pushAppointments } from './googleSync';
import type { useStore } from './store';
import type { Appointment, Note, Person, Routine } from './types';

type Store = ReturnType<typeof useStore>;

/** Det, der skal til for at fortryde. */
export type Saved =
  | { kind: 'note'; id: string }
  | { kind: 'routine'; id: string }
  | { kind: 'appointment'; id: string; google: boolean }
  | { kind: 'personNote'; personId: string; noteId: string };

const id = () => crypto.randomUUID();

export function findPerson(people: Record<string, Person>, name: string): Person | undefined {
  const n = name.trim().toLowerCase();
  const all = Object.values(people);
  return all.find((p) => p.name.toLowerCase() === n) ?? all.find((p) => p.name.toLowerCase().startsWith(`${n} `));
}

/** Hvad der mangler, før forslaget kan gemmes ('' = intet). */
export function problem(p: Proposal, people: Record<string, Person>): string {
  if (!p.title.trim()) return 'Mangler en titel.';
  if (p.kind === 'appointment' && !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) return 'Mangler en dato.';
  if (p.kind === 'personNote' && !findPerson(people, p.title)) return `${p.title} findes ikke under Mennesker.`;
  if (p.kind === 'personNote' && !p.text.trim()) return 'Noten er tom.';
  return '';
}

export async function saveProposal(store: Store, p: Proposal): Promise<Saved> {
  const now = Date.now();
  if (p.kind === 'note') {
    const note: Note = { id: id(), title: p.title.trim(), icon: p.icon || '📝', text: p.text.trim(), createdAt: now, updatedAt: now };
    await store.put('notes', note.id, note);
    return { kind: 'note', id: note.id };
  }
  if (p.kind === 'appointment') {
    const g = store.data.settings.google;
    const a: Appointment = {
      id: id(), title: p.title.trim(), date: p.date, time: /^\d{2}:\d{2}$/.test(p.time) ? p.time : '', place: p.place.trim(),
      createdAt: now, changedAt: now, toGoogle: !!g.email && g.push,
    };
    await store.put('appointments', a.id, a);
    pushAppointments(store, [a]);
    return { kind: 'appointment', id: a.id, google: !!a.toGoogle };
  }
  if (p.kind === 'routine') {
    const r: Routine = {
      id: id(), name: p.title.trim(), icon: p.icon || '💊', everyDays: p.monthly ? 1 : Math.max(1, Math.round(p.everyDays) || 1), monthly: p.monthly,
      start: /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : today(), options: p.options.map((o) => o.trim()).filter(Boolean), log: [], createdAt: now,
    };
    await store.put('routines', r.id, r);
    return { kind: 'routine', id: r.id };
  }
  const person = findPerson(store.data.people, p.title);
  if (!person) throw new Error(`${p.title} findes ikke under Mennesker.`);
  const noteId = id();
  await store.put('people', person.id, { ...person, notes: [{ id: noteId, date: today(), text: p.text.trim() }, ...person.notes], updatedAt: now });
  return { kind: 'personNote', personId: person.id, noteId };
}

/** Fortryder det gemte. */
export async function undoProposal(store: Store, s: Saved): Promise<void> {
  if (s.kind === 'note') return store.remove('notes', s.id);
  if (s.kind === 'routine') return store.remove('routines', s.id);
  if (s.kind === 'appointment') {
    const a = store.data.appointments[s.id];
    await store.remove('appointments', s.id);
    if (a?.google) pushAppointments(store, [], { cal: a.google.cal, id: a.google.id, ref: a.id });
    return;
  }
  const person = store.data.people[s.personId];
  if (person) await store.put('people', person.id, { ...person, notes: person.notes.filter((n) => n.id !== s.noteId) });
}

/** Hvor det gemte kan ses. */
export function whereSaved(s: Saved): { label: string; path: string } {
  if (s.kind === 'note') return { label: 'Noter', path: `noter/${s.id}` };
  if (s.kind === 'routine') return { label: 'Faste ting', path: `faste/${s.id}` };
  if (s.kind === 'appointment') return { label: 'Kalender', path: 'kalender' };
  return { label: 'Mennesker', path: `mennesker/${s.personId}` };
}
