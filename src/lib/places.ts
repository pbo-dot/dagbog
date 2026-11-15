// Billeder og steder: hjælpe-appen "Dagbog Billeder" sender dato og sted for kamera-billederne,
// og Dagbog giver dem et bynavn på telefonen (uden net) ud fra byer.txt (GeoNames, CC BY 4.0).
import { toISO } from './dates';
import { addDays } from './dates';
import type { FixedPlace, PhonePhoto, PhotoMonth, Visit, VisitMonth } from './types';

/** Første linje fra hjælpe-appen: v1 = kun dato og sted, v2 = også små billeder ("B;id;taget-ms;base64"). */
/** Billedernes størrelse i den nyeste hjælpe-app; er de gemte mindre, tilbydes "Hent i bedre kvalitet". */
export const THUMB_PX = 1080;

export const PAYLOAD_HEADS = ['DAGBOG-BILLEDER v1', 'DAGBOG-BILLEDER v2'];
/** Hjælpe-appen åbnes fra Dagbog med denne adresse (Chrome på Android); mangler den, hentes APK'en. */
export const APK_URL = 'https://github.com/pbo-dot/dagbog/releases/download/billeder/dagbog-billeder.apk';
/** Adressen, der åbner hjælpe-appen; `fra` = dagen, den skal sende små billeder fra. */
export function openAppUrl(fra?: string): string {
  return `intent://hent${fra ? `?fra=${fra}` : ''}#Intent;scheme=dagbogbilleder;package=dk.dagbog.billeder;S.browser_fallback_url=${encodeURIComponent(APK_URL)};end`;
}

export interface Payload {
  log: string[]; // linjer, der starter med "#" (appens log)
  photos: PhonePhoto[];
  thumbs: Array<{ id: number; t: number; data: string }>; // små billeder (base64 JPEG)
  next?: string; // hjælpe-appen havde flere små billeder: næste gang fra denne dag
  size?: number; // billedernes størrelse (px på den lange led)
  other?: boolean; // fra en anden (gammel) telefon via Drev
}

/** Læser teksten fra hjælpe-appen: "id;taget-ms;bredde;længde" pr. linje, log-linjer med "#". */
export function parsePayload(text: string): Payload {
  const lines = text.split(/\r?\n/);
  if (!PAYLOAD_HEADS.includes(lines[0]?.trim() ?? '')) throw new Error('Det er ikke en liste fra Dagbog Billeder.');
  const log: string[] = [];
  const photos: PhonePhoto[] = [];
  const thumbs: Payload['thumbs'] = [];
  let next: string | undefined;
  let size: number | undefined;
  let other = false;
  for (const raw of lines.slice(1)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const l = line.slice(1).trim();
      const m = /^næste (\d{4}-\d{2}-\d{2})$/.exec(l);
      const sz = /^størrelse (\d+)$/.exec(l);
      if (m) next = m[1]; else if (sz) size = Number(sz[1]); else { if (l.startsWith('kilde anden telefon')) other = true; log.push(l); }
      continue;
    }
    if (line.startsWith('B;')) {
      const [, id, t, data] = line.split(';');
      if (Number.isFinite(Number(id)) && Number(t) > 0 && data) thumbs.push({ id: Number(id), t: Number(t), data });
      continue;
    }
    const [id, t, lat, lng] = line.split(';');
    const p: PhonePhoto = { id: Number(id), t: Number(t) };
    if (!Number.isFinite(p.id) || !Number.isFinite(p.t) || p.t <= 0) continue;
    const la = Number(lat);
    const lo = Number(lng);
    if (lat && lng && Number.isFinite(la) && Number.isFinite(lo) && !(la === 0 && lo === 0)) { p.lat = la; p.lng = lo; }
    photos.push(p);
  }
  return { log, photos, thumbs, next, size, other };
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

type Placed = { lat?: number; lng?: number; city?: string; cc?: string };

/** Giver billeder eller ophold et bynavn. Samme sted (afrundet) slås kun op én gang. */
export async function addCities(photos: Placed[]): Promise<number> {
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
    // Nøglen er tidspunktet, så et billede, der ligger på begge telefoner, kun kommer med én gang
    const have = new Map((old[id]?.photos ?? []).map((p) => [`${p.t}`, p]));
    let changed = false;
    for (const p of fresh) {
      const k = `${p.t}`;
      const before = have.get(k);
      if (!before) { added++; changed = true; have.set(k, p); }
      else {
        // Billedet og Claudes beskrivelse bevares, når dato og sted sendes igen
        const merged = { ...p, thumb: p.thumb ?? before.thumb, desc: p.desc ?? before.desc };
        if ((before.city ?? '') !== (merged.city ?? '') || before.lat !== merged.lat || before.thumb !== merged.thumb) { changed = true; have.set(k, merged); }
      }
    }
    if (changed) months.push({ id, photos: [...have.values()].sort((a, b) => a.t - b.t), importedAt: now });
  }
  return { months, added };
}

export interface Stay { city: string; cc: string; from: number; to: number; count: number; lat?: number; lng?: number }

/** "55.6789°, 12.3456°" → [55.6789, 12.3456] */
function latLng(v: unknown): [number, number] | null {
  const m = typeof v === 'string' ? /(-?\d+(?:\.\d+)?)°?,\s*(-?\d+(?:\.\d+)?)/.exec(v) : null;
  return m ? [Number(m[1]), Number(m[2])] : null;
}

/**
 * Opholdene fra Google Maps-tidslinjen (eksporteret fra telefonen, `semanticSegments`).
 * Kun øverste niveau af besøg; ruter og rå GPS-punkter springes over.
 */
export function parseTimeline(json: unknown): Visit[] {
  const segs = ((json as { semanticSegments?: unknown[] })?.semanticSegments ?? []) as Array<Record<string, unknown>>;
  const out: Visit[] = [];
  for (const seg of segs) {
    const v = seg.visit as { hierarchyLevel?: number; topCandidate?: { semanticType?: string; placeLocation?: { latLng?: string } } } | undefined;
    if (!v || (v.hierarchyLevel ?? 0) !== 0) continue;
    const ll = latLng(v.topCandidate?.placeLocation?.latLng);
    const s = Date.parse(String(seg.startTime));
    const e = Date.parse(String(seg.endTime));
    if (!ll || !Number.isFinite(s) || !Number.isFinite(e)) continue;
    out.push({ s, e, lat: ll[0], lng: ll[1], ...(v.topCandidate?.semanticType === 'HOME' ? { home: true } : {}) });
  }
  return out;
}

/** Lægger nye ophold sammen med de gamle pr. måned (samme starttid = samme ophold). */
export function mergeVisits(old: Record<string, VisitMonth>, visits: Visit[], now = Date.now()): { months: VisitMonth[]; added: number } {
  const by = new Map<string, Visit[]>();
  for (const v of visits) {
    const m = monthOf(v.s);
    const list = by.get(m);
    if (list) list.push(v); else by.set(m, [v]);
  }
  const months: VisitMonth[] = [];
  let added = 0;
  for (const [id, fresh] of by) {
    const have = new Map((old[id]?.visits ?? []).map((v) => [v.s, v]));
    let changed = false;
    for (const v of fresh) {
      if (!have.has(v.s)) { added++; changed = true; have.set(v.s, v); }
    }
    if (changed) months.push({ id, visits: [...have.values()].sort((a, b) => a.s - b.s), importedAt: now });
  }
  return { months, added };
}

const dayStart = (date: string) => new Date(`${date}T00:00:00`).getTime();

/** Opholdene, der rører dagen (også et ophold, der begyndte dagen før). */
function dayVisits(visits: Record<string, VisitMonth>, date: string): Visit[] {
  const from = dayStart(date);
  const to = dayStart(addDays(date, 1));
  const ids = [monthOf(from - 40 * 86_400_000), date.slice(0, 7)];
  const out: Visit[] = [];
  for (const id of new Set(ids)) for (const v of visits[id]?.visits ?? []) if (v.s < to && v.e > from) out.push(v);
  // Lange ophold (fx hjemme i ugevis) kan være begyndt i en måned imellem
  for (const m of Object.values(visits)) {
    if (m.id <= ids[0] || m.id >= ids[1]) continue;
    for (const v of m.visits) if (v.s < to && v.e > from) out.push(v);
  }
  return out.sort((a, b) => a.s - b.s);
}

const hm = (t: number) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, '0')}.${String(d.getMinutes()).padStart(2, '0')}`; };
export const stayTime = (s: Stay) => (s.count === 1 || hm(s.from) === hm(s.to) ? hm(s.from) : `${hm(s.from)}–${hm(s.to)}`);

/**
 * Stederne på en dag i rækkefølge. Fra Tidslinjen, hvis den har dagen (tiderne klippes til dagen);
 * ellers fra billederne, hvor billeder i træk fra samme by bliver ét ophold.
 */
export function dayStays(months: Record<string, PhotoMonth>, date: string, visits: Record<string, VisitMonth> = {}, fixed: FixedPlace[] = []): Stay[] {
  return named(rawDayStays(months, date, visits), fixed);
}

function rawDayStays(months: Record<string, PhotoMonth>, date: string, visits: Record<string, VisitMonth>): Stay[] {
  const out: Stay[] = [];
  const from = dayStart(date);
  const to = dayStart(addDays(date, 1)) - 60_000;
  for (const v of dayVisits(visits, date)) {
    if (!v.city) continue;
    const s = Math.max(v.s, from);
    const e = Math.min(v.e, to);
    const last = out[out.length - 1];
    if (last && last.city === v.city && last.cc === v.cc) { last.to = e; last.count++; }
    else out.push({ city: v.city, cc: v.cc ?? '', from: s, to: e, count: 2, lat: v.lat, lng: v.lng });
  }
  if (out.length) return out;
  for (const p of months[date.slice(0, 7)]?.photos ?? []) {
    if (!p.city || toISO(new Date(p.t)) !== date) continue;
    const last = out[out.length - 1];
    if (last && last.city === p.city && last.cc === p.cc) { last.to = p.t; last.count++; }
    else out.push({ city: p.city, cc: p.cc ?? '', from: p.t, to: p.t, count: 1, lat: p.lat, lng: p.lng });
  }
  return out;
}

/** Hvor mange billeder der er på dagen (også dem uden sted). */
export function dayPhotoCount(months: Record<string, PhotoMonth>, date: string): number {
  return (months[date.slice(0, 7)]?.photos ?? []).filter((p) => toISO(new Date(p.t)) === date).length;
}

interface DayPoint { city: string; cc: string; lat: number; lng: number }

/** Alt inden for så mange km fra et fast sted regnes som stedet (fx stranden ved sommerhuset). */
export const FIXED_KM = 8;

/** Det faste sted, punktet ligger ved, hvis nogen. */
export function fixedAt(p: { lat?: number; lng?: number }, fixed: FixedPlace[]): FixedPlace | undefined {
  if (p.lat === undefined || p.lng === undefined) return undefined;
  return fixed.find((f) => km(f, { lat: p.lat!, lng: p.lng! }) <= FIXED_KM);
}

/** Ophold ved et fast sted får stedets navn (fx "Sommerhuset"), og ophold i træk lægges sammen. */
function named(stays: Stay[], fixed: FixedPlace[]): Stay[] {
  if (!fixed.length) return stays;
  const out: Stay[] = [];
  for (const st of stays) {
    const f = fixedAt(st, fixed);
    const x = f ? { ...st, city: f.name, cc: 'DK' } : st;
    const last = out[out.length - 1];
    if (last && last.city === x.city) { last.to = x.to; last.count += x.count; }
    else out.push({ ...x });
  }
  return out;
}

/** Afstand i km (god nok på korte og mellemlange afstande). */
function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const k = Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(a.lat - b.lat, (a.lng - b.lng) * k) * 111.2;
}

/** Alle steder pr. dag fra både Tidslinjen og billederne, og hjemmet (Googles HOME) pr. dag. */
/** Husker det seneste resultat, så længe data er de samme (flere skærme og Spørg beder om det samme). */
function memoLast<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  let last: { args: A; out: R } | null = null;
  return (...args: A) => {
    if (last && last.args.length === args.length && last.args.every((x, i) => x === args[i])) return last.out;
    const out = fn(...args);
    last = { args, out };
    return out;
  };
}

const placesByDay = memoLast(placesByDayRaw);

function placesByDayRaw(months: Record<string, PhotoMonth>, visits: Record<string, VisitMonth>) {
  const days = new Map<string, DayPoint[]>();
  const add = (date: string, p: DayPoint) => { const l = days.get(date); if (l) l.push(p); else days.set(date, [p]); };
  const homes: Array<{ t: number; lat: number; lng: number }> = [];
  for (const m of Object.values(visits)) {
    for (const v of m.visits) {
      if (v.home) homes.push({ t: v.s, lat: v.lat, lng: v.lng });
      if (!v.city) continue;
      // Et ophold over flere dage tæller på hver dag (højst 60 dage)
      for (let d = toISO(new Date(v.s)), n = 0; d <= toISO(new Date(v.e)) && n < 60; d = addDays(d, 1), n++) add(d, { city: v.city, cc: v.cc ?? '', lat: v.lat, lng: v.lng });
    }
  }
  for (const m of Object.values(months)) {
    for (const p of m.photos) if (p.city && p.lat !== undefined && p.lng !== undefined) add(toISO(new Date(p.t)), { city: p.city, cc: p.cc ?? '', lat: p.lat, lng: p.lng });
  }
  homes.sort((a, b) => a.t - b.t);
  return { days, homes };
}

/**
 * Rejser: dage i træk, hvor et sted ligger mere end 50 km fra hjemmet (det seneste sted,
 * Google har mærket som hjemme). Fx "2025-05-02 – 2025-05-06: Rome, Ostia (Italien)".
 */
const NO_FIXED: FixedPlace[] = [];
const tripsMemo = memoLast(tripsRaw);

export function trips(months: Record<string, PhotoMonth>, visits: Record<string, VisitMonth>, fixed: FixedPlace[] = NO_FIXED): Array<{ from: string; to: string; cities: string[]; countries: string[] }> {
  return tripsMemo(months, visits, fixed.length ? fixed : NO_FIXED);
}

function tripsRaw(months: Record<string, PhotoMonth>, visits: Record<string, VisitMonth>, fixed: FixedPlace[]): Array<{ from: string; to: string; cities: string[]; countries: string[] }> {
  const { days, homes } = placesByDay(months, visits);
  const out: Array<{ from: string; to: string; cities: string[]; countries: string[] }> = [];
  let h = 0;
  let home = homes[0];
  for (const date of [...days.keys()].sort()) {
    const end = dayStart(addDays(date, 1));
    while (h < homes.length && homes[h].t < end) home = homes[h++];
    const pts = days.get(date)!;
    const base = home ?? pts[0];
    const far = pts.filter((p) => km(p, base) > 50 && !fixedAt(p, fixed));
    if (!far.length) continue;
    const last = out[out.length - 1];
    const trip = last && addDays(last.to, 1) >= date ? last : null;
    const t = trip ?? { from: date, to: date, cities: [], countries: [] };
    t.to = date;
    for (const p of far) {
      if (!t.cities.includes(p.city)) t.cities.push(p.city);
      if (p.cc && p.cc !== 'DK' && !t.countries.includes(p.cc)) t.countries.push(p.cc);
    }
    if (!trip) out.push(t);
  }
  return out;
}

/** Hvornår man var ved hvert fast sted: dage i træk bliver ét ophold. */
export function fixedStays(months: Record<string, PhotoMonth>, visits: Record<string, VisitMonth>, fixed: FixedPlace[]): Array<{ place: FixedPlace; stays: Array<{ from: string; to: string }> }> {
  if (!fixed.length) return [];
  const { days } = placesByDay(months, visits);
  const sorted = [...days.keys()].sort();
  return fixed.map((place) => {
    const stays: Array<{ from: string; to: string }> = [];
    for (const d of sorted) {
      if (!days.get(d)!.some((p) => km(p, place) <= FIXED_KM)) continue;
      const last = stays[stays.length - 1];
      if (last && addDays(last.to, 1) >= d) last.to = d;
      else stays.push({ from: d, to: d });
    }
    return { place, stays };
  });
}

/**
 * Forslag til faste steder: byer, der optræder i mindst 6 rejser, og som ikke allerede er
 * faste steder eller afvist. Stedet er det punkt i byen, man oftest har været.
 */
export function suggestFixed(months: Record<string, PhotoMonth>, visits: Record<string, VisitMonth>, fixed: FixedPlace[], notFixed: string[]): Array<{ city: string; trips: number; lat: number; lng: number }> {
  const list = trips(months, visits, fixed);
  const count = new Map<string, number>();
  for (const t of list) for (const c of t.cities) count.set(c, (count.get(c) ?? 0) + 1);
  const { days } = placesByDay(months, visits);
  const out: Array<{ city: string; trips: number; lat: number; lng: number }> = [];
  for (const [city, n] of count) {
    if (n < 6 || notFixed.includes(city) || fixed.some((f) => f.city === city)) continue;
    const spots = new Map<string, { lat: number; lng: number; n: number }>();
    for (const pts of days.values()) {
      for (const p of pts) {
        if (p.city !== city) continue;
        const k = `${p.lat.toFixed(2)}:${p.lng.toFixed(2)}`;
        const sp = spots.get(k) ?? { lat: p.lat, lng: p.lng, n: 0 };
        sp.n++;
        spots.set(k, sp);
      }
    }
    const best = [...spots.values()].sort((a, b) => b.n - a.n)[0];
    if (best) out.push({ city, trips: n, lat: best.lat, lng: best.lng });
  }
  return out.sort((a, b) => b.trips - a.trips);
}

/** "Sommerhuset (Nykøbing Sjælland): 2023: 14.–15. okt., 23.–24. sep. …" én linje pr. år. */
export function fixedLines(months: Record<string, PhotoMonth>, visits: Record<string, VisitMonth>, fixed: FixedPlace[]): string[] {
  const short = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
  const out: string[] = [];
  for (const { place, stays } of fixedStays(months, visits, fixed)) {
    const years = new Map<string, Array<{ from: string; to: string }>>();
    for (const st of stays) { const y = st.from.slice(0, 4); const l = years.get(y); if (l) l.push(st); else years.set(y, [st]); }
    for (const [y, ss] of years) {
      out.push(`- ${place.name} (${place.city}) ${y}: ${ss.length} ophold · ${ss.map((x) => (x.from === x.to ? short(x.from) : `${short(x.from)}–${short(x.to)}`)).join(', ')}`);
    }
  }
  return out;
}

/** "2025-05-02 – 2025-05-06: Rome, Ostia (Italien)" */
export function tripLine(t: { from: string; to: string; cities: string[]; countries: string[] }): string {
  return `- ${t.from}${t.to !== t.from ? ` – ${t.to}` : ''}: ${t.cities.slice(0, 6).join(', ')}${t.cities.length > 6 ? ' m.fl.' : ''}${t.countries.length ? ` (${t.countries.map(countryName).join(', ')})` : ''}`;
}

/**
 * Til Spørg. I en periode: én linje pr. dag med stederne (Tidslinjen og billederne).
 * Ellers: rejserne (over 50 km hjemmefra), så materialet holdes kort over mange år.
 */
export function placeLines(months: Record<string, PhotoMonth>, visits: Record<string, VisitMonth> = {}, inside?: (d: string) => boolean, fixed: FixedPlace[] = []): string[] {
  if (!inside) return [...trips(months, visits, fixed).map(tripLine), ...fixedLines(months, visits, fixed)];
  const { days } = placesByDay(months, visits);
  return [...days.keys()].filter(inside).sort().map((d) => {
    const stays = dayStays(months, d, visits, fixed);
    const n = dayPhotoCount(months, d);
    const ccs = [...new Set(stays.map((x) => x.cc))].filter((c) => c && c !== 'DK');
    const descs = dayDescs(months, d).map((x) => `${x.time} ${x.text}`);
    return `- ${d}: ${stays.map((x) => `${x.city} ${stayTime(x)}`).join(', ') || 'sted ukendt'}${ccs.length ? ` (${ccs.map(countryName).join(', ')})` : ''}${n ? ` · ${n} billeder` : ''}${descs.length ? ` · billeder: ${descs.join('; ')}` : ''}`;
  });
}

/** Id'erne på dagens små billeder (i Dagbogs billedlager), i tidsorden. */
export function dayThumbs(months: Record<string, PhotoMonth>, date: string): string[] {
  return (months[date.slice(0, 7)]?.photos ?? []).filter((p) => p.thumb && toISO(new Date(p.t)) === date).map((p) => p.thumb!);
}

/** Claudes beskrivelser af dagens billeder: [{time: "11.02", text: "Strand ved Faro i sol"}]. */
export function dayDescs(months: Record<string, PhotoMonth>, date: string): Array<{ time: string; text: string }> {
  return (months[date.slice(0, 7)]?.photos ?? [])
    .filter((p) => p.desc && toISO(new Date(p.t)) === date)
    .map((p) => ({ time: hm(p.t), text: p.desc! }));
}

/** Til Spørg (hele dagbogen): én linje pr. beskrevet billede, nyeste først, højst `max`. */
export function photoLines(months: Record<string, PhotoMonth>, max = 1500): string[] {
  const all: Array<{ t: number; line: string }> = [];
  for (const m of Object.values(months)) {
    for (const p of m.photos) if (p.desc) all.push({ t: p.t, line: `- ${toISO(new Date(p.t))} ${hm(p.t)}${p.city ? ` ${p.city}` : ''}: ${p.desc}` });
  }
  return all.sort((a, b) => b.t - a.t).slice(0, max).sort((a, b) => a.t - b.t).map((x) => x.line);
}

const thumbIndexMemo = memoLast((months: Record<string, PhotoMonth>) => {
  const m = new Map<string, PhonePhoto>();
  for (const pm of Object.values(months)) for (const p of pm.photos) if (p.thumb) m.set(p.thumb, p);
  return m;
});

/** Hvornår og hvor et lille billede er taget: "Mandag 3. juli 2023 · kl. 11.02 · Rønne". */
export function thumbCaption(months: Record<string, PhotoMonth>, thumb: string, withDate = true): string {
  const p = thumbIndexMemo(months).get(thumb);
  if (!p) return '';
  const d = new Date(p.t);
  const date = d.toLocaleDateString('da-DK', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).replace(' den ', ' ');
  return [withDate ? date.charAt(0).toUpperCase() + date.slice(1) : '', `kl. ${hm(p.t)}`, p.city ?? ''].filter(Boolean).join(' · ');
}

/** Klokkeslæt for et lille billede, fx "11.02". */
export function thumbTime(months: Record<string, PhotoMonth>, thumb: string): string {
  const p = thumbIndexMemo(months).get(thumb);
  return p ? hm(p.t) : '';
}
