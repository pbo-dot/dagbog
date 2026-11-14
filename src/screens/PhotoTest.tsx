// Prøve: kan Dagbog læse dato og sted fra billederne på telefonen? Fire måder prøves, og resultatet
// samles i en tekst, der kan deles med Claude. Intet gemmes, og ingen billeder sendes nogen steder.
import { useRef, useState } from 'react';
import { go, Header } from '../ui';

interface Picked {
  name: string;
  file: () => Promise<File>;
}

const IMAGE = /\.(jpe?g|heic|heif)$/i;
const SAMPLE = 30;
const SHOWN = 5;

type DirHandle = { name: string; values: () => AsyncIterable<{ kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File> }> };
type PickerWindow = Window & { showDirectoryPicker?: (o?: { mode?: string; startIn?: string }) => Promise<DirHandle> };

/** Alle billeder i mappen og dens undermapper (højst 3 lag, højst 30.000 filer). */
async function walk(dir: DirHandle, depth: number, out: Picked[]): Promise<void> {
  for await (const e of dir.values()) {
    if (out.length >= 30_000) return;
    if (e.kind === 'file' && IMAGE.test(e.name) && e.getFile) out.push({ name: e.name, file: e.getFile.bind(e) });
    else if (e.kind === 'directory' && depth < 3) await walk(e as unknown as DirHandle, depth + 1, out);
  }
}

/** Jævnt fordelt udvalg, så både gamle og nye billeder kommer med. */
function spread<T>(all: T[], n: number): T[] {
  if (all.length <= n) return all;
  return Array.from({ length: n }, (_, i) => all[Math.floor((i * (all.length - 1)) / (n - 1))]);
}

/** Læser dato og sted fra et udvalg af billederne og laver en kort rapport. */
async function report(method: string, items: Picked[], listMs: number): Promise<string> {
  const lines = [`== ${method} ==`, `Billeder fundet: ${items.length} (fundet på ${Math.round(listMs)} ms)`];
  if (!items.length) return lines.join('\n');
  const { default: exifr } = await import('exifr');
  const sorted = [...items].sort((a, b) => a.name.localeCompare(b.name));
  const sample = spread(sorted, SAMPLE);
  let dates = 0;
  let places = 0;
  let blanked = 0; // stedet står i filen, men er nulstillet (fjernet af Android)
  const shown: string[] = [];
  const t0 = performance.now();
  for (const [i, it] of sample.entries()) {
    let text: string;
    try {
      const f = await it.file();
      const x = (await exifr.parse(f, { gps: true, pick: ['DateTimeOriginal', 'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'] })) as { DateTimeOriginal?: Date; latitude?: number; longitude?: number } | undefined;
      const date = x?.DateTimeOriginal instanceof Date ? x.DateTimeOriginal.toISOString().slice(0, 16).replace('T', ' ') : '';
      // Android fjerner stedet ved at nulstille tallene: så findes feltet, men er ikke et tal
      const hasGps = x?.latitude !== undefined || x?.longitude !== undefined;
      const place = Number.isFinite(x?.latitude) && Number.isFinite(x?.longitude) ? `${x!.latitude!.toFixed(1)}, ${x!.longitude!.toFixed(1)}` : '';
      if (hasGps && !place) blanked++;
      if (date) dates++;
      if (place) places++;
      text = `${it.name} · ${Math.round(f.size / 1024)} kB · fil-dato ${new Date(f.lastModified).toISOString().slice(0, 10)} · taget ${date || 'MANGLER'} · sted ${place || 'MANGLER'}`;
    } catch (e) {
      text = `${it.name} · FEJL: ${e instanceof Error ? e.message : String(e)}`;
    }
    if (shown.length < SHOWN && i % Math.max(1, Math.floor(sample.length / SHOWN)) === 0) shown.push(text);
  }
  lines.push(`Undersøgt: ${sample.length} på ${Math.round(performance.now() - t0)} ms · med dato: ${dates} · med sted: ${places} · sted fjernet af Android: ${blanked}`);
  lines.push(`Ældste navn: ${sorted[0].name} · nyeste navn: ${sorted[sorted.length - 1].name}`);
  return [...lines, ...shown].join('\n');
}

export function PhotoTestScreen() {
  const [out, setOut] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const w = window as PickerWindow;
  const head = `Dagbog billedtest · ${new Date().toISOString().slice(0, 16)}\n${navigator.userAgent}\nMappe-adgang (showDirectoryPicker): ${w.showDirectoryPicker ? 'findes' : 'findes IKKE'} · mappe-upload (webkitdirectory): ${'webkitdirectory' in document.createElement('input') ? 'findes' : 'findes IKKE'}`;
  const all = [head, ...out].join('\n\n');

  const run = async (method: string, get: () => Promise<Picked[]>) => {
    setBusy(method);
    const t0 = performance.now();
    let text: string;
    try {
      const items = await get();
      text = await report(method, items, performance.now() - t0);
    } catch (e) {
      text = `== ${method} ==\nFEJL: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`;
    }
    setOut((o) => [...o, text]);
    setBusy('');
  };
  const fromInput = (method: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = [...(e.target.files ?? [])].filter((f) => IMAGE.test(f.name) || f.type.startsWith('image/'));
    e.target.value = '';
    void run(method, async () => files.map((f) => ({ name: f.name, file: async () => f })));
  };
  const folder = () => run('1. Mappe-adgang', async () => {
    const dir = await w.showDirectoryPicker!({ mode: 'read', startIn: 'pictures' });
    const items: Picked[] = [];
    await walk(dir, 0, items);
    return items;
  });

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Header back="mere" />
      <h1>Billedtest</h1>
      <p className="small">Prøv knapperne én ad gangen, og vælg mappen <strong>DCIM → Camera</strong> (eller nogle billeder derfra). Intet gemmes, og ingen billeder sendes.</p>
      <div className="stack-sm">
        <button className="btn primary block" disabled={!!busy || !w.showDirectoryPicker} onClick={folder}>1. Giv adgang til kamera-mappen{w.showDirectoryPicker ? '' : ' (findes ikke her)'}</button>
        <button className="btn block" disabled={!!busy} onClick={() => dirInput.current?.click()}>2. Vælg en mappe</button>
        <button className="btn block" disabled={!!busy} onClick={() => fileInput.current?.click()}>3. Vælg filer i Filer</button>
        <button className="btn block" disabled={!!busy} onClick={() => photoInput.current?.click()}>4. Vælg billeder i billedvælgeren</button>
      </div>
      {/* @ts-expect-error webkitdirectory er ikke med i Reacts typer */}
      <input ref={dirInput} type="file" webkitdirectory="" multiple hidden onChange={fromInput('2. Vælg en mappe')} />
      <input ref={fileInput} type="file" multiple hidden onChange={fromInput('3. Filer')} />
      <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={fromInput('4. Billedvælgeren')} />
      {busy && <p className="small muted">Arbejder: {busy} …</p>}
      <textarea className="grow" readOnly rows={14} value={all} aria-label="Resultat" style={{ fontSize: '.8rem', fontFamily: 'monospace' }} />
      <div className="row wrap">
        <button className="btn primary" onClick={async () => { try { await navigator.clipboard.writeText(all); setCopied(true); } catch { /* vælg teksten selv */ } }}>{copied ? '✓ Kopieret' : 'Kopiér resultatet'}</button>
        {'share' in navigator && <button className="btn" onClick={() => void navigator.share({ title: 'Dagbog billedtest', text: all }).catch(() => {})}>Del</button>}
        <button className="btn ghost" onClick={() => go('mere')}>Færdig</button>
      </div>
    </div>
  );
}
