// Idéer: lær et emne kort for kort (som Deepstash), gem gode idéer og citater, og "Kan du huske?"
// et par dage efter, så det sidder fast (gentagelse med voksende mellemrum).
import { useSyncExternalStore } from 'react';
import { courseAI, ideaAI } from './ai';
import { addDays, today } from './dates';
import type { useStore } from './store';
import type { Course, CourseCard, Idea } from './types';

type Store = ReturnType<typeof useStore>;
type Data = Store['data'];

/** Forslag under "Lær noget nyt". */
export const SUGGESTIONS = [
  'Romerriget', 'Antikkens Grækenland', 'Hvordan virker aktiemarkedet?', 'Fodboldtaktik', 'Vin', 'Søvn', 'Universet', 'Vikingerne',
  'Danmarkshistorie på 12 kort', 'Hjernen og hukommelsen', 'Kunstig intelligens', 'Klima og vejr', 'Kaffe', 'Fugle i Danmark',
  'Renæssancen', 'Psykologi i hverdagen', 'Opfindelser, der ændrede verden', 'Den kolde krig', 'Ernæring', 'Fotografering',
];
/** Så mange forslag ad gangen; "Andre forslag" viser de næste. */
export const SHOWN_SUGGESTIONS = 6;

// Forslag, ejeren har fjernet med × (på denne telefon)
const NOPE_KEY = 'dagbog-ide-fravalgt';
export function hiddenSuggestions(): string[] { try { return JSON.parse(localStorage.getItem(NOPE_KEY) ?? '[]') as string[]; } catch { return []; } }
export function hideSuggestion(s: string) { try { localStorage.setItem(NOPE_KEY, JSON.stringify([...new Set([...hiddenSuggestions(), s])])); } catch { /* ingen lagring */ } }

/** "Drop emnet": emnet og dets "Kan du huske?" forsvinder; gemte idéer fra det bliver liggende. */
export async function dropCourse(store: Store, id: string): Promise<void> {
  await store.remove('courses', id);
}

/** Dage til næste "Kan du huske?", efter hvor mange gange i træk man har husket kortet. */
const INTERVALS = [2, 7, 21, 60];
/** Højst så mange "Kan du huske?" på én dag. */
export const REVIEWS_PER_DAY = 5;

// ---------- "Claude laver kort …" (lever videre, selvom man skifter skærm) ----------

export interface MakeState { busy: boolean; topic: string; error: string; madeId: string }
let mstate: MakeState = { busy: false, topic: '', error: '', madeId: '' };
const listeners = new Set<() => void>();
const mset = (s: Partial<MakeState>) => { mstate = { ...mstate, ...s }; listeners.forEach((l) => l()); };
export function useMakeState(): MakeState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => mstate);
}
export const clearMakeError = () => mset({ error: '' });

/** Nyt emne: Claude laver 10-12 kort. Giver emnets id (eller '' ved fejl, som står i useMakeState). */
export async function startCourse(store: Store, topic: string): Promise<string> {
  const t = topic.trim();
  if (!t || mstate.busy) return '';
  mset({ busy: true, topic: t, error: '', madeId: '' });
  try {
    const { title, cards } = await courseAI(store.data.settings, t);
    const c: Course = { id: crypto.randomUUID(), topic: t, title, cards, pos: 0, createdAt: Date.now() };
    await store.put('courses', c.id, c);
    mset({ busy: false, madeId: c.id });
    return c.id;
  } catch (e) {
    mset({ busy: false, error: e instanceof Error ? e.message : 'Noget gik galt.' });
    return '';
  }
}

/** Det emne, man er i gang med (det nyeste, der ikke er læst færdigt). */
export function activeCourse(data: Data): Course | undefined {
  return Object.values(data.courses).filter((c) => !c.doneAt).sort((a, b) => b.createdAt - a.createdAt)[0];
}

export const finishedCourses = (data: Data) => Object.values(data.courses).filter((c) => c.doneAt).sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));

/** Kortet er læst: husk det, og læg et "Kan du huske?" om to dage. */
export async function seeCard(store: Store, id: string, i: number): Promise<void> {
  const c = store.data.courses[id];
  if (!c || !c.cards[i]) return;
  const card = c.cards[i];
  if (card.seenAt && c.pos > i) return;
  const cards = c.cards.map((k, j): CourseCard => (j === i && !k.seenAt
    ? { ...k, seenAt: Date.now(), review: k.question ? { due: addDays(today(), INTERVALS[0]), step: 0 } : undefined }
    : k));
  const pos = Math.max(c.pos, i + 1);
  await store.put('courses', id, { ...c, cards, pos, ...(pos >= cards.length && !c.doneAt ? { doneAt: Date.now() } : {}) });
}

/** Ret ét kort (fx "Lettere" eller "Mere dybde"). */
export async function setCard(store: Store, id: string, i: number, patch: Partial<CourseCard>): Promise<void> {
  const c = store.data.courses[id];
  if (!c) return;
  await store.put('courses', id, { ...c, cards: c.cards.map((k, j) => (j === i ? { ...k, ...patch } : k)) });
}

// ---------- Gemte idéer ----------

export const ideaForCard = (data: Data, id: string, i: number) => Object.values(data.ideas).find((x) => x.courseId === id && x.card === i);

/** "Gem" på et kort: gemmer det under Mine idéer, eller fjerner det igen. */
export async function toggleCardIdea(store: Store, c: Course, i: number): Promise<boolean> {
  const had = ideaForCard(store.data, c.id, i);
  if (had) { await store.remove('ideas', had.id); return false; }
  const k = c.cards[i];
  const idea: Idea = { id: crypto.randomUUID(), title: k.title, text: k.text, source: `${c.title} · kort ${i + 1}`, courseId: c.id, card: i, createdAt: Date.now() };
  await store.put('ideas', idea.id, idea);
  return true;
}

/** "Gem som idé" fra en anden app: Claude laver et kort på 2-3 linjer. */
export async function ideaFromShared(store: Store, text: string, url?: string, from = 'Delt'): Promise<string> {
  const { title, text: body } = await ideaAI(store.data.settings, text);
  const idea: Idea = { id: crypto.randomUUID(), title, text: body, source: from, url, createdAt: Date.now() };
  await store.put('ideas', idea.id, idea);
  return idea.id;
}

export const allIdeas = (data: Data) => Object.values(data.ideas).sort((a, b) => b.createdAt - a.createdAt);

// ---------- Kan du huske? ----------

export interface Due { course: Course; i: number; card: CourseCard }

/** Kort, der skal huskes i dag (ældste først, højst REVIEWS_PER_DAY). */
export function dueReviews(data: Data, day = today()): Due[] {
  const out: Due[] = [];
  for (const course of Object.values(data.courses)) {
    course.cards.forEach((card, i) => { if (card.review && card.review.due <= day) out.push({ course, i, card }); });
  }
  return out.sort((a, b) => a.card.review!.due.localeCompare(b.card.review!.due)).slice(0, REVIEWS_PER_DAY);
}

/** "Det vidste jeg" giver længere til næste gang; "Igen snart" kommer i morgen. Husket 4 gange i træk = færdig. */
export async function answerReview(store: Store, id: string, i: number, knew: boolean): Promise<void> {
  const c = store.data.courses[id];
  const r = c?.cards[i]?.review;
  if (!c || !r) return;
  const step = knew ? r.step + 1 : 0;
  const review = knew && step >= INTERVALS.length ? undefined : { due: addDays(today(), knew ? INTERVALS[step] : 1), step };
  await setCard(store, id, i, { review });
}

// ---------- Dagens idé på Skriv ----------

const HIDE_KEY = 'dagbog-ide-skjult';
export const dayIdeaHidden = () => { try { return localStorage.getItem(HIDE_KEY) === today(); } catch { return false; } };
export const hideDayIdea = () => { try { localStorage.setItem(HIDE_KEY, today()); } catch { /* ingen lagring */ } };

/** Næste kort i emnet, man er i gang med; ellers en gemt idé, der skifter fra dag til dag. */
export function dayIdea(data: Data): { kind: 'card'; course: Course; i: number } | { kind: 'idea'; idea: Idea } | null {
  const c = activeCourse(data);
  if (c && c.pos < c.cards.length) return { kind: 'card', course: c, i: c.pos };
  const ideas = allIdeas(data);
  if (!ideas.length) return null;
  const n = Math.floor(Date.parse(today()) / 864e5);
  return { kind: 'idea', idea: ideas[n % ideas.length] };
}
