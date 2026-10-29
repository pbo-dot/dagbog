// Fotos: formindskes ved indlæsning og vises via en lille cache af object-URL'er.
import { useEffect, useState } from 'react';
import type { Photo } from './types';

const MAX_SIDE = 1600;
const QUALITY = 0.82;

export async function compressImage(file: Blob): Promise<Pick<Photo, 'mime' | 'data' | 'width' | 'height'>> {
  // imageOrientation sørger for at telefonbilleder vender rigtigt (EXIF)
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Kunne ikke behandle billedet');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', QUALITY));
  if (!blob) throw new Error('Kunne ikke behandle billedet');
  const buf = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return { mime: 'image/jpeg', data: btoa(s), width, height };
}

function toBlob(p: Photo): Blob {
  const bin = atob(p.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: p.mime });
}

const cache = new Map<string, string>();

export function cachePhoto(p: Photo): string {
  let url = cache.get(p.id);
  if (!url) {
    url = URL.createObjectURL(toBlob(p));
    cache.set(p.id, url);
  }
  return url;
}

export function forgetPhoto(id: string) {
  const url = cache.get(id);
  if (url) URL.revokeObjectURL(url);
  cache.delete(id);
}

/** Kaldes ved låsning, så dekrypterede billeder ikke bliver liggende i hukommelsen. */
export function clearPhotoCache() {
  for (const url of cache.values()) URL.revokeObjectURL(url);
  cache.clear();
}

export function usePhotoUrl(id: string, getPhoto: (id: string) => Promise<Photo | undefined>): string | null {
  const [url, setUrl] = useState<string | null>(() => cache.get(id) ?? null);
  useEffect(() => {
    let alive = true;
    if (cache.has(id)) setUrl(cache.get(id)!);
    else getPhoto(id).then((p) => alive && p && setUrl(cachePhoto(p))).catch(() => {});
    return () => {
      alive = false;
    };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}
