// Finder en periode i et spørgsmål til "Spørg dagbogen", fx "i januar",
// "sidste sommer", "i 2025" eller "de sidste 3 uger", så kun de dage sendes til Claude.
import { addDays, fromISO, toISO, weekStart } from './dates';

export interface Period {
  from: string; // YYYY-MM-DD
  to: string; // YYYY-MM-DD
  label: string;
}

const MONTHS = ['januar', 'februar', 'marts', 'april', 'maj', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'december'];
const SEASONS: Record<string, [number, number]> = {
  // første og sidste måned (0 = januar); vinter går over nytår
  forår: [2, 4],
  foråret: [2, 4],
  sommer: [5, 7],
  sommeren: [5, 7],
  efterår: [8, 10],
  efteråret: [8, 10],
  vinter: [11, 1],
  vinteren: [11, 1],
};

const iso = (y: number, m: number, d: number) => toISO(new Date(y, m, d, 12));
const lastDay = (y: number, m: number) => new Date(y, m + 1, 0, 12).getDate();
const monthRange = (y: number, m1: number, m2: number) => ({ from: iso(y, m1, 1), to: iso(m2 < m1 ? y + 1 : y, m2, lastDay(m2 < m1 ? y + 1 : y, m2)) });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const NUMBERS: Record<string, number> = { en: 1, et: 1, to: 2, tre: 3, fire: 4, fem: 5, seks: 6, syv: 7, otte: 8, ni: 9, ti: 10, tolv: 12 };

/** Perioden, spørgsmålet handler om, eller null hvis der ikke nævnes en. */
export function findPeriod(question: string, todayIso: string): Period | null {
  const q = ` ${question.toLowerCase().replace(/[?!.,;:]/g, ' ')} `;
  const t = fromISO(todayIso);
  const y = t.getFullYear();
  const m = t.getMonth();
  const year = Number(/\b(19|20)\d{2}\b/.exec(q)?.[0] ?? 0) || null;

  // "i dag", "i går", "i forgårs"
  if (/\bi forgårs\b/.test(q)) { const d = addDays(todayIso, -2); return { from: d, to: d, label: 'i forgårs' }; }
  if (/\bi går\b/.test(q)) { const d = addDays(todayIso, -1); return { from: d, to: d, label: 'i går' }; }
  if (/\bi dag\b/.test(q)) return { from: todayIso, to: todayIso, label: 'i dag' };

  // "de sidste 3 uger", "seneste 10 dage", "sidste to måneder"
  const last = /\b(?:de |den )?(?:sidste|seneste)\s+(\d+|[a-zæøå]+)\s+(dage|dag|uger|uge|måneder|måned|år)\b/.exec(q);
  if (last) {
    const n = Number(last[1]) || NUMBERS[last[1]];
    if (n) {
      const unit = last[2];
      const days = unit.startsWith('dag') ? n : unit.startsWith('uge') ? n * 7 : unit.startsWith('måned') ? n * 31 : n * 366;
      return { from: addDays(todayIso, -days + 1), to: todayIso, label: `de sidste ${n} ${unit}` };
    }
  }

  // "denne uge", "sidste uge"
  if (/\b(?:denne|i denne|i den her) uge\b/.test(q)) return { from: weekStart(todayIso), to: todayIso, label: 'denne uge' };
  if (/\b(?:sidste|forrige) uge\b/.test(q)) { const s = addDays(weekStart(todayIso), -7); return { from: s, to: addDays(s, 6), label: 'sidste uge' }; }

  // "denne måned", "sidste måned"
  if (/\b(?:denne|i denne|den her) måned\b/.test(q)) return { from: iso(y, m, 1), to: todayIso, label: 'denne måned' };
  if (/\b(?:sidste|forrige) måned\b/.test(q)) { const d = new Date(y, m - 1, 1, 12); return { ...monthRange(d.getFullYear(), d.getMonth(), d.getMonth()), label: 'sidste måned' }; }

  // Månedsnavne, evt. med år: "januar", "i januar 2026", "fra marts til maj"
  const found = MONTHS.map((name, i) => ({ i, at: q.search(new RegExp(`\\b${name}\\b`)) })).filter((x) => x.at >= 0).sort((a, b) => a.at - b.at);
  if (found.length) {
    const first = found[0].i;
    const lastM = found[found.length - 1].i;
    // Uden år: den seneste gang måneden har været (eller er nu)
    const yy = year ?? (first > m ? y - 1 : y);
    const r = monthRange(yy, first, lastM);
    const label = first === lastM ? `${MONTHS[first]} ${yy}` : `${MONTHS[first]}–${MONTHS[lastM]} ${yy}`;
    return { ...r, label };
  }

  // Årstider: "sidste sommer", "i vinter", "sommeren 2025"
  for (const [word, [a, b]] of Object.entries(SEASONS)) {
    if (!new RegExp(`\\b${word}\\b`).test(q)) continue;
    let yy: number;
    if (year) yy = b < a ? year - 1 : year; // "vinteren 2026" = december 2025 – februar 2026
    else {
      // Seneste periode, der er begyndt
      yy = m >= a ? y : y - 1;
      if (b < a && m <= b) yy = y - 1;
    }
    return { ...monthRange(yy, a, b), label: `${word.replace(/en$|et$/, '')} ${b < a ? `${yy}/${yy + 1}` : yy}` };
  }

  // "i år", "sidste år", "i fjor", "i 2025"
  if (/\b(?:sidste år|i fjor|forrige år)\b/.test(q)) return { from: iso(y - 1, 0, 1), to: iso(y - 1, 11, 31), label: String(y - 1) };
  if (/\bi år\b/.test(q)) return { from: iso(y, 0, 1), to: todayIso, label: String(y) };
  if (year) return { from: iso(year, 0, 1), to: iso(year, 11, 31), label: String(year) };
  return null;
}

export function periodLabel(p: Period): string {
  return cap(p.label);
}
