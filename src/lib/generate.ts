// Generering af ugeopsummeringer og månedskapitler – med AI eller lokalt.
import { summarizeWeek, writeMonthChapter } from './ai';
import { addDays, currentSummaryWeek, monthId, prevMonthId, summaryDayOf, today, weekDays, weekId } from './dates';
import type { Data } from './store';
import { moodLabel, type Entry, type MonthChapter, type WeekSummary } from './types';

export function aiReady(data: Data) {
  return data.settings.ai.enabled && !!data.settings.ai.apiKey;
}

function countBy<T>(xs: T[]): [T, number][] {
  const m = new Map<T, number>();
  for (const x of xs) m.set(x, (m.get(x) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

/** Enkel, lokal iagttagelse: humør der går igen med et bestemt tag. */
function localPatterns(entries: Entry[]): string[] {
  const out: string[] = [];
  const tags = countBy(entries.flatMap((e) => e.tags));
  for (const [tag, n] of tags) {
    if (n < 3) break;
    const withTag = entries.filter((e) => e.tags.includes(tag) && e.mood);
    const [top] = countBy(withTag.map((e) => e.mood!));
    if (top && top[1] >= 2 && top[1] / withTag.length >= 0.6) {
      out.push(`På dage med "${tag}" skrev du oftest, at du var ${moodLabel(top[0]).toLowerCase()} (${top[1]} af ${withTag.length} dage de seneste uger).`);
    }
    if (out.length >= 2) break;
  }
  return out;
}

export function localWeek(data: Data, id: string): WeekSummary {
  const es = weekDays(id).map((d) => data.entries[d]).filter(Boolean);
  const moods = countBy(es.map((e) => e.mood).filter(Boolean) as string[]);
  const tags = countBy(es.flatMap((e) => e.tags));
  const recent: Entry[] = [];
  for (let w = 0; w < 8; w++) {
    for (const d of weekDays(weekId(addDays(weekDays(id)[0], -7 * w)))) if (data.entries[d]) recent.push(data.entries[d]);
  }
  const moodText = moods.map(([m, n]) => `${moodLabel(m as Entry['mood'])} (${n})`).join(', ');
  const summary = [
    `Du skrev ${es.length} ${es.length === 1 ? 'dag' : 'dage'} i ugen.`,
    moods.length ? `Humøret var: ${moodText}.` : '',
    tags.length ? `Det handlede mest om ${tags.slice(0, 3).map(([t]) => t).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  return {
    id,
    threeWords: [],
    takeaway: '',
    summary,
    themes: tags.slice(0, 4).map(([t]) => t),
    feelings: moods.map(([m]) => moodLabel(m as Entry['mood'])),
    patterns: localPatterns(recent),
    reflection: 'Hvad lagde du mest mærke til i ugen, der gik?',
    nextWeekQuestion: 'Hvad vil du give plads til i næste uge?',
    crisis: false,
    generatedAt: Date.now(),
    byAI: false,
    seen: false,
  };
}

export async function generateWeek(data: Data, id: string, useAI: boolean): Promise<WeekSummary> {
  const old = data.weeks[id];
  const base = useAI
    ? { ...(await summarizeWeek(data.settings, id, data.entries)), id, generatedAt: Date.now(), byAI: true, seen: false }
    : localWeek(data, id);
  // Bevar det personen selv har skrevet
  return { ...base, intention: old?.intention, deeper: undefined } as WeekSummary;
}

export function monthEntries(data: Data, id: string): Entry[] {
  return Object.values(data.entries).filter((e) => e.date.startsWith(id)).sort((a, b) => a.date.localeCompare(b.date));
}

/** Temaer til tidslinjen: kapitlets temaer, ellers mest brugte tags/humør. */
export function monthThemes(data: Data, id: string): string[] {
  const ch = data.months[id];
  if (ch?.themes.length) return ch.themes;
  const es = monthEntries(data, id);
  const tags = countBy(es.flatMap((e) => e.tags)).map(([t]) => t);
  const moods = countBy(es.map((e) => e.mood).filter(Boolean) as string[]).map(([m]) => moodLabel(m as Entry['mood']).toLowerCase());
  return [...tags.slice(0, 4), ...moods.slice(0, 1)].slice(0, 5);
}

export async function generateMonth(data: Data, id: string): Promise<MonthChapter> {
  const out = await writeMonthChapter(data.settings, id, monthEntries(data, id));
  return { id, ...out, generatedAt: Date.now(), edited: false, seen: false };
}

/** Hvad skal genereres automatisk lige nu? */
export function pendingGeneration(data: Data): { week?: string; month?: string } {
  if (!aiReady(data)) return {};
  const t = today();
  const out: { week?: string; month?: string } = {};
  const wid = currentSummaryWeek(t, data.settings.summaryWeekday);
  const day = summaryDayOf(wid, data.settings.summaryWeekday);
  const hasEntries = weekDays(wid).some((d) => data.entries[d]);
  const dayDone = t > day || !!data.entries[t] || data.meta.skipped.includes(t);
  if (hasEntries && dayDone && !data.weeks[wid]) out.week = wid;
  const mid = prevMonthId(monthId(t));
  if (!data.months[mid] && monthEntries(data, mid).length >= 3) out.month = mid;
  return out;
}

