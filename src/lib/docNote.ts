// Et Word-dokument (.docx) eller en tekstfil bliver til en note.
// .docx er en zip-fil med teksten i word/document.xml; den pakkes ud på telefonen med fflate.
import { strFromU8, unzipSync } from 'fflate';
import type { Note } from './types';

export const DOC_ACCEPT = '.docx,.txt,.md,text/plain,text/markdown,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';

/** Teksten i word/document.xml: et afsnit pr. linje, punkter med "• ". */
export function docxXmlToText(xml: string): string {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const out: string[] = [];
  for (const p of Array.from(doc.getElementsByTagNameNS(W, 'p'))) {
    // Afsnit inde i tekstbokse tages med af det ydre afsnit; spring dem over her
    let parent = p.parentElement;
    let nested = false;
    while (parent) {
      if (parent.namespaceURI === W && parent.localName === 'p') { nested = true; break; }
      parent = parent.parentElement;
    }
    if (nested) continue;
    let line = '';
    const walk = (el: Element) => {
      for (const c of Array.from(el.children)) {
        if (c.namespaceURI !== W) { walk(c); continue; }
        if (c.localName === 't') line += c.textContent ?? '';
        else if (c.localName === 'tab') line += '\t';
        else if (c.localName === 'br' || c.localName === 'cr') line += '\n';
        else if (c.localName === 'pPr' || c.localName === 'rPr' || c.localName === 'p') continue;
        else walk(c);
      }
    };
    walk(p);
    const style = p.getElementsByTagNameNS(W, 'pStyle')[0]?.getAttributeNS(W, 'val') ?? '';
    const list = p.getElementsByTagNameNS(W, 'numPr').length > 0 || /list|liste|bullet|punkt/i.test(style);
    out.push(list && line.trim() ? `• ${line}` : line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

const baseName = (name: string) => name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();

/** Læs et dokument og lav en note. Kaster en fejl med en dansk besked, hvis det ikke kan læses. */
export async function noteFromFile(file: Blob, name: string): Promise<Note> {
  const lower = name.toLowerCase();
  let title = baseName(name) || 'Dokument';
  let text: string;
  if (lower.endsWith('.docx') || file.type.includes('wordprocessingml')) {
    let files: Record<string, Uint8Array>;
    try {
      files = unzipSync(new Uint8Array(await file.arrayBuffer()), {
        filter: (f) => f.name === 'word/document.xml' || f.name === 'docProps/core.xml',
      });
    } catch {
      throw new Error('Dokumentet kunne ikke åbnes.');
    }
    if (!files['word/document.xml']) throw new Error('Dokumentet kunne ikke åbnes.');
    text = docxXmlToText(strFromU8(files['word/document.xml']));
    const core = files['docProps/core.xml'];
    if (core) {
      const t = /<dc:title>([^<]*)<\/dc:title>/.exec(strFromU8(core))?.[1]?.trim();
      if (t) title = new DOMParser().parseFromString(`<x>${t}</x>`, 'application/xml').documentElement.textContent || title;
    }
  } else if (lower.endsWith('.doc')) {
    throw new Error('Gamle Word-filer (.doc) kan ikke læses. Gem den som .docx i Word eller Google Docs.');
  } else if (file.type.startsWith('text/') || /\.(txt|md)$/.test(lower)) {
    text = (await file.text()).replace(/\r\n?/g, '\n').trim();
  } else {
    throw new Error('Kun Word (.docx) og tekstfiler kan blive til en note.');
  }
  if (!text) throw new Error('Der er ingen tekst i dokumentet.');
  const now = Date.now();
  return { id: crypto.randomUUID(), title, icon: '📄', text, createdAt: now, updatedAt: now };
}
