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

export type PersonGroup = 'naermeste' | 'familie' | 'netvaerk';

export const PERSON_GROUPS: { id: PersonGroup; label: string }[] = [
  { id: 'naermeste', label: 'Nærmeste' },
  { id: 'familie', label: 'Familie' },
  { id: 'netvaerk', label: 'Netværk' },
];

export interface Person {
  id: string;
  name: string;
  important: string; // hvad er vigtigt for dem lige nu
  notes: PersonNote[];
  updatedAt: number;
  relation?: string; // fx "Datter", "Mor", "Ven"
  group?: PersonGroup;
  birthday?: string; // YYYY-MM-DD, eller --MM-DD når året ikke kendes
  family?: string; // fx "Gift med Kamma. Børn: Per og Dorte."
}

/** En fast oplysning uden dato, fx trading-regler eller en pakkeliste. */
export interface Note {
  id: string;
  title: string;
  icon: string; // emoji
  text: string; // linjer med "- [ ]" eller "- [x]" er afkrydsning
  createdAt: number;
  updatedAt: number;
}

/** En aftale, man selv har skrevet ind i dagbogens kalender. */
export interface Appointment {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM eller tom (hele dagen)
  place: string;
  createdAt: number;
}

/** Markering af, at en fast ting er taget/gjort. */
export interface RoutineLog {
  due: string; // den planlagte dag, markeringen gælder (YYYY-MM-DD)
  at: number; // hvornår der blev trykket "Taget"
  option?: string; // fx "højre ben"
}

/** En fast ting på en fast plan, fx en indsprøjtning hver 14. dag. */
export interface Routine {
  id: string;
  name: string;
  icon: string; // emoji
  everyDays: number; // 1 = hver dag, 7 = hver uge, 14 = hver 14. dag (bruges når monthly er false)
  monthly: boolean; // hver måned på samme dato som første gang
  start: string; // første gang (YYYY-MM-DD)
  options: string[]; // skift mellem, fx ["højre ben", "venstre ben"]
  log: RoutineLog[]; // nyeste først
  createdAt: number;
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

/** En aftale hentet fra Google Kalender (kun læsning). */
export interface GoogleEvent {
  id: string;
  cal: string; // kalenderens id
  title: string;
  date: string; // første dag (YYYY-MM-DD)
  end: string; // sidste dag (med), samme som date for aftaler på én dag
  time: string; // HH:MM, eller tom for hele dagen
  place: string;
}

/** Google-aftaler for én måned (nøgle YYYY-MM), efter startdato. */
export interface GoogleMonth {
  id: string;
  events: GoogleEvent[];
  syncedAt: number;
}

export interface GoogleCalendarInfo {
  id: string;
  name: string;
  color: string;
  on: boolean; // vises i dagbogen
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
  showQuestion: boolean; // dagens spørgsmål over skrivefeltet
  google: {
    clientId: string; // fra Google Cloud (ikke hemmeligt)
    email: string; // kontoen, der er forbundet ('' = ikke forbundet)
    calendars: GoogleCalendarInfo[];
    lastSync: number;
  };
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
  showQuestion: true,
  google: { clientId: '', email: '', calendars: [], lastSync: 0 },
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
