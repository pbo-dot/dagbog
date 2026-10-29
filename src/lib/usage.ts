// Forbrug af Claude: tokens fra hvert svar regnes om til kroner. Det er et skøn
// ud fra Anthropics listepriser; den præcise regning står på console.anthropic.com.
import { MONTHS, monthId, today } from './dates';
import type { Usage } from './types';

/** Kroner pr. dollar (skøn). */
export const DKK_PER_USD = 6.9;

/** Dollar pr. million tokens: ind, ud og læst fra cache. */
const PRICES: Array<{ match: RegExp; input: number; output: number; cacheRead: number }> = [
  { match: /fable|mythos/, input: 10, output: 50, cacheRead: 0.25 },
  { match: /opus-5-5/, input: 4, output: 20, cacheRead: 0.2 },
  { match: /opus/, input: 5, output: 25, cacheRead: 0.5 },
  { match: /sonnet-4/, input: 3, output: 15, cacheRead: 0.3 },
  { match: /sonnet/, input: 2, output: 10, cacheRead: 0.2 },
  { match: /haiku-5/, input: 0.1, output: 0.5, cacheRead: 0.01 },
  { match: /haiku/, input: 1, output: 5, cacheRead: 0.1 },
];

/** Dollar pr. websøgning. */
const PER_SEARCH = 0.01;

/** Det, Dagbog bruger Claude til. */
export type Feature = 'ask' | 'web' | 'talk' | 'week' | 'month' | 'search' | 'test';

export const FEATURE_GROUPS: Array<{ label: string; features: Feature[] }> = [
  { label: 'Spørg dagbogen', features: ['ask', 'web', 'search'] },
  { label: 'Samtaler', features: ['talk'] },
  { label: 'Uge og måned', features: ['week', 'month'] },
  { label: 'Andet', features: ['test'] },
];

interface ApiUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  server_tool_use?: { web_search_requests?: number | null } | null;
}

/** Hvad ét svar kostede i dollar. */
export function costUsd(model: string, u: ApiUsage): number {
  const p = PRICES.find((x) => x.match.test(model)) ?? PRICES[1];
  const write = u.cache_creation_input_tokens ?? 0;
  const read = u.cache_read_input_tokens ?? 0;
  return (
    (u.input_tokens * p.input + write * p.input * 1.25 + read * p.cacheRead + u.output_tokens * p.output) / 1e6 +
    (u.server_tool_use?.web_search_requests ?? 0) * PER_SEARCH
  );
}

export const kr = (usd: number) => usd * DKK_PER_USD;

/** "41 kr", "0,85 kr" */
export function krText(usd: number): string {
  const v = kr(usd);
  return `${v.toLocaleString('da-DK', { maximumFractionDigits: v < 10 ? 2 : 0, minimumFractionDigits: v < 10 && v > 0 ? 2 : 0 })} kr`;
}

/** Kort modelnavn, fx "Opus". */
export function modelName(model: string): string {
  const m = /(opus|sonnet|haiku|fable|mythos)/.exec(model);
  return m ? m[1][0].toUpperCase() + m[1].slice(1) : model;
}

export interface Spend {
  feature: Feature;
  model: string;
  usd: number;
}

type Listener = (s: Spend) => void;
const listeners = new Set<Listener>();

/** Kaldes efter hvert svar fra Claude. */
export function track(feature: Feature, res: { model: string; usage: ApiUsage }): number {
  const usd = costUsd(res.model, res.usage);
  listeners.forEach((l) => l({ feature, model: res.model, usd }));
  return usd;
}

export function onSpend(l: Listener): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Lægger et svar til månedens opgørelse. */
export function addSpend(month: Usage | undefined, s: Spend, day = today()): Usage {
  const m: Usage = month ?? { id: monthId(day), days: {}, features: {}, models: {}, count: 0 };
  const add = (r: Record<string, number>, k: string) => ({ ...r, [k]: (r[k] ?? 0) + s.usd });
  return { ...m, days: add(m.days, day), features: add(m.features, s.feature), models: add(m.models, modelName(s.model)), count: m.count + 1 };
}

export function monthTotal(m: Usage | undefined): number {
  return m ? Object.values(m.days).reduce((a, b) => a + b, 0) : 0;
}

/** "oktober" for "2026-10". */
export const monthName = (id: string) => MONTHS[Number(id.slice(5, 7)) - 1];

/** Er månedens grænse passeret? Giver en kort tekst, eller ''. */
export function overLimitText(usage: Record<string, Usage>, limitKr: number): string {
  if (!limitKr) return '';
  const id = monthId(today());
  const used = kr(monthTotal(usage[id]));
  return used > limitKr ? `Du har brugt ca. ${Math.round(used)} kr på Claude i ${monthName(id)}. Din grænse er ${limitKr} kr.` : '';
}

