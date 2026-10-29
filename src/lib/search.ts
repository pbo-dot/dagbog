// Lokal, øjeblikkelig søgning i fritekst, tags og humør.
import { moodLabel, type Entry } from './types';

const STOP = new Set(
  'og i jeg det at en den til er som på de med han af for ikke der var mig sig men et har om vi min havde ham hun nu over da fra du ud sin dem os op man hans hvor eller hvad skal selv her alle vil blev kunne ind når være dog noget ville jo deres efter ned skulle denne end dette mit også under have dig anden hende mine alt meget sit sine vor mod disse hvis din nogle hos blive mange ad bliver hendes været thi jer sådan hvornår hvem hvordan hvorfor var mest'.split(' '),
);

export function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .normalize('NFC')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

export interface Hit {
  entry: Entry;
  score: number;
  terms: string[]; // ord/fraser der skal fremhæves
}

export function localSearch(query: string, entries: Entry[]): Hit[] {
  const q = tokenize(query);
  if (!q.length) return [];
  const hits: Hit[] = [];
  for (const e of entries) {
    const words = tokenize(`${e.text} ${e.good.join(' ')}`);
    const tags = e.tags.map((t) => t.toLowerCase());
    const mood = moodLabel(e.mood).toLowerCase();
    let score = 0;
    const terms = new Set<string>();
    for (const t of q) {
      // præfiks-match så "træt" også finder "træthed" og "trætte"
      const stem = t.length > 4 ? t.slice(0, t.length - 1) : t;
      let found = false;
      for (const w of words) {
        if (w.startsWith(stem)) {
          score += w === t ? 2 : 1;
          terms.add(w);
          found = true;
        }
      }
      if (tags.some((tag) => tag.startsWith(stem))) {
        score += 4;
        found = true;
      }
      if (mood && mood.startsWith(stem)) {
        score += 3;
        found = true;
      }
      if (!found) score -= 1;
    }
    if (score > 0) hits.push({ entry: e, score, terms: [...terms] });
  }
  return hits.sort((a, b) => b.score - a.score || b.entry.date.localeCompare(a.entry.date)).slice(0, 50);
}

/** Uddrag omkring første forekomst af et af ordene. */
export function excerpt(text: string, terms: string[], len = 160): string {
  const lower = text.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  if (at < 0 || text.length <= len) return text.length > len ? `${text.slice(0, len).trim()} …` : text;
  const start = Math.max(0, at - Math.floor(len / 3));
  const end = Math.min(text.length, start + len);
  return `${start > 0 ? '… ' : ''}${text.slice(start, end).trim()}${end < text.length ? ' …' : ''}`;
}

/** Opdel tekst i stykker med markering af fremhævede ord. */
export function highlight(text: string, terms: string[]): { t: string; hit: boolean }[] {
  const clean = terms.filter((t) => t.trim().length > 1);
  if (!clean.length) return [{ t: text, hit: false }];
  const esc = clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).sort((a, b) => b.length - a.length);
  const lowerTerms = new Set(clean.map((t) => t.toLowerCase()));
  const re = new RegExp(`(${esc.join('|')})`, 'giu');
  return text.split(re).filter(Boolean).map((t) => ({ t, hit: lowerTerms.has(t.toLowerCase()) }));
}

/** Passer et søgeord til et ord i teksten? Tåler bøjning (mor/mors, kode/koden) og sammensatte ord (pleje/hjemmepleje). */
function wordMatch(term: string, word: string): boolean {
  const stem = term.length > 4 ? term.slice(0, -1) : term;
  if (word.startsWith(stem)) return true;
  if (stem.length >= 4 && word.includes(stem)) return true;
  return word.length >= 3 && term.startsWith(word) && term.length - word.length <= 2;
}

/** Hvor mange af søgeordene findes i teksten? */
export function termHits(terms: string[], text: string): number {
  if (!terms.length) return 0;
  const words = new Set(tokenize(text));
  let n = 0;
  for (const t of terms) {
    for (const w of words) if (wordMatch(t, w)) { n++; break; }
  }
  return n;
}

/**
 * Det bedste først: flest søgeord, og ord i titlen tæller ekstra. Kræver mindst ét
 * meningsfuldt ord, så et helt spørgsmål ("telefonnummer til min mors hjemmepleje")
 * også finder noten "Hjemmepleje".
 */
export function rankByTerms<T>(items: T[], terms: string[], title: (x: T) => string, body: (x: T) => string): T[] {
  if (!terms.length) return [];
  return items
    .map((x) => ({ x, s: termHits(terms, title(x)) * 1.5 + termHits(terms, `${title(x)}\n${body(x)}`) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((r) => r.x);
}
