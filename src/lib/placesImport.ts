// Indlæser listen fra hjælpe-appen "Dagbog Billeder" og fortæller skærmen, hvordan det går.
// Hvert trin skrives også i den lille log (Sikkerhedskopi › "Seneste forsøg").
import { useSyncExternalStore } from 'react';
import { noteAuto } from './google';
import { toISO } from './dates';
import { describePhotos, PHOTO_BATCH } from './ai';
import { addCities, countryName, mergeMonths, mergeVisits, parsePayload, parseTimeline } from './places';
import type { useStore } from './store';

type Store = ReturnType<typeof useStore>;

export interface ImportState {
  busy: boolean;
  lines: string[]; // det seneste forløb (vises på siden og kan kopieres til Claude)
  error: string;
}

let state: ImportState = { busy: false, lines: [], error: '' };
const listeners = new Set<() => void>();
const set = (s: Partial<ImportState>) => { state = { ...state, ...s }; listeners.forEach((l) => l()); };
const say = (line: string) => set({ lines: [...state.lines, `${new Date().toTimeString().slice(0, 8)} ${line}`] });

export function useImportState(): ImportState {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);
}

/**
 * `known` er billederne, Dagbog kender (pr. måned). Ved flere filer i træk sendes den samme med,
 * så den næste fil bygger videre på den forrige (skærmens data er først opdateret senere).
 */
export async function importPlaces(store: Store, text: string, known: Store['data']['phonePhotos'] = { ...store.data.phonePhotos }, keepLog = false): Promise<void> {
  set({ busy: true, lines: keepLog ? state.lines : [], error: '' });
  try {
    say(`Modtog ${Math.round(text.length / 1024)} kB fra Dagbog Billeder`);
    const { log, photos, thumbs, next, size, other } = parsePayload(text);
    for (const l of log) say(`app: ${l}`);
    // Små billeder: gemmes krypteret i billedlageret som "tel-<id>" og knyttes til billedet
    if (thumbs.length) {
      const t0 = performance.now();
      const byKey = new Map(photos.map((p) => [`${p.id}:${p.t}`, p]));
      const loose: Array<{ t: number; id: string }> = [];
      let saved = 0;
      for (const th of thumbs) {
        const id = `tel-${th.id}`;
        await store.putPhoto({ id, date: toISO(new Date(th.t)), mime: 'image/jpeg', data: th.data, width: 0, height: 0, createdAt: Date.now() });
        const p = byKey.get(`${th.id}:${th.t}`);
        if (p) p.thumb = id;
        else if (other) loose.push({ t: th.t, id });
        saved++;
      }
      say(`${saved} små billeder gemt på ${Math.round((performance.now() - t0) / 1000)} s`);
      // Filer fra den gamle telefon efter den første har kun billederne: knyt dem til de billeder, Dagbog allerede kender
      if (loose.length) {
        const byT = new Map(loose.map((x) => [x.t, x.id]));
        for (const m of Object.values(known)) {
          let hit = false;
          const ps = m.photos.map((p) => { const id = byT.get(p.t); if (id && p.thumb !== id) { hit = true; return { ...p, thumb: id }; } return p; });
          if (hit) { known[m.id] = { ...m, photos: ps, importedAt: Date.now() }; await store.put('phonePhotos', m.id, known[m.id]); }
        }
      }
    }
    const places = store.data.settings.places ?? { fixed: [], notFixed: [] };
    if (other) {
      // Fra den gamle telefon: rør ikke ved, hvor den nye telefon er nået til
      if (next) say('Der er flere filer fra den gamle telefon.');
    } else {
    const thumbFrom = next ?? (thumbs.length ? toISO(new Date(Math.max(...thumbs.map((x) => x.t)))) : places.thumbFrom);
    // En hel runde er færdig (ingen "næste"): så har alle gemte billeder denne størrelse
    const done = !next && thumbs.length > 0 && (!places.thumbRedo || !!size);
    const nextPlaces = { ...places, thumbFrom, fetchedAt: Date.now(), ...(done && size ? { thumbPx: size, thumbRedo: false } : {}) };
    if (JSON.stringify(nextPlaces) !== JSON.stringify(places)) await store.saveSettings({ ...store.data.settings, places: nextPlaces });
    if (next) say(`Der mangler flere små billeder. Tryk "Hent billeder" igen (fra ${next}).`);
    }
    const withPlace = photos.filter((p) => p.lat !== undefined).length;
    if (photos.length) say(`${photos.length} billeder, ${withPlace} med sted`);
    const t0 = performance.now();
    const found = await addCities(photos);
    if (photos.length) say(`Bynavne fundet for ${found} billeder på ${Math.round(performance.now() - t0)} ms`);
    const { months, added } = mergeMonths(known, photos);
    for (const m of months) known[m.id] = m;
    if (months.length) await store.putMany('phonePhotos', Object.fromEntries(months.map((m) => [m.id, m])));
    if (photos.length) say(`${added} nye billeder, ${months.length} måneder gemt`);
    void noteAuto(`Billeder: ${photos.length} modtaget, ${added} nye, ${withPlace} med sted`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say(`FEJL: ${msg}`);
    set({ error: msg });
    void noteAuto(`Billeder fejlede: ${msg}`);
  } finally {
    set({ busy: false });
  }
}

/** Google Maps-tidslinjen (Tidslinje.json, eksporteret fra telefonen): opholdene med bynavn. */
export async function importTimeline(store: Store, file: File): Promise<void> {
  set({ busy: true, lines: [], error: '' });
  try {
    say(`Læser ${file.name} (${(file.size / 1_048_576).toFixed(1)} MB)`);
    await new Promise((r) => setTimeout(r, 50)); // så teksten når at blive vist, før telefonen går i gang
    const t0 = performance.now();
    const visits = parseTimeline(JSON.parse(await file.text()));
    say(`${visits.length} ophold fundet på ${Math.round((performance.now() - t0) / 1000)} s`);
    if (!visits.length) throw new Error('Filen har ingen ophold. Er det en Tidslinje-fil fra telefonen?');
    const years = visits.map((v) => new Date(v.s).getFullYear());
    say(`Fra ${Math.min(...years)} til ${Math.max(...years)}`);
    const t1 = performance.now();
    const found = await addCities(visits);
    say(`Bynavne fundet for ${found} ophold på ${Math.round(performance.now() - t1)} ms`);
    const { months, added } = mergeVisits(store.data.visits, visits);
    await store.putMany('visits', Object.fromEntries(months.map((m) => [m.id, m])));
    say(`${added} nye ophold, ${months.length} måneder gemt`);
    void noteAuto(`Tidslinje: ${visits.length} ophold, ${added} nye`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say(`FEJL: ${msg}`);
    set({ error: msg });
    void noteAuto(`Tidslinje fejlede: ${msg}`);
  } finally {
    set({ busy: false });
  }
}

export interface DescribeState { busy: boolean; done: number; total: number; error: string; stop: boolean }
let dstate: DescribeState = { busy: false, done: 0, total: 0, error: '', stop: false };
const dlisteners = new Set<() => void>();
const dset = (s: Partial<DescribeState>) => { dstate = { ...dstate, ...s }; dlisteners.forEach((l) => l()); };

export function useDescribeState(): DescribeState {
  return useSyncExternalStore((l) => (dlisteners.add(l), () => dlisteners.delete(l)), () => dstate);
}

export function stopDescribing() { dset({ stop: true }); }

/** Billeder med et lille billede, men uden beskrivelse. */
export function undescribed(months: Store['data']['phonePhotos']): number {
  let n = 0;
  for (const m of Object.values(months)) for (const p of m.photos) if (p.thumb && !p.hidden && p.desc === undefined) n++;
  return n;
}

/**
 * Claude beskriver de små billeder, PHOTO_BATCH ad gangen (nyeste først). Hver måned gemmes,
 * når dens billeder er beskrevet, så intet går tabt, hvis man stopper eller lukker appen.
 */
export async function describeAll(store: Store): Promise<void> {
  if (dstate.busy) return;
  const todo: Array<{ month: string; t: number; id: number; thumb: string; where: string }> = [];
  for (const m of Object.values(store.data.phonePhotos)) {
    for (const p of m.photos) if (p.thumb && !p.hidden && p.desc === undefined) todo.push({ month: m.id, t: p.t, id: p.id, thumb: p.thumb, where: [p.city, p.cc && p.cc !== 'DK' ? countryName(p.cc) : ''].filter(Boolean).join(', ') });
  }
  todo.sort((a, b) => b.t - a.t);
  dset({ busy: true, done: 0, total: todo.length, error: '', stop: false });
  const months = { ...store.data.phonePhotos };
  try {
    for (let i = 0; i < todo.length && !dstate.stop; i += PHOTO_BATCH) {
      const batch = todo.slice(i, i + PHOTO_BATCH);
      const items: Array<{ data: string; when: string; where: string }> = [];
      const used: typeof batch = [];
      for (const b of batch) {
        const ph = await store.getPhoto(b.thumb);
        if (!ph) continue;
        items.push({ data: ph.data, when: new Date(b.t).toLocaleString('da-DK', { dateStyle: 'long', timeStyle: 'short' }), where: b.where });
        used.push(b);
      }
      const texts = items.length ? await describePhotos(store.data.settings, items) : [];
      const touched = new Set<string>();
      used.forEach((b, k) => {
        const m = months[b.month];
        months[b.month] = { ...m, photos: m.photos.map((p) => (p.id === b.id && p.t === b.t ? { ...p, desc: texts[k] ?? '' } : p)) };
        touched.add(b.month);
      });
      for (const id of touched) await store.put('phonePhotos', id, months[id]);
      dset({ done: Math.min(todo.length, i + batch.length) });
    }
    void noteAuto(`Billeder beskrevet: ${dstate.done} af ${todo.length}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    dset({ error: msg });
    void noteAuto(`Beskrivelse af billeder fejlede: ${msg}`);
  } finally {
    dset({ busy: false });
  }
}

/** Filerne fra den gamle telefon (gemt på Drev med "Gem på Drev" i hjælpe-appen), én ad gangen. */
export async function importFiles(store: Store, files: File[]): Promise<void> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, 'da', { numeric: true }));
  const known = { ...store.data.phonePhotos };
  set({ lines: [] });
  for (const [i, f] of sorted.entries()) {
    say(`Fil ${i + 1} af ${sorted.length}: ${f.name} (${(f.size / 1_048_576).toFixed(1)} MB)`);
    await importPlaces(store, await f.text(), known, true);
    if (state.error) return;
  }
  say('Færdig med alle filer.')
}

/**
 * Udgaven af bylisten (public/byer.txt). 2 (18. nov.): alle danske byer og landsbyer fra GeoNames' DK.txt,
 * så fx Sønderho ikke hedder Nordby. Når den skifter, får alle gemte steder deres navn igen én gang.
 */
export const CITIES_V = 2;
let relabeling = false;

/** Giver alle gemte ophold og billeder deres navn efter den nyeste byliste (én gang pr. udgave). */
export async function relabelPlaces(store: Store): Promise<void> {
  const data = store.data;
  const places = data.settings.places;
  if (relabeling || !places || (places.citiesV ?? 1) >= CITIES_V) return;
  const hasAny = Object.keys(data.visits).length + Object.keys(data.phonePhotos).length > 0;
  relabeling = true;
  try {
    const visits = Object.fromEntries(Object.entries(data.visits).map(([k, m]) => [k, { ...m, visits: m.visits.map((v) => ({ ...v })) }]));
    const photos = Object.fromEntries(Object.entries(data.phonePhotos).map(([k, m]) => [k, { ...m, photos: m.photos.map((p) => ({ ...p })) }]));
    const all = [...Object.values(visits).flatMap((m) => m.visits), ...Object.values(photos).flatMap((m) => m.photos)];
    const before = all.map((p) => p.city);
    if (hasAny) await addCities(all);
    // Nye navne for et sted, der var "Ikke en rejse" eller hørte til et fast sted, følger med
    const renamed = new Map<string, Set<string>>();
    let changed = 0;
    all.forEach((p, i) => {
      const old = before[i];
      if (!old || !p.city || old === p.city) return;
      changed++;
      if (!renamed.has(old)) renamed.set(old, new Set());
      renamed.get(old)!.add(p.city);
    });
    const grow = (list: string[] | undefined) => {
      if (!list?.length) return list;
      const out = new Set(list);
      for (const c of list) for (const n of renamed.get(c) ?? []) out.add(n);
      return [...out];
    };
    if (changed) {
      await store.putMany('visits', visits);
      await store.putMany('phonePhotos', photos);
    }
    const cur = store.data.settings.places ?? places;
    await store.saveSettings({
      ...store.data.settings,
      places: { ...cur, citiesV: CITIES_V, notTrip: grow(cur.notTrip), fixed: cur.fixed.map((f) => (f.also ? { ...f, also: grow(f.also) } : f)) },
    });
    if (changed) void noteAuto(`Stednavne: ${changed} steder fik et mere præcist navn (ny byliste)`);
  } catch (e) {
    void noteAuto(`Stednavne: kunne ikke opdateres (${e instanceof Error ? e.message : String(e)})`);
  } finally {
    relabeling = false;
  }
}
