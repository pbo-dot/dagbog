import { formatFull, formatMonth } from './dates';
import type { Data } from './store';
import { moodLabel, type Entry, type Photo } from './types';

export function entriesInRange(data: Data, from: string, to: string): Entry[] {
  return Object.values(data.entries)
    .filter((e) => e.date >= from && e.date <= to)
    .sort((a, b) => a.date.localeCompare(b.date));
}

function entryText(e: Entry): string {
  const meta = [e.mood ? `Humør: ${moodLabel(e.mood)}` : '', e.tags.length ? `Tags: ${e.tags.join(', ')}` : '']
    .filter(Boolean)
    .join(' · ');
  const good = e.good.filter(Boolean);
  return [
    formatFull(e.date),
    meta,
    '',
    e.text,
    good.length ? `\nTre gode ting:\n${good.map((g) => `– ${g}`).join('\n')}` : '',
  ]
    .filter((l, i) => l !== '' || i === 2)
    .join('\n');
}

export function toText(data: Data, from: string, to: string): string {
  const entries = entriesInRange(data, from, to);
  const parts: string[] = [`DAGBOG ${from} – ${to}`, ''];
  let month = '';
  for (const e of entries) {
    const m = e.date.slice(0, 7);
    if (m !== month) {
      month = m;
      parts.push('', `==== ${formatMonth(m).toUpperCase()} ====`);
      const ch = data.months[m];
      if (ch?.text) parts.push('', `Månedens kapitel: ${ch.title}`, ch.text);
      parts.push('');
    }
    parts.push(entryText(e), '', '—', '');
  }
  return parts.join('\n');
}

export function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Validerer og normaliserer en importeret sikkerhedskopi. */
export function parseBackup(json: string): { data: Partial<Data>; photos: Record<string, Photo>; merge: boolean } {
  const d = JSON.parse(json);
  if (d?.app !== 'dagbog') throw new Error('Filen er ikke en sikkerhedskopi fra Dagbog.');
  const out: Partial<Data> = {};
  for (const k of ['entries', 'weeks', 'months', 'people', 'patterns', 'conversations', 'routines', 'appointments', 'google', 'notes', 'todos'] as const) {
    if (d[k] && typeof d[k] === 'object') (out as Record<string, unknown>)[k] = d[k];
  }
  if (d.settings) out.settings = d.settings;
  if (d.meta) out.meta = d.meta;
  const photos: Record<string, Photo> = {};
  for (const [id, p] of Object.entries((d.photos ?? {}) as Record<string, Photo>)) {
    if (p && typeof p.data === 'string' && p.id === id) photos[id] = p;
  }
  // Import af gamle noter: lægges oven i det, der er (tilfoej: true)
  return { data: out, photos, merge: d.tilfoej === true };
}
