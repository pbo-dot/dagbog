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

export function toJSON(data: Data, photos: Record<string, Photo>): string {
  const { settings, ...rest } = data;
  // API-nøglen udelades af sikkerhedskopien
  return JSON.stringify({
    app: 'dagbog',
    version: 2,
    exportedAt: new Date().toISOString(),
    ...rest,
    photos,
    settings: { ...settings, ai: { ...settings.ai, apiKey: '' } },
  });
}

export async function toPDF(data: Data, from: string, to: string): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210, M = 20, maxW = W - 2 * M, bottom = 297 - M;
  let y = M;

  const write = (text: string, size: number, style: 'normal' | 'bold' | 'italic' = 'normal', gap = 1.5) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    const lh = size * 0.42;
    for (const line of doc.splitTextToSize(text, maxW) as string[]) {
      if (y + lh > bottom) {
        doc.addPage();
        y = M;
      }
      doc.text(line, M, y);
      y += lh;
    }
    y += gap;
  };

  write('Dagbog', 22, 'bold', 2);
  write(`${from} – ${to}`, 11, 'normal', 8);

  let month = '';
  for (const e of entriesInRange(data, from, to)) {
    const m = e.date.slice(0, 7);
    if (m !== month) {
      month = m;
      y += 4;
      write(formatMonth(m), 16, 'bold', 3);
      const ch = data.months[m];
      if (ch?.text) {
        write(ch.title, 11, 'italic', 1);
        write(ch.text, 10, 'italic', 5);
      }
    }
    write(formatFull(e.date), 12, 'bold', 1);
    const meta = [e.mood ? moodLabel(e.mood) : '', e.tags.join(', ')].filter(Boolean).join(' · ');
    if (meta) write(meta, 9, 'italic', 1.5);
    for (const para of e.text.split(/\n+/)) write(para, 10.5, 'normal', 1.5);
    const good = e.good.filter(Boolean);
    if (good.length) write(`Gode ting: ${good.join(' · ')}`, 9.5, 'italic', 1);
    y += 5;
  }
  return doc.output('blob');
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
export function parseBackup(json: string): { data: Partial<Data>; photos: Record<string, Photo> } {
  const d = JSON.parse(json);
  if (d?.app !== 'dagbog') throw new Error('Filen er ikke en sikkerhedskopi fra Dagbog.');
  const out: Partial<Data> = {};
  for (const k of ['entries', 'weeks', 'months', 'people', 'patterns'] as const) {
    if (d[k] && typeof d[k] === 'object') (out as Record<string, unknown>)[k] = d[k];
  }
  if (d.settings) out.settings = d.settings;
  if (d.meta) out.meta = d.meta;
  const photos: Record<string, Photo> = {};
  for (const [id, p] of Object.entries((d.photos ?? {}) as Record<string, Photo>)) {
    if (p && typeof p.data === 'string' && p.id === id) photos[id] = p;
  }
  return { data: out, photos };
}
