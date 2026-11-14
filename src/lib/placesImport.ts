// Indlæser listen fra hjælpe-appen "Dagbog Billeder" og fortæller skærmen, hvordan det går.
// Hvert trin skrives også i den lille log (Sikkerhedskopi › "Seneste forsøg").
import { useSyncExternalStore } from 'react';
import { noteAuto } from './google';
import { addCities, mergeMonths, mergeVisits, parsePayload, parseTimeline } from './places';
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

export async function importPlaces(store: Store, text: string): Promise<void> {
  set({ busy: true, lines: [], error: '' });
  try {
    say(`Modtog ${Math.round(text.length / 1024)} kB fra Dagbog Billeder`);
    const { log, photos } = parsePayload(text);
    for (const l of log) say(`app: ${l}`);
    const withPlace = photos.filter((p) => p.lat !== undefined).length;
    say(`${photos.length} billeder, ${withPlace} med sted`);
    const t0 = performance.now();
    const found = await addCities(photos);
    say(`Bynavne fundet for ${found} billeder på ${Math.round(performance.now() - t0)} ms`);
    const { months, added } = mergeMonths(store.data.phonePhotos, photos);
    for (const m of months) await store.put('phonePhotos', m.id, m);
    say(`${added} nye billeder, ${months.length} måneder gemt`);
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
    for (const m of months) await store.put('visits', m.id, m);
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
