// Forslag fra "Spørg dagbogen": Claude foreslår nye ting eller rettelser, og de gemmes først, når personen trykker Gem.
import type { Proposal } from './ai';
import { today } from './dates';
import { pushAppointments } from './googleSync';
import type { Data, useStore } from './store';
import type { Appointment, Note, Person, Routine, Todo } from './types';

type Store = ReturnType<typeof useStore>;

/** Det, der skal til for at fortryde. */
export type Saved =
  | { kind: 'note'; id: string }
  | { kind: 'routine'; id: string }
  | { kind: 'appointment'; id: string; google: boolean }
  | { kind: 'personNote'; personId: string; noteId: string }
  | { kind: 'todo'; id: string }
  | { kind: 'editNote'; prev: Note }
  | { kind: 'editRoutine'; prev: Routine }
  | { kind: 'editAppointment'; prev: Appointment; google: boolean };

/** Rettelser bruger de samme felter som nye ting af samme slags. */
export type Base = 'note' | 'appointment' | 'routine' | 'personNote' | 'todo';
export function baseKind(k: Proposal['kind']): Base {
  return k === 'editNote' ? 'note' : k === 'editAppointment' ? 'appointment' : k === 'editRoutine' ? 'routine' : k;
}

const id = () => crypto.randomUUID();
const isDate = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);

export function findPerson(people: Record<string, Person>, name: string): Person | undefined {
  const n = name.trim().toLowerCase();
  const all = Object.values(people);
  return all.find((p) => p.name.toLowerCase() === n) ?? all.find((p) => p.name.toLowerCase().startsWith(`${n} `));
}

/** Det, en rettelse retter i (eller undefined). */
export function target(p: Proposal, data: Pick<Data, 'notes' | 'appointments' | 'routines'>): Note | Appointment | Routine | undefined {
  if (p.kind === 'editNote') return data.notes[p.target];
  if (p.kind === 'editAppointment') return data.appointments[p.target];
  if (p.kind === 'editRoutine') return data.routines[p.target];
  return undefined;
}

/** Hvad der mangler, før forslaget kan gemmes ('' = intet). */
export function problem(p: Proposal, data: Pick<Data, 'notes' | 'appointments' | 'routines' | 'people'>): string {
  const base = baseKind(p.kind);
  if (!p.title.trim()) return 'Mangler en titel.';
  if (p.kind.startsWith('edit') && !target(p, data)) return 'Det, der skulle rettes, findes ikke (længere).';
  if (base === 'appointment' && !isDate(p.date)) return 'Mangler en dato.';
  if (p.kind === 'personNote' && !findPerson(data.people, p.title)) return `${p.title} findes ikke under Mennesker.`;
  if (p.kind === 'personNote' && !p.text.trim()) return 'Noten er tom.';
  return '';
}

const appointmentFields = (p: Proposal) => ({
  title: p.title.trim(), date: p.date, time: /^\d{2}:\d{2}$/.test(p.time) ? p.time : '', place: p.place.trim(), note: p.note.trim() || undefined,
});
const routineFields = (p: Proposal, fallbackStart: string) => ({
  name: p.title.trim(), everyDays: p.monthly ? 1 : Math.max(1, Math.round(p.everyDays) || 1), monthly: p.monthly,
  start: isDate(p.date) ? p.date : fallbackStart, options: p.options.map((o) => o.trim()).filter(Boolean),
});

export async function saveProposal(store: Store, p: Proposal): Promise<Saved> {
  const now = Date.now();
  const d = store.data;
  if (p.kind === 'editNote') {
    const prev = d.notes[p.target];
    await store.put('notes', prev.id, { ...prev, title: p.title.trim(), icon: p.icon || prev.icon, text: p.text.trim(), updatedAt: now });
    return { kind: 'editNote', prev };
  }
  if (p.kind === 'editAppointment') {
    const prev = d.appointments[p.target];
    const next: Appointment = { ...prev, ...appointmentFields(p), changedAt: now };
    await store.put('appointments', prev.id, next);
    pushAppointments(store, [next]);
    return { kind: 'editAppointment', prev, google: !!next.toGoogle };
  }
  if (p.kind === 'editRoutine') {
    const prev = d.routines[p.target];
    await store.put('routines', prev.id, { ...prev, ...routineFields(p, prev.start), icon: p.icon || prev.icon });
    return { kind: 'editRoutine', prev };
  }
  if (p.kind === 'note') {
    const note: Note = { id: id(), title: p.title.trim(), icon: p.icon || '📝', text: p.text.trim(), createdAt: now, updatedAt: now };
    await store.put('notes', note.id, note);
    return { kind: 'note', id: note.id };
  }
  if (p.kind === 'appointment') {
    const g = d.settings.google;
    const a: Appointment = { id: id(), ...appointmentFields(p), createdAt: now, changedAt: now, toGoogle: !!g.email && g.push };
    await store.put('appointments', a.id, a);
    pushAppointments(store, [a]);
    return { kind: 'appointment', id: a.id, google: !!a.toGoogle };
  }
  if (p.kind === 'todo') {
    const t: Todo = { id: id(), text: p.title.trim(), due: isDate(p.date) ? p.date : undefined, from: 'fra Spørg dagbogen', createdAt: now };
    await store.put('todos', t.id, t);
    return { kind: 'todo', id: t.id };
  }
  if (p.kind === 'routine') {
    const r: Routine = { id: id(), icon: p.icon || '💊', ...routineFields(p, today()), log: [], createdAt: now };
    await store.put('routines', r.id, r);
    return { kind: 'routine', id: r.id };
  }
  const person = findPerson(d.people, p.title);
  if (!person) throw new Error(`${p.title} findes ikke under Mennesker.`);
  const noteId = id();
  await store.put('people', person.id, { ...person, notes: [{ id: noteId, date: today(), text: p.text.trim() }, ...person.notes], updatedAt: now });
  return { kind: 'personNote', personId: person.id, noteId };
}

/** Fortryder det gemte: nye ting fjernes, rettede ting sættes tilbage. */
export async function undoProposal(store: Store, s: Saved): Promise<void> {
  if (s.kind === 'note') return store.remove('notes', s.id);
  if (s.kind === 'routine') return store.remove('routines', s.id);
  if (s.kind === 'todo') return store.remove('todos', s.id);
  if (s.kind === 'editNote') return store.put('notes', s.prev.id, { ...s.prev, updatedAt: Date.now() });
  if (s.kind === 'editRoutine') return store.put('routines', s.prev.id, s.prev);
  if (s.kind === 'editAppointment') {
    // Den gamle udgave sendes også til Google igen
    const now = store.data.appointments[s.prev.id];
    const back: Appointment = { ...s.prev, google: now?.google ?? s.prev.google, changedAt: Date.now() };
    await store.put('appointments', back.id, back);
    pushAppointments(store, [back]);
    return;
  }
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
  if (s.kind === 'editNote') return { label: 'Noter', path: `noter/${s.prev.id}` };
  if (s.kind === 'routine') return { label: 'Faste ting', path: `faste/${s.id}` };
  if (s.kind === 'todo') return { label: 'Huskeliste', path: 'huskeliste' };
  if (s.kind === 'editRoutine') return { label: 'Faste ting', path: `faste/${s.prev.id}` };
  if (s.kind === 'appointment' || s.kind === 'editAppointment') return { label: 'Kalender', path: 'kalender' };
  return { label: 'Mennesker', path: `mennesker/${s.personId}` };
}

/** Linjer i en note: hvad der er fjernet og kommet til. */
export function lineDiff(before: string, after: string): Array<{ text: string; kind: 'same' | 'added' | 'removed' }> {
  const a = before.split('\n').filter((l) => l.trim());
  const b = after.split('\n').filter((l) => l.trim());
  const inB = new Set(b.map((l) => l.trim()));
  const inA = new Set(a.map((l) => l.trim()));
  const out: Array<{ text: string; kind: 'same' | 'added' | 'removed' }> = [];
  for (const l of a) if (!inB.has(l.trim())) out.push({ text: l, kind: 'removed' });
  for (const l of b) out.push({ text: l, kind: inA.has(l.trim()) ? 'same' : 'added' });
  return out;
}
