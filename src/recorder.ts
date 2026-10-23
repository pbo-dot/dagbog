// DB: en neutral optager-app med én knap (en smiley). Grå kant = optager ikke, rød = optager.
// Teksten krypteres med dagbogens offentlige nøgle og kan kun læses i Dagbog.
import { keepScreenOn, speechInputAvailable, startLongDictation } from './lib/device';
import { inboxPublicKey, putInbox, type InboxItem } from './lib/inbox';

const SAVE_EVERY_MS = 3000;

const button = document.getElementById('rec') as HTMLButtonElement;
const time = document.getElementById('time') as HTMLDivElement;
const msg = document.getElementById('msg') as HTMLDivElement;
const theme = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement;

let publicKey: JsonWebKey | undefined;
let item: InboxItem | null = null;
let stop: (() => void) | null = null;
let release: (() => void) | null = null;
let clock: ReturnType<typeof setInterval> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let saving = Promise.resolve();

function show(on: boolean) {
  document.body.classList.toggle('on', on);
  button.setAttribute('aria-label', on ? 'Stop optagelse' : 'Start optagelse');
  theme.content = on ? '#7f1d1d' : '#111111';
  time.textContent = '';
}

/** Gemmer optagelsen (krypteret) i rækkefølge, så en ældre udgave aldrig overskriver en nyere. */
function save(it: InboxItem) {
  const copy = { ...it, updatedAt: Date.now() };
  saving = saving.then(() => putInbox(publicKey!, copy)).catch(() => {
    msg.textContent = 'Kunne ikke gemme.';
  });
  return saving;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = undefined;
    if (item) save(item);
  }, SAVE_EVERY_MS);
}

async function start() {
  msg.textContent = '';
  item = { id: crypto.randomUUID(), startedAt: Date.now(), updatedAt: Date.now(), text: '', done: false };
  show(true);
  release = await keepScreenOn();
  clock = setInterval(() => {
    if (!item) return;
    const s = Math.floor((Date.now() - item.startedAt) / 1000);
    time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }, 1000);
  stop = startLongDictation(
    (text) => {
      if (!item) return;
      item.text = text;
      scheduleSave();
    },
    async (err) => {
      const it = item;
      item = null;
      stop = null;
      clearInterval(clock);
      clearTimeout(saveTimer);
      saveTimer = undefined;
      release?.();
      release = null;
      show(false);
      if (it && it.text.trim()) {
        await save({ ...it, done: true });
        msg.textContent = err ? `${err} Det optagne er gemt.` : 'Gemt ✓';
      } else {
        msg.textContent = err ?? 'Der blev ikke opfanget noget tale.';
      }
    },
  );
}

button.addEventListener('click', () => {
  if (stop) stop();
  else start();
});

// Forlades appen, stopper talegenkendelsen alligevel; gem det optagne.
document.addEventListener('visibilitychange', () => {
  if (document.hidden && stop) stop();
});

(async () => {
  if (!speechInputAvailable()) {
    msg.textContent = 'Optagelse virker ikke i denne browser. Brug Chrome.';
    return;
  }
  publicKey = await inboxPublicKey();
  if (!publicKey) {
    msg.textContent = 'Ikke klar endnu: åbn hovedappen og lås den op én gang.';
    return;
  }
  button.disabled = false;
})();
