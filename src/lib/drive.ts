// Google Drev: dagbogens låste kopier i mappen "Dagbog-kopi".
// Med drive.file kan dagbogen kun se de filer, den selv har lavet.
import { GoogleError } from './google';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER = 'Dagbog-kopi';
const FOLDER_TYPE = 'application/vnd.google-apps.folder';
/** Så mange kopier gemmes (én pr. dag). */
export const KEEP = 14;

export interface DriveFile {
  id: string;
  name: string;
  modifiedTime: string;
  size?: string;
}

async function call(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers } });
  } catch {
    throw new GoogleError('Ingen forbindelse til Google.');
  }
  if (res.status === 401) throw new GoogleError('Google-login er udløbet.');
  if (res.status === 403) throw new GoogleError('Google Drev svarede "ingen adgang". Er Google Drive API slået til?');
  if (!res.ok) throw new GoogleError(`Google Drev svarede med fejl ${res.status}.`);
  return res;
}

async function list(token: string, q: string, pageSize = 100): Promise<DriveFile[]> {
  const params = new URLSearchParams({ q, orderBy: 'modifiedTime desc', pageSize: String(pageSize), fields: 'files(id,name,modifiedTime,size)', spaces: 'drive' });
  const r = await call(token, `${API}/files?${params}`);
  return ((await r.json()) as { files?: DriveFile[] }).files ?? [];
}

/** Finder mappen (eller laver den). */
export async function ensureFolder(token: string, known: string): Promise<string> {
  if (known) {
    const f = await call(token, `${API}/files/${known}?fields=id,trashed`).then((r) => r.json() as Promise<{ trashed?: boolean }>, () => null);
    if (f && !f.trashed) return known;
  }
  const [f] = await list(token, `name = '${FOLDER}' and mimeType = '${FOLDER_TYPE}' and trashed = false`, 1);
  if (f) return f.id;
  const r = await call(token, `${API}/files?fields=id`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: FOLDER, mimeType: FOLDER_TYPE }),
  });
  return ((await r.json()) as { id: string }).id;
}

/** Lægger filen op. Findes en fil med samme navn i mappen, erstattes den. */
async function upload(token: string, folderId: string, name: string, body: string): Promise<void> {
  const [old] = await list(token, `'${folderId}' in parents and name = '${name}' and trashed = false`, 1);
  const meta = old ? { name } : { name, parents: [folderId], mimeType: 'application/json' };
  const url = old ? `${UPLOAD}/files/${old.id}` : `${UPLOAD}/files`;
  const method = old ? 'PATCH' : 'POST';
  // Genoptagelig upload: virker også for store kopier med mange fotos
  const start = await call(token, `${url}?uploadType=resumable`, {
    method,
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  });
  const session = start.headers.get('Location');
  if (session) {
    await call(token, session, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body });
    return;
  }
  // Kan browseren ikke se adressen til upload, sendes det hele i ét stykke
  const b = `dagbog${crypto.randomUUID().replace(/-/g, '')}`;
  await call(token, `${url}?uploadType=multipart`, {
    method,
    headers: { 'Content-Type': `multipart/related; boundary=${b}` },
    body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/json\r\n\r\n${body}\r\n--${b}--`,
  });
}

/** Sletter de ældste kopier, så der højst er KEEP. */
async function prune(token: string, folderId: string): Promise<void> {
  const files = (await list(token, `'${folderId}' in parents and trashed = false`)).filter((f) => f.name.startsWith('dagbog-kopi-'));
  for (const f of files.slice(KEEP)) await call(token, `${API}/files/${f.id}`, { method: 'DELETE' });
}

export async function saveToDrive(token: string, folderId: string, name: string, body: string): Promise<string> {
  const folder = await ensureFolder(token, folderId);
  await upload(token, folder, name, body);
  await prune(token, folder).catch(() => undefined);
  return folder;
}

/** De kopier, dagbogen kan se på Drev, nyeste først. */
export async function listBackups(token: string): Promise<DriveFile[]> {
  return (await list(token, `name contains 'dagbog-kopi-' and trashed = false`, 30)).filter((f) => f.name.endsWith('.json'));
}

export async function downloadBackup(token: string, id: string): Promise<string> {
  return (await call(token, `${API}/files/${id}?alt=media`)).text();
}
