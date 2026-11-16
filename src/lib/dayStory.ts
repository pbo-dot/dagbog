// "Dagens historie": Claude ser en dags billeder sammen med stederne fra Tidslinjen, kalenderen,
// hvem der var med (valgt af ejeren) og evt. dagbogsteksten og skriver 1–2 sætninger om dagen.
// Billederne sendes i en lille udgave (STORY_PX), så det er billigt. Historien skrives aldrig ind
// i ejerens egen tekst, og en historie, ejeren selv har rettet, skrives ikke om af sig selv.
import { useSyncExternalStore } from 'react';
import { agenda } from './agenda';
import { dayStoryAI } from './ai';
import { formatFull, toISO } from './dates';
import { noteAuto } from './google';
import { countryName, dayStays, dayThumbs, stayTime, thumbTime, trips } from './places';
import type { useStore } from './store';
import type { DayStory } from './types';
import { costUsd, krText } from './usage';

type Store = ReturnType<typeof useStore>;
type Data = Store['data'];

/** Billedernes størrelse (lange led) til Claude. */
const STORY_PX = 512;
/** Så mange dage arbejdes der på ad gangen. */
const PARALLEL = 3;

/** Dage med (synlige) billeder fra telefonen, nyeste først. */
export function photoDays(data: Data): string[] {
  const days = new Set<string>();
  for (const m of Object.values(data.phonePhotos)) {
    for (const p of m.photos) if (p.thumb && !p.hidden) days.add(toISO(new Date(p.t)));
  }
  return [...days].sort().reverse();
}

/** Dage med billeder, der endnu ikke har en historie. */
export function daysWithoutStory(data: Data): string[] {
  return photoDays(data).filter((d) => !data.stories[d]?.text);
}

/** Overslag i kroner for at fortælle så mange dage (ca. 5 små billeder + tekst pr. dag). */
export function storyEstimate(data: Data, days: number): string {
  return krText(costUsd(data.settings.ai.searchModel, { input_tokens: days * 2000, output_tokens: days * 90 }));
}

/** Teksten til Claude om dagen (alt undtagen billederne). */
function dayContext(data: Data, date: string, thumbs: string[], withIds?: string[]): string {
  const fixed = data.settings.places?.fixed;
  const stays = dayStays(data.phonePhotos, date, data.visits, fixed);
  const abroad = [...new Set(stays.map((s) => s.cc).filter((c) => c && c !== 'DK'))].map(countryName);
  const trip = trips(data.phonePhotos, data.visits, fixed ?? [], data.settings.places?.notTrip).find((t) => t.from <= date && t.to >= date);
  const cal = agenda(data, date, date).filter((a) => a.kind !== 'routine').map((a) => `${a.time ? `kl. ${a.time} ` : ''}${a.title}`);
  const people = (withIds ?? data.stories[date]?.with ?? []).map((id) => data.people[id]?.name).filter(Boolean);
  const entry = data.entries[date]?.text.trim();
  const lines = [
    `Dag: ${formatFull(date)}`,
    `Steder (Tidslinjen og billederne): ${stays.length ? stays.map((s) => `${s.city} ${stayTime(s)}`).join('; ') : 'ukendt'}${abroad.length ? ` (${abroad.join(', ')})` : ''}`,
    trip ? `Rejse: ${trip.from === trip.to ? 'en dag' : `dag ${Math.round((Date.parse(date) - Date.parse(trip.from)) / 864e5) + 1} af en rejse`} til ${trip.cities.slice(0, 4).join(', ')}` : '',
    cal.length ? `Kalenderen: ${cal.join('; ')}` : '',
    people.length ? `Hvem var med (valgt af personen): ${people.join(', ')}` : '',
    entry ? `Fra dagbogen (personens egne ord, kun til at forstå dagen):\n${entry.slice(0, 800)}` : '',
    `Billeder: ${thumbs.map((id, i) => `${i + 1} kl. ${thumbTime(data.phonePhotos, id)}`).join(' · ')}`,
  ];
  return lines.filter(Boolean).join('\n');
}

/** Et lille billede (JPEG, base64) i STORY_PX. */
async function shrink(base64: string): Promise<string> {
  const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bin], { type: 'image/jpeg' }));
  const scale = Math.min(1, STORY_PX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL('image/jpeg', 0.8).split(',')[1];
}

/** Skriver historien for én dag (henter billederne, spørger Claude) og giver den nye post. */
async function makeStory(store: Store, date: string, withIds?: string[]): Promise<DayStory | null> {
  const data = store.data;
  const thumbs = dayThumbs(data.phonePhotos, date).slice(0, 5);
  if (!thumbs.length) return null;
  const images: Array<{ data: string; label: string }> = [];
  for (const [i, id] of thumbs.entries()) {
    const ph = await store.getPhoto(id);
    if (ph) images.push({ data: await shrink(ph.data), label: `Billede ${i + 1} (kl. ${thumbTime(data.phonePhotos, id)}):` });
  }
  if (!images.length) return null;
  const text = await dayStoryAI(data.settings, dayContext(data, date, thumbs, withIds), images);
  return { date, text, with: withIds ?? data.stories[date]?.with, photos: images.length, at: Date.now() };
}

/** Én dag (fx efter "Hvem var med?" eller "Skriv igen"). */
/** `withIds`: "Hvem var med?" lige valgt (store.data kan være fra før valget blev gemt). */
export async function tellDay(store: Store, date: string, withIds?: string[]): Promise<void> {
  const s = await makeStory(store, date, withIds);
  if (s) await store.put('stories', date, s);
}

/** Gem "Hvem var med?" (og evt. en rettet tekst) for en dag. */
export async function saveStory(store: Store, date: string, patch: Partial<DayStory>): Promise<void> {
  const before = store.data.stories[date] ?? { date, text: '', at: Date.now() };
  await store.put('stories', date, { ...before, ...patch, date, at: Date.now() });
}

export interface StoryState { busy: boolean; done: number; total: number; error: string; stop: boolean }
let sstate: StoryState = { busy: false, done: 0, total: 0, error: '', stop: false };
const listeners = new Set<() => void>();
const sset = (s: Partial<StoryState>) => { sstate = { ...sstate, ...s }; listeners.forEach((l) => l()); };

export function useStoryState(): StoryState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => sstate);
}

export function stopTelling(): void {
  sset({ stop: true });
}

/** Fortæller alle dage med billeder, der mangler en historie (nyeste først, et par ad gangen); `only`: kun disse dage (fx en rejse). */
export async function tellAll(store: Store, only?: string[]): Promise<void> {
  if (sstate.busy) return;
  const todo = daysWithoutStory(store.data).filter((d) => !only || only.includes(d));
  sset({ busy: true, done: 0, total: todo.length, error: '', stop: false });
  let next = 0;
  const worker = async () => {
    while (next < todo.length && !sstate.stop && !sstate.error) {
      const date = todo[next++];
      try {
        const s = await makeStory(store, date);
        // Hvem var med kan være sat imens: behold den nyeste
        if (s) await store.put('stories', date, { ...s, with: store.data.stories[date]?.with ?? s.with });
      } catch (e) {
        sset({ error: e instanceof Error ? e.message : String(e) });
      }
      sset({ done: sstate.done + 1 });
    }
  };
  try {
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    void noteAuto(`Dagens historie: ${sstate.done} af ${todo.length} dage${sstate.error ? ` · fejl: ${sstate.error}` : ''}`);
  } finally {
    sset({ busy: false });
  }
}

/** Til Spørg: én linje pr. dag med historie, valgfrit kun i en periode. */
export function storyLines(stories: Record<string, DayStory> | undefined, people: Data['people'], inside?: (d: string) => boolean): string[] {
  return Object.values(stories ?? {})
    .filter((s) => s.text && (!inside || inside(s.date)))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((s) => {
      const names = (s.with ?? []).map((id) => people[id]?.name).filter(Boolean);
      return `- ${s.date}: ${s.text}${names.length ? ` (med ${names.join(', ')})` : ''}`;
    });
}
