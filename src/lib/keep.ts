// Google Keep via Takeout: zip-filen pakkes ud på telefonen (fflate), og hver
// note bliver til en note i Dagbog med etiketter, links og billeder.
// Google tillader ikke andre apps at læse Keep direkte for almindelige konti.
import { unzip, type Unzipped } from 'fflate';
import type { Note } from './types';

/** En note, som den står i Takeout (Keep/*.json). */
interface KeepJson {
  title?: string;
  textContent?: string;
  listContent?: Array<{ text?: string; isChecked?: boolean }>;
  labels?: Array<{ name?: string }>;
  annotations?: Array<{ url?: string; title?: string }>;
  attachments?: Array<{ filePath?: string; mimetype?: string }>;
  isTrashed?: boolean;
  isArchived?: boolean;
  isPinned?: boolean;
  createdTimestampUsec?: number;
  userEditedTimestampUsec?: number;
}

export interface KeepNote {
  id: string;
  title: string;
  text: string;
  labels: string[];
  links: Array<{ url: string; title: string }>;
  images: string[]; // stier i zip-filen
  archived: boolean;
  pinned: boolean;
  created: number; // ms
  edited: number; // ms
}

export interface KeepScan {
  notes: KeepNote[];
  imageBytes: number; // samlet størrelse af billederne (før formindskning)
}

const isImage = (name: string) => /\.(jpe?g|png|gif|webp|heic)$/i.test(name);
const base = (path: string) => path.split('/').pop()!.replace(/\.[^.]+$/, '').toLowerCase();

const unzipAsync = (data: Uint8Array, filter: (f: { name: string; originalSize: number }) => boolean) =>
  new Promise<Unzipped>((resolve, reject) => unzip(data, { filter }, (err, out) => (err ? reject(err) : resolve(out))));

/** Gør én Takeout-note til en KeepNote. Giver null for noter i papirkurven og tomme noter. */
export function parseKeepNote(fileName: string, raw: KeepJson, images: Map<string, string>): KeepNote | null {
  if (raw.isTrashed) return null;
  const list = (raw.listContent ?? []).filter((i) => i.text?.trim()).map((i) => `- [${i.isChecked ? 'x' : ' '}] ${i.text!.trim()}`);
  const text = [raw.textContent?.trim() ?? '', list.join('\n')].filter(Boolean).join('\n\n');
  const links = (raw.annotations ?? []).filter((a) => a.url).map((a) => ({ url: a.url!, title: a.title?.trim() || a.url! }));
  const imgs = (raw.attachments ?? [])
    .filter((a) => a.filePath && (a.mimetype ?? '').startsWith('image/'))
    // Takeout skriver nogle gange en anden filendelse end den, filen har
    .map((a) => images.get(base(a.filePath!)))
    .filter((x): x is string => !!x);
  if (!text && !links.length && !imgs.length && !raw.title?.trim()) return null;
  const firstLine = text.split('\n').find((l) => l.trim())?.replace(/^- \[.\] /, '').trim() ?? '';
  const title = raw.title?.trim() || (firstLine.length > 50 ? `${firstLine.slice(0, 48)}…` : firstLine) || links[0]?.title || 'Billede fra Keep';
  const created = Math.round((raw.createdTimestampUsec ?? 0) / 1000);
  const edited = Math.round((raw.userEditedTimestampUsec ?? raw.createdTimestampUsec ?? 0) / 1000);
  return {
    id: raw.createdTimestampUsec ? String(raw.createdTimestampUsec) : base(fileName),
    title,
    text,
    labels: [...new Set((raw.labels ?? []).map((l) => l.name?.trim()).filter((x): x is string => !!x))],
    links,
    images: imgs,
    archived: !!raw.isArchived,
    pinned: !!raw.isPinned,
    created: created || Date.now(),
    edited: edited || created || Date.now(),
  };
}

/** Læser noterne i zip-filen (uden billederne, de hentes først ved indlæsning). */
export async function scanKeep(zip: Uint8Array): Promise<KeepScan> {
  const images = new Map<string, string>();
  let imageBytes = 0;
  const files = await unzipAsync(zip, (f) => {
    if (!/(^|\/)Keep\//.test(f.name)) return false;
    if (isImage(f.name)) {
      images.set(base(f.name), f.name);
      imageBytes += f.originalSize;
      return false;
    }
    return f.name.endsWith('.json');
  });
  const decoder = new TextDecoder();
  const notes: KeepNote[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    try {
      const n = parseKeepNote(name, JSON.parse(decoder.decode(bytes)) as KeepJson, images);
      if (n) notes.push(n);
    } catch {
      // ikke en note (fx Labels.txt eller en ødelagt fil)
    }
  }
  if (!notes.length && !Object.keys(files).length) throw new Error('Der er ingen Keep-noter i filen. Er det den rigtige zip-fil fra Google Takeout?');
  return { notes: notes.sort((a, b) => b.edited - a.edited), imageBytes };
}

/** Henter de valgte billeder ud af zip-filen. */
export async function extractImages(zip: Uint8Array, paths: Set<string>): Promise<Unzipped> {
  return unzipAsync(zip, (f) => paths.has(f.name));
}

/** Etiketter med antal noter, flest først. "" = noter uden etiket. */
export function labelCounts(notes: KeepNote[]): Array<{ label: string; count: number }> {
  const m = new Map<string, number>();
  for (const n of notes) for (const l of n.labels.length ? n.labels : ['']) m.set(l, (m.get(l) ?? 0) + 1);
  return [...m].map(([label, count]) => ({ label, count })).sort((a, b) => (a.label === '' ? 1 : b.label === '' ? -1 : b.count - a.count || a.label.localeCompare(b.label, 'da')));
}

/** Kommer noten med, når disse etiketter er valgt? */
export function chosen(n: KeepNote, labels: Set<string>, archived: boolean): boolean {
  if (n.archived && !archived) return false;
  return n.labels.length ? n.labels.some((l) => labels.has(l)) : labels.has('');
}

/** Ny eller opdateret note i Dagbog. Giver null, hvis den allerede er indlæst og ikke rettet siden. */
export function toNote(k: KeepNote, existing: Note | undefined, photos: string[], id: string): Note | null {
  if (existing?.keep && existing.keep.edited >= k.edited) return null;
  return {
    ...(existing ?? { icon: k.pinned ? '📌' : '🗒️', createdAt: k.created }),
    id,
    title: k.title,
    text: k.text,
    labels: [...new Set([...(existing?.labels ?? []), ...k.labels])],
    links: k.links.length ? k.links : undefined,
    photos: photos.length ? photos : existing?.photos,
    keep: { id: k.id, edited: k.edited },
    updatedAt: k.edited,
  };
}
