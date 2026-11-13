// Henter Google-aftaler ind i dagbogen og holder styr på, om det kører.
import { useEffect, useSyncExternalStore } from 'react';
import { today } from './dates';
import { deleteEvent, needsPush, pushAppointment, pushReminder, toReminderEvent } from './gcalWrite';
import { clientIdOf, currentToken, fetchGoogle, GoogleError, lastError, mergeCalendars, noteAuto, saveHint, signIn, STALE_MS, writeToken } from './google';
import { planReminders, REMIND_TIME } from './todoReminders';
import type { Appointment, TodoEvent } from './types';
import { useStore } from './store';

type Store = ReturnType<typeof useStore>;

interface State {
  busy: boolean;
  error: string;
}

let state: State = { busy: false, error: '' };
const listeners = new Set<() => void>();
const set = (s: Partial<State>) => {
  state = { ...state, ...s };
  listeners.forEach((l) => l());
};

export function useGoogleState(): State {
  return useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state);
}

/** Henter nu, hvis der er en gyldig nøgle. Ellers går den til Google først. */
export async function syncGoogle(store: Store, opts: { login?: boolean } = {}): Promise<void> {
  const g = store.data.settings.google;
  const clientId = clientIdOf(g);
  if (!clientId || state.busy) return;
  const token = currentToken();
  if (!token) {
    if (opts.login) signIn(clientId, { hint: g.email || undefined });
    return;
  }
  set({ busy: true, error: '' });
  try {
    const r = await fetchGoogle(token, today());
    const now = Date.now();
    const inWindow = new Set(r.window);
    for (const [id, events] of Object.entries(r.months)) {
      if (inWindow.has(id)) {
        await store.put('google', id, { id, events, syncedAt: now });
      } else {
        // Aftaler over flere dage, der startede før perioden: læg til, erstat ikke
        const old = store.data.google[id]?.events ?? [];
        const ids = new Set(events.map((e) => e.id));
        await store.put('google', id, { id, events: [...old.filter((e) => !ids.has(e.id)), ...events], syncedAt: now });
      }
    }
    for (const id of r.window) {
      if (!r.months[id] && store.data.google[id]) await store.remove('google', id);
    }
    const settings = store.data.settings;
    const email = r.email || settings.google.email;
    await store.saveSettings({ ...settings, google: { ...settings.google, email, calendars: mergeCalendars(settings.google.calendars, r.calendars), lastSync: now } });
    await saveHint(clientId, email);
    set({ busy: false });
  } catch (e) {
    set({ busy: false, error: e instanceof GoogleError ? e.message : 'Kunne ikke hente fra Google.' });
  }
}

/** Kalenderen, nye aftaler lægges i. */
export function pushCalendar(g: Store['data']['settings']['google']): string {
  return g.pushCal || g.email || 'primary';
}

let pushing = false;

/**
 * Sender aftaler til Google: dem, der er nye eller rettet, og sletninger, der venter.
 * `changed` er aftaler, der lige er gemt (endnu ikke i store.data), `removed` en aftale, der lige er
 * slettet i Dagbog eller ikke længere skal ligge i Google.
 */
export async function pushAppointments(store: Store, changed: Appointment[] = [], removed?: { cal: string; id: string; ref: string }): Promise<void> {
  const g = store.data.settings.google;
  const deletes = [...g.pendingDeletes, ...(removed ? [{ cal: removed.cal, id: removed.id }] : [])];
  const all = { ...store.data.appointments, ...Object.fromEntries(changed.map((a) => [a.id, a])) };
  if (removed && !changed.some((a) => a.id === removed.ref)) delete all[removed.ref];
  const todo = Object.values(all).filter(needsPush);
  if (!deletes.length && !todo.length) return;
  const token = writeToken();
  if (!token || pushing) {
    // Huskes til næste gang, der er forbindelse
    if (removed) await store.saveSettings({ ...store.data.settings, google: { ...g, pendingDeletes: deletes } });
    return;
  }
  pushing = true;
  let left = deletes;
  try {
    for (const d of deletes) {
      await deleteEvent(token, d.cal, d.id);
      left = left.filter((x) => x !== d);
    }
    for (const a of todo) {
      const where = await pushAppointment(token, a, pushCalendar(g));
      await store.put('appointments', a.id, { ...a, google: { ...where, at: Date.now() } });
    }
  } catch (e) {
    set({ error: e instanceof GoogleError ? e.message : 'Kunne ikke sende til Google.' });
  } finally {
    pushing = false;
    if (left.length !== g.pendingDeletes.length || removed) {
      await store.saveSettings({ ...store.data.settings, google: { ...store.data.settings.google, pendingDeletes: left } });
    }
  }
}

let reminding = false;
// Det, der sidst blev sendt i denne session. Kun denne funktion retter i listen, så den er
// rigtigere end en skærm, der endnu ikke er tegnet om (ellers kan samme påmindelse blive lavet to gange).
let sentIndex: Record<string, TodoEvent> | null = null;
let remindTimer: ReturnType<typeof setTimeout> | undefined;
let latest: Store | null = null;

/**
 * Holder påmindelserne i Google Kalender ens med huskelisten: opretter, retter og fjerner.
 * Hvert forsøg skrives i den lille log (Sikkerhedskopi › "Seneste forsøg").
 */
export async function syncTodoReminders(store: Store): Promise<void> {
  const g = store.data.settings.google;
  const index = sentIndex ?? g.todoEvents ?? {};
  const on = !!g.remind?.on;
  if (!on && !Object.keys(index).length) return;
  const time = g.remind?.time || REMIND_TIME;
  const cal = g.remind?.cal || pushCalendar(g);
  const plan = planReminders(store.data.todos, index, today(), time, cal, on);
  if (!plan.put.length && !plan.remove.length) return;
  const token = writeToken();
  if (!token) {
    void noteAuto('Påmindelser venter: Dagbog har ikke lov til at skrive i Google Kalender lige nu');
    return;
  }
  if (reminding) return;
  reminding = true;
  const next = { ...index };
  let made = 0;
  let gone = 0;
  try {
    for (const r of plan.remove) {
      await deleteEvent(token, r.ev.cal, r.ev.id);
      delete next[r.todoId];
      gone++;
    }
    for (const p of plan.put) {
      const where = await pushReminder(token, p.old, toReminderEvent(p.todo.text, p.todo.due!, time), cal);
      next[p.todo.id] = { ...where, key: p.key };
      made++;
    }
    void noteAuto(`Påmindelser: ${made} lagt i Google Kalender, ${gone} fjernet (kl. ${time})`);
  } catch (e) {
    const msg = e instanceof GoogleError ? e.message : 'Kunne ikke sende til Google.';
    set({ error: msg });
    void noteAuto(`Påmindelser fejlede efter ${made} lagt og ${gone} fjernet: ${msg}`);
  } finally {
    reminding = false;
    if (made || gone) sentIndex = next;
    if (made || gone) await store.saveSettings({ ...store.data.settings, google: { ...store.data.settings.google, todoEvents: next } });
  }
}

/** Én fælles ventetid, og altid med de nyeste data, uanset hvor mange skærme der beder om det. */
function remindSoon(ms: number) {
  clearTimeout(remindTimer);
  remindTimer = setTimeout(() => { if (latest) void syncTodoReminders(latest); }, ms);
}

/** Henter automatisk efter login og når appen kommer frem, hvis aftalerne er gamle. */
export function useGoogleAutoSync() {
  const store = useStore();
  const g = store.data.settings.google;
  useEffect(() => {
    const err = lastError();
    if (err && !state.error) set({ error: err === 'access_denied' ? 'Du sagde nej til Google.' : 'Tryk Opdatér for at hente fra Google.' });
    const run = () => {
      if (!document.hidden && clientIdOf(g) && currentToken() && Date.now() - g.lastSync > STALE_MS) syncGoogle(store);
      if (!document.hidden && writeToken()) pushAppointments(store);
      if (!document.hidden) remindSoon(0);
    };
    run();
    document.addEventListener('visibilitychange', run);
    return () => document.removeEventListener('visibilitychange', run);
  }, [store]); // eslint-disable-line react-hooks/exhaustive-deps
  // Huskelisten eller indstillingen er ændret: ret påmindelserne lidt efter (så flere rettelser samles)
  latest = store;
  useEffect(() => {
    remindSoon(1500);
  }, [store.data.todos, g.remind?.on, g.remind?.time, g.remind?.cal]); // eslint-disable-line react-hooks/exhaustive-deps
}
