export type MoodId = 'traet' | 'rolig' | 'glad' | 'presset' | 'tom';

export const MOODS: { id: MoodId; label: string }[] = [
  { id: 'traet', label: 'Træt' },
  { id: 'rolig', label: 'Rolig' },
  { id: 'glad', label: 'Glad' },
  { id: 'presset', label: 'Presset' },
  { id: 'tom', label: 'Tom' },
];

export function moodLabel(id?: MoodId | null): string {
  return MOODS.find((m) => m.id === id)?.label ?? '';
}

export interface Entry {
  date: string; // YYYY-MM-DD
  text: string;
  mood?: MoodId | null;
  tags: string[];
  good: string[]; // op til tre gode ting
  question?: string;
  photos?: string[]; // id'er på krypterede fotos (hentes ved behov)
  createdAt: number;
  updatedAt: number;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface WeekSummary {
  id: string; // YYYY-Www
  threeWords: string[];
  takeaway: string;
  summary: string;
  themes: string[];
  feelings: string[];
  patterns: string[];
  reflection: string;
  nextWeekQuestion: string;
  crisis: boolean;
  generatedAt: number;
  byAI: boolean;
  seen: boolean;
  deeper?: ChatTurn[];
  intention?: string; // "Skriv til ugen" – gælder ugen efter
}

export interface MonthChapter {
  id: string; // YYYY-MM
  title: string;
  text: string;
  themes: string[];
  generatedAt: number;
  edited: boolean;
  seen: boolean;
}

export interface PersonNote {
  id: string;
  date: string;
  text: string;
}

export interface Person {
  id: string;
  name: string;
  important: string; // hvad er vigtigt for dem lige nu
  notes: PersonNote[];
  updatedAt: number;
}

/** En aftale med tidspunkt fra en samtale, som kan lægges i kalenderen. */
export interface CalendarEvent {
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM, eller tom for hele dagen
  durationMinutes: number;
  place: string;
}

/** En samtale, fx tekst fra Pixel Optager, med Claudes resumé. */
export interface Conversation {
  id: string;
  date: string; // YYYY-MM-DD
  title: string;
  summary: string;
  agreements: string[]; // aftaler
  remember: string[]; // ting at huske eller gøre
  people: string[]; // id'er på personer under Mennesker
  events?: CalendarEvent[]; // aftaler med dato, der kan lægges i kalenderen
  transcript: string; // den indsatte tekst
  byAI: boolean;
  createdAt: number;
}

export interface Pattern {
  id: string;
  text: string;
  createdAt: number;
  occurrences: string[]; // datoer hvor det "skete igen"
  source: 'manual' | 'ai';
}

export interface Settings {
  tags: string[];
  ai: {
    enabled: boolean;
    apiKey: string;
    analysisModel: string;
    searchModel: string;
  };
  reminder: {
    enabled: boolean;
    time: string; // HH:MM
    text: string;
  };
  summaryWeekday: number; // 0 = søndag
  autoLockMinutes: number; // 0 = straks
}

export const DEFAULT_SETTINGS: Settings = {
  tags: ['arbejde', 'familie', 'parforhold', 'krop', 'AI', 'penge'],
  ai: {
    enabled: true,
    apiKey: '',
    analysisModel: 'claude-opus-5-5',
    searchModel: 'claude-haiku-5-5',
  },
  reminder: { enabled: true, time: '21:00', text: 'Hvad fyldte i dag?' },
  summaryWeekday: 0,
  autoLockMinutes: 5,
};

export interface Draft {
  date: string;
  text: string;
  mood?: MoodId | null;
  tags: string[];
  good: string[];
  photos?: string[];
}

export const MAX_PHOTOS = 3;

export interface Photo {
  id: string;
  date: string;
  mime: string;
  data: string; // base64
  width: number;
  height: number;
  createdAt: number;
}

export interface Meta {
  skipped: string[]; // datoer sprunget over
}
