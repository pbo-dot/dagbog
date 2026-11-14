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

/** Runder koordinater af (ca. 10 km) og forkorter lange tekster, så rapporten ikke røber præcise steder. */
function blur(v: unknown): string {
  const t = String(v).replace(/(-?\d+\.\d)\d+/g, '$1');
  return t.length > 48 ? `${t.slice(0, 48)}…` : t;
}

/** Opbygningen af et stykke JSON: nøgler, typer og et eksempel på hver værdi (højst 4 lag). */
function shape(v: unknown, depth = 0, pad = '  '): string[] {
  if (Array.isArray(v)) return [`${pad}[liste med ${v.length}]`, ...(v.length && depth < 4 ? shape(v[0], depth + 1, `${pad}  `) : [])];
  if (v && typeof v === 'object') {
    if (depth >= 4) return [`${pad}{…}`];
    return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) =>
      x && typeof x === 'object' ? [`${pad}${k}:`, ...shape(x, depth + 1, `${pad}  `)] : [`${pad}${k}: ${/placeId|Id$/.test(k) ? '(skjult)' : blur(x)}`]);
  }
  return [`${pad}${blur(v)}`];
}

/** Læser Google Maps-tidslinjen på telefonen og beskriver, hvad filen indeholder. Intet sendes. */
async function timelineReport(file: File): Promise<string> {
  const lines = ['== Tidslinje ==', `${file.name} · ${(file.size / 1_048_576).toFixed(1)} MB`];
  const t0 = performance.now();
  const data = JSON.parse(await file.text()) as Record<string, unknown>;
  lines.push(`Læst på ${Math.round(performance.now() - t0)} ms`);
  for (const [k, v] of Object.entries(Array.isArray(data) ? { '(listen selv)': data } : data)) {
    lines.push(`${k}: ${Array.isArray(v) ? `liste med ${v.length}` : typeof v}`);
  }
  const segs = (Array.isArray(data) ? data : (data.semanticSegments ?? data.timelineObjects ?? [])) as Array<Record<string, unknown>>;
  if (Array.isArray(segs) && segs.length) {
    const kinds: Record<string, number> = {};
    const years: Record<string, number> = {};
    const firstOf: Record<string, Record<string, unknown>> = {};
    for (const s of segs) {
      const kind = Object.keys(s).filter((k) => !/^(start|end)Time/.test(k)).join('+') || '(kun tid)';
      kinds[kind] = (kinds[kind] ?? 0) + 1;
      firstOf[kind] ??= s;
      const y = String(s.startTime ?? s.endTime ?? '').slice(0, 4);
      if (y) years[y] = (years[y] ?? 0) + 1;
    }
    lines.push(`Slags: ${Object.entries(kinds).map(([k, n]) => `${k} ${n}`).join(' · ')}`);
    lines.push(`Pr. år: ${Object.entries(years).sort().map(([y, n]) => `${y}: ${n}`).join(' · ')}`);
    for (const [kind, s] of Object.entries(firstOf).slice(0, 5)) lines.push(`-- eksempel: ${kind} --`, ...shape(s));
    const last = segs[segs.length - 1];
    lines.push(`Første: ${blur(segs[0].startTime)} · sidste: ${blur(last.endTime ?? last.startTime)}`);
  } else {
    lines.push('Ukendt opbygning. Sådan ser begyndelsen ud:', ...shape(data).slice(0, 60));
  }
  return lines.join('\n');
}

export function PhotoTestScreen() {
  const [out, setOut] = useState<string[]>([]);
  const [busy, setBusy] = useState('');
  const [copied, setCopied] = useState(false);
  const dirInput = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const timeInput = useRef<HTMLInputElement>(null);
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
        <button className="btn primary block" disabled={!!busy} onClick={() => timeInput.current?.click()}>5. Vælg Tidslinje.json</button>
      </div>
      {/* @ts-expect-error webkitdirectory er ikke med i Reacts typer */}
      <input ref={dirInput} type="file" webkitdirectory="" multiple hidden onChange={fromInput('2. Vælg en mappe')} />
      <input ref={fileInput} type="file" multiple hidden onChange={fromInput('3. Filer')} />
      <input ref={photoInput} type="file" accept="image/*" multiple hidden onChange={fromInput('4. Billedvælgeren')} />
      <input ref={timeInput} type="file" hidden onChange={async (e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (!f) return;
        setBusy('Tidslinje');
        let text: string;
        try { text = await timelineReport(f); } catch (err) { text = `== Tidslinje ==\nFEJL: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`; }
        setOut((o) => [...o, text]);
        setBusy('');
      }} />
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
