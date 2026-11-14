// Billeder og steder: hjælpe-appen "Dagbog Billeder" sender dato og sted for kamera-billederne,
// og Dagbog giver dem et bynavn på telefonen (uden net) ud fra byer.txt (GeoNames, CC BY 4.0).
import { toISO } from './dates';
import type { PhonePhoto, PhotoMonth } from './types';

export const PAYLOAD_HEAD = 'DAGBOG-BILLEDER v1';
/** Hjælpe-appen åbnes fra Dagbog med denne adresse (Chrome på Android); mangler den, hentes APK'en. */
export const APK_URL = 'https://github.com/pbo-dot/dagbog/releases/download/billeder/dagbog-billeder.apk';
export const OPEN_APP_URL = `intent://hent#Intent;scheme=dagbogbilleder;package=dk.dagbog.billeder;S.browser_fallback_url=${encodeURIComponent(APK_URL)};end`;

export interface Payload {
  log: string[]; // linjer, der starter med "#" (appens log)
  photos: PhonePhoto[];
}

/** Læser teksten fra hjælpe-appen: "id;taget-ms;bredde;længde" pr. linje, log-linjer med "#". */
export function parsePayload(text: string): Payload {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== PAYLOAD_HEAD) throw new Error('Det er ikke en liste fra Dagbog Billeder.');
  const log: string[] = [];
  const photos: PhonePhoto[] = [];
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) { log.push(line.slice(1).trim()); continue; }
    const [id, t, lat, lng] = line.split(';');
    const p: PhonePhoto = { id: Number(id), t: Number(t) };
    if (!Number.isFinite(p.id) || !Number.isFinite(p.t) || p.t <= 0) continue;
    const la = Number(lat);
    const lo = Number(lng);
    if (lat && lng && Number.isFinite(la) && Number.isFinite(lo) && !(la === 0 && lo === 0)) { p.lat = la; p.lng = lo; }
    photos.push(p);
  }
  return { log, photos };
}

interface City { name: string; cc: string; lat: number; lng: number }

let cities: Promise<Map<string, City[]>> | null = null;
const cell = (lat: number, lng: number) => `${Math.floor(lat)}:${Math.floor(lng)}`;

/** Bylisten, fordelt i felter på 1×1 grad, så kun nabofelterne skal gennemsøges. */
function loadCities(): Promise<Map<string, City[]>> {
  cities ??= fetch(`${import.meta.env.BASE_URL}byer.txt`).then(async (r) => {
    if (!r.ok) throw new Error(`Bylisten kunne ikke hentes (${r.status}).`);
    const grid = new Map<string, City[]>();
    for (const line of (await r.text()).split('\n')) {
      if (!line || line.startsWith('#')) continue;
      const [name, cc, lat, lng] = line.split('|');
      const c = { name, cc, lat: Number(lat), lng: Number(lng) };
      const k = cell(c.lat, c.lng);
      const list = grid.get(k);
      if (list) list.push(c); else grid.set(k, [c]);
    }
    return grid;
  }).catch((e) => { cities = null; throw e; });
  return cities;
}

/** Nærmeste by (højst ca. 2 grader væk), ellers null (fx på havet). */
function nearest(grid: Map<string, City[]>, lat: number, lng: number): City | null {
  let best: City | null = null;
  let bestD = Infinity;
  const k = Math.cos((lat * Math.PI) / 180);
  for (let r = 0; r <= 2 && !best; r++) {
    for (let a = -r; a <= r; a++) {
      for (let b = -r; b <= r; b++) {
        if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
        for (const c of grid.get(cell(lat + a, lng + b)) ?? []) {
          const d = (c.lat - lat) ** 2 + ((c.lng - lng) * k) ** 2;
          if (d < bestD) { bestD = d; best = c; }
        }
      }
    }
  }
  return best;
}

/** Giver billederne et bynavn. Billeder med samme sted (afrundet) slås kun op én gang. */
export async function addCities(photos: PhonePhoto[]): Promise<number> {
  const grid = await loadCities();
  const memo = new Map<string, City | null>();
  let found = 0;
  for (const p of photos) {
    if (p.lat === undefined || p.lng === undefined) continue;
    const key = `${p.lat.toFixed(3)}:${p.lng.toFixed(3)}`;
    if (!memo.has(key)) memo.set(key, nearest(grid, p.lat, p.lng));
    const c = memo.get(key);
    if (c) { p.city = c.name; p.cc = c.cc; found++; }
  }
  return found;
}

/** Landets navn på dansk, fx "PT" → "Portugal". */
export function countryName(cc: string): string {
  try {
    return new Intl.DisplayNames(['da'], { type: 'region' }).of(cc) ?? cc;
  } catch {
    return cc;
  }
}

const monthOf = (t: number) => toISO(new Date(t)).slice(0, 7);

/** Lægger de nye billeder sammen med de gamle pr. måned (samme nummer og tid = samme billede). */
export function mergeMonths(old: Record<string, PhotoMonth>, photos: PhonePhoto[], now = Date.now()): { months: PhotoMonth[]; added: number } {
  const by = new Map<string, PhonePhoto[]>();
  for (const p of photos) {
    const m = monthOf(p.t);
    const list = by.get(m);
    if (list) list.push(p); else by.set(m, [p]);
  }
  const months: PhotoMonth[] = [];
  let added = 0;
  for (const [id, fresh] of by) {
    const have = new Map((old[id]?.photos ?? []).map((p) => [`${p.id}:${p.t}`, p]));
    let changed = false;
    for (const p of fresh) {
      const k = `${p.id}:${p.t}`;
      const before = have.get(k);
      if (!before) { added++; changed = true; have.set(k, p); }
      else if ((before.city ?? '') !== (p.city ?? '') || before.lat !== p.lat) { changed = true; have.set(k, p); }
    }
    if (changed) months.push({ id, photos: [...have.values()].sort((a, b) => a.t - b.t), importedAt: now });
  }
  return { months, added };
}

export interface Stay { city: string; cc: string; from: number; to: number; count: number }

const hm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`; };
export const stayTime = (s: Stay) => (s.count === 1 || hm(s.from) === hm(s.to) ? hm(s.from) : `${hm(s.from)}–${hm(s.to)}`);

/** Stederne på en dag i rækkefølge: billeder i træk fra samme by bliver ét ophold. */
export function dayStays(months: Record<string, PhotoMonth>, date: string): Stay[] {
  const out: Stay[] = [];
  for (const p of months[date.slice(0, 7)]?.photos ?? []) {
    if (!p.city || toISO(new Date(p.t)) !== date) continue;
    const last = out[out.length - 1];
    if (last && last.city === p.city && last.cc === p.cc) { last.to = p.t; last.count++; }
    else out.push({ city: p.city, cc: p.cc ?? '', from: p.t, to: p.t, count: 1 });
  }
  return out;
}

/** Hvor mange billeder der er på dagen (også dem uden sted). */
export function dayPhotoCount(months: Record<string, PhotoMonth>, date: string): number {
  return (months[date.slice(0, 7)]?.photos ?? []).filter((p) => toISO(new Date(p.t)) === date).length;
}

/**
 * Til Spørg: én linje pr. dag med billeder, fx "2026-09-03: Faro 11.02, Olhão 13.26–16.45 (Portugal) · 21 billeder".
 * Hjemlandet nævnes ikke, så linjerne er korte.
 */
export function placeLines(months: Record<string, PhotoMonth>, inside: (d: string) => boolean = () => true): string[] {
  const days = new Map<string, PhonePhoto[]>();
  for (const m of Object.values(months)) {
    for (const p of m.photos) {
      const d = toISO(new Date(p.t));
      if (!inside(d)) continue;
      const list = days.get(d);
      if (list) list.push(p); else days.set(d, [p]);
    }
  }
  const counts = new Map<string, number>();
  for (const ps of days.values()) for (const p of ps) if (p.cc) counts.set(p.cc, (counts.get(p.cc) ?? 0) + 1);
  const home = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return [...days.keys()].sort().map((d) => {
    const stays = dayStays(months, d);
    const ccs = [...new Set(stays.map((s) => s.cc))].filter((c) => c && c !== home);
    const where = stays.map((s) => `${s.city} ${stayTime(s)}`).join(', ') || 'sted ukendt';
    return `- ${d}: ${where}${ccs.length ? ` (${ccs.map(countryName).join(', ')})` : ''} · ${days.get(d)!.length} billeder`;
  });
}
