import { useEffect, useRef, useState } from 'react';
import { keepUnlocked, updateAppBadge, waiting } from './lib/device';
import { generateMonth, generateWeek, pendingGeneration } from './lib/generate';
import { StoreProvider, useStore } from './lib/store';
import { hasSharedText } from './lib/conversation';
import { useGoogleAutoSync } from './lib/googleSync';
import { useAutoBackup } from './lib/backupSync';
import { BackupScreen, RestoreFlow } from './screens/Backup';
import { AskScreen } from './screens/Ask';
import { CalendarScreen } from './screens/Calendar';
import { RoutineScreen, RoutinesScreen } from './screens/Routines';
import { ConversationScreen, ConversationsScreen, NewConversationScreen } from './screens/Conversation';
import { EntryScreen } from './screens/Entry';
import { LockScreen, SetupScreen } from './screens/Lock';
import { DayScreen, MemoryScreen, MonthScreen, OverviewScreen } from './screens/Memory';
import { MoreScreen } from './screens/More';
import { NoteScreen, NotesScreen } from './screens/Notes';
import { PatternsScreen, PeopleScreen, PersonScreen } from './screens/People';
import { SettingsScreen } from './screens/Settings';
import { TodoEditScreen, TodosScreen } from './screens/Todos';
import { WeekScreen } from './screens/Week';
import { go, Icon, useRoute } from './ui';
import { UpdateBanner } from './UpdateBanner';

const TABS = [
  { id: 'skriv', label: 'Skriv', icon: Icon.pen },
  { id: 'husk', label: 'Husk', icon: Icon.memory },
  { id: 'kalender', label: 'Kalender', icon: Icon.calendar },
  { id: 'mennesker', label: 'Mennesker', icon: Icon.people },
  { id: 'mere', label: 'Mere', icon: Icon.more },
];

/** Låser efter valgt tid uden aktivitet, og når appen har været skjult. */
function useAutoLock() {
  const { data, lock } = useStore();
  const minutes = data.settings.autoLockMinutes;
  const hiddenAt = useRef<number | null>(null);
  useEffect(() => {
    const limit = minutes * 60_000;
    let timer: ReturnType<typeof setTimeout>;
    // Uden aktivitet: lås efter valgt tid (mindst 5 min ved "straks")
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => (keepUnlocked() ? arm() : lock()), (minutes === 0 ? 5 : minutes) * 60_000);
    };
    const onVis = () => {
      if (document.hidden) {
        hiddenAt.current = Date.now();
        if (minutes === 0) lock();
      } else if (hiddenAt.current && Date.now() - hiddenAt.current >= limit) {
        lock();
      }
    };
    const events = ['pointerdown', 'keydown', 'scroll'];
    events.forEach((e) => window.addEventListener(e, arm, { passive: true }));
    document.addEventListener('visibilitychange', onVis);
    arm();
    return () => {
      clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, arm));
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [minutes, lock]);
}

/** Laver ugeopsummering og månedskapitel i baggrunden, når det er tid. */
function useAutoGenerate() {
  const store = useStore();
  const running = useRef(false);
  const failed = useRef(new Set<string>());
  const pending = pendingGeneration(store.data);
  const key = `${pending.week ?? ''}|${pending.month ?? ''}`;
  useEffect(() => {
    if (running.current || key === '|') return;
    running.current = true;
    (async () => {
      try {
        if (pending.week && !failed.current.has(pending.week)) {
          try {
            await store.put('weeks', pending.week, await generateWeek(store.data, pending.week, true));
          } catch {
            failed.current.add(pending.week);
          }
        }
        if (pending.month && !failed.current.has(pending.month)) {
          try {
            await store.put('months', pending.month, await generateMonth(store.data, pending.month));
          } catch {
            failed.current.add(pending.month);
          }
        }
      } finally {
        running.current = false;
      }
    })();
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Unlocked() {
  const route = useRoute();
  const { data } = useStore();
  const [, tick] = useState(0);
  useAutoLock();
  useAutoGenerate();
  useGoogleAutoSync();
  useAutoBackup();

  // Tekst delt fra en anden app (fx Pixel Optager) åbner en ny samtale.
  useEffect(() => {
    if (hasSharedText()) go('samtale/ny');
  }, []);

  // Nye optagelser fra Optager-appen hentes, når dagbogen kommer frem igen.
  const { refreshInbox, inbox } = useStore();
  useEffect(() => {
    const on = () => !document.hidden && refreshInbox();
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, [refreshInbox]);

  // Opdatér prikker hvert minut (påmindelsestidspunkt kan passeres)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  const w = waiting(data);
  useEffect(() => {
    updateAppBadge(waiting(data, new Date(), true));
    const onHide = () => document.hidden && updateAppBadge(waiting(data, new Date(), true));
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, [data]);

  const [tab = 'skriv', a, b] = route;
  let screen;
  switch (tab) {
    case 'skriv': screen = <EntryScreen key={a ?? 'today'} date={a} />; break;
    case 'uge': screen = <WeekScreen key={a ?? 'now'} id={a} />; break;
    case 'husk':
      if (a === 'maaned' && b) screen = <MonthScreen id={b} />;
      else if (a === 'overblik') screen = <OverviewScreen year={b} />;
      else if (a === 'dag' && b) screen = <DayScreen date={b} />;
      else screen = <MemoryScreen />;
      break;
    case 'mennesker': screen = a ? <PersonScreen id={a} /> : <PeopleScreen />; break;
    case 'moenstre': screen = <PatternsScreen />; break;
    case 'spoerg': screen = <AskScreen />; break;
    case 'kalender': screen = a === 'ny' ? <CalendarScreen startAdding /> : <CalendarScreen month={a} />; break;
    case 'faste': screen = a ? <RoutineScreen key={a} id={a} earlier={b === 'tidligere'} /> : <RoutinesScreen />; break;
    case 'samtale':
      if (a === 'ny') screen = <NewConversationScreen />;
      else if (a) screen = <ConversationScreen id={a} />;
      else screen = <ConversationsScreen />;
      break;
    case 'mere': screen = <MoreScreen />; break;
    case 'huskeliste': screen = a ? <TodoEditScreen key={a} id={a === 'ny' ? undefined : a} /> : <TodosScreen />; break;
    case 'noter': screen = a ? <NoteScreen key={a} id={a} /> : <NotesScreen />; break;
    case 'indstillinger': screen = <SettingsScreen />; break;
    case 'kopi':
      screen = a === 'hent'
        ? <div className="stack" style={{ alignItems: 'center' }}><RestoreFlow back="#/kopi/hent" replacing onCancel={() => go('kopi')} /></div>
        : <BackupScreen />;
      break;
    default: screen = <EntryScreen />;
  }

  const dots: Record<string, boolean> = { skriv: w.today, husk: w.week || w.month || inbox.some((i) => i.done) };
  const activeTab = ['samtale', 'spoerg', 'faste', 'uge', 'noter', 'huskeliste'].includes(tab) ? 'husk'
    : ['moenstre', 'indstillinger', 'kopi'].includes(tab) ? 'mere' : tab;

  return (
    <>
      <main className="app">
        <div className="screen" key={route.join('/')}>{screen}</div>
      </main>
      <nav className="tabbar">
        <div className="inner">
          {TABS.map((t) => (
            <button key={t.id} className={`tab ${activeTab === t.id ? 'on' : ''}`} onClick={() => go(t.id)} aria-current={activeTab === t.id ? 'page' : undefined}>
              <span className="pill">{t.icon}</span>
              <span>{t.label}</span>
              {dots[t.id] && <span className="dot" aria-label="Nyt" />}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}

function Root() {
  const { status } = useStore();
  if (status === 'loading') return null;
  if (status === 'setup') return <SetupScreen />;
  if (status === 'locked') return <LockScreen />;
  return <Unlocked />;
}

export default function App() {
  return (
    <StoreProvider>
      <Root />
      <UpdateBanner />
    </StoreProvider>
  );
}
