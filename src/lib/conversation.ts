// Samtaler: resuméet lægges i dagens dagbog og som noter på de personer, der var med.
import type { Conversation, Draft, Entry, Person } from './types';

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

export function readSharedText(): void {
  const q = new URLSearchParams(location.search);
  const text = [q.get('title'), q.get('text'), q.get('url')].filter(Boolean).join('\n\n').trim();
  if (!text) return;
  shared = text;
  // Fjern teksten fra adressen, så den ikke bliver liggende i historikken.
  history.replaceState(null, '', location.pathname + location.hash);
}

export function hasSharedText(): boolean {
  return shared !== null;
}

export function takeSharedText(): string | null {
  const t = shared;
  shared = null;
  return t;
}
