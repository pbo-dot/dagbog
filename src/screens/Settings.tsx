import { useState, type ReactNode } from 'react';
import { AIError, testKey } from '../lib/ai';
import { biometricsAvailable } from '../lib/crypto';
import { addMonths, today, WEEKDAYS } from '../lib/dates';
import { badgeSupported, reminderICS } from '../lib/device';
import { download, parseBackup, toJSON, toPDF, toText } from '../lib/export';
import { useStore } from '../lib/store';
import { backupNow } from '../lib/backupSync';
import { clientIdOf, currentToken, driveToken, forget, writeToken, GOOGLE_CLIENT_ID, redirectUri, signIn } from '../lib/google';
import { pushCalendar, syncGoogle, useGoogleState } from '../lib/googleSync';
import { DEFAULT_SETTINGS, type Settings } from '../lib/types';
import { DoubleConfirm, Header, Switch } from '../ui';
import { PinChooser } from './Lock';

export type Theme = 'system' | 'light' | 'dark';

export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', t);
}

export function getTheme(): Theme {
  try {
    return (localStorage.getItem('dagbog-theme') as Theme) || 'system';
  } catch {
    return 'system';
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="stack-sm">
      <h3>{title}</h3>
      <div className="card stack">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="stack-sm" style={{ gap: 4 }}>
      <div className="setting"><span>{label}</span>{children}</div>
      {hint && <p className="tiny muted">{hint}</p>}
    </div>
  );
}

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (klogest)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (hurtigst, billigst)' },
];

/** Forbind Google Kalender, vælg kalendere, hent nu eller afbryd. */
function GoogleSection() {
  const store = useStore();
  const s = store.data.settings;
  const g = s.google;
  const { busy, error } = useGoogleState();
  const clientId = clientIdOf(g);
  const connected = !!g.email || !!currentToken();
  const saveGoogle = (patch: Partial<Settings['google']>) => store.saveSettings({ ...s, google: { ...g, ...patch } });

  return (
    <Section title="Google Kalender">
      {!connected ? (
        <>
          <p className="small">Dagbogen kan hente dine aftaler fra Google Kalender og vise dem i Kalender-fanen og bruge dem i "Spørg dagbogen". Den kan kun læse, ikke ændre.</p>
          {!GOOGLE_CLIENT_ID && (
            <>
              <label className="field">Klient-id fra Google Cloud
                <input type="text" value={g.clientId} placeholder="….apps.googleusercontent.com" autoComplete="off"
                  onChange={(e) => saveGoogle({ clientId: e.target.value.trim() })} />
              </label>
              <p className="tiny muted">Omdirigerings-URI i Google Cloud: {redirectUri()}</p>
            </>
          )}
          <button className="btn primary" style={{ alignSelf: 'flex-start' }} disabled={!clientId} onClick={() => signIn(clientId)}>Forbind med Google</button>
          <p className="tiny muted">Du sendes til Google og tilbage igen. Bagefter skal dagbogen låses op igen.</p>
        </>
      ) : (
        <>
          <p className="small">{g.email ? <>Forbundet som <strong>{g.email}</strong></> : 'Forbundet'}</p>
          {g.calendars.length > 0 && (
            <div className="stack-sm">
              <span className="tiny muted">Vis disse kalendere</span>
              {g.calendars.map((c) => (
                <label key={c.id} className="row" style={{ gap: 10 }}>
                  <input type="checkbox" checked={c.on}
                    onChange={(e) => saveGoogle({ calendars: g.calendars.map((x) => (x.id === c.id ? { ...x, on: e.target.checked } : x)) })} />
                  <i className="g-dot" style={{ background: c.color }} />
                  <span className="small">{c.name}</span>
                </label>
              ))}
            </div>
          )}
          <div className="stack-sm">
            <div className="setting"><strong>Nye aftaler til Google</strong>
              <Switch checked={g.push} onChange={(push) => saveGoogle({ push })} label="Nye aftaler fra Dagbog lægges i Google Kalender" />
            </div>
            {g.push && g.calendars.some((c) => c.writable) && (
              <label className="setting"><span>Kalender</span>
                <select value={pushCalendar(g)} onChange={(e) => saveGoogle({ pushCal: e.target.value })}>
                  {g.calendars.filter((c) => c.writable).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
            )}
            {g.push && !writeToken() && (
              <div className="card stack-sm" style={{ background: 'var(--accent-soft)', boxShadow: 'none' }}>
                <strong>Første gang</strong>
                <span className="small">Google spørger, om Dagbog må skrive i kalenderen.</span>
                <button className="btn primary block" onClick={() => signIn(clientId, { hint: g.email || undefined, write: true, back: '#/indstillinger' })}>Giv lov hos Google</button>
              </div>
            )}
          </div>
          <p className="tiny muted">{g.lastSync ? `Sidst hentet ${new Date(g.lastSync).toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' })}. ` : ''}Henter det seneste år og 6 måneder frem. Aftalerne gemmes krypteret som resten af dagbogen.</p>
          {error && <p className="error small">{error}</p>}
          <div className="row">
            <button className="btn small" disabled={busy} onClick={() => syncGoogle(store, { login: true })}>{busy ? <><span className="spinner" /> Henter …</> : 'Hent nu'}</button>
            <button className="btn ghost small" onClick={async () => {
              if (!confirm('Afbryd forbindelsen og fjern Google-aftalerne fra dagbogen?')) return;
              await forget();
              for (const id of Object.keys(store.data.google)) await store.remove('google', id);
              await store.saveSettings({ ...s, google: { ...DEFAULT_SETTINGS.google, clientId: g.clientId } });
            }}>Afbryd</button>
          </div>
        </>
      )}
    </Section>
  );
}

export function SettingsScreen() {
  const store = useStore();
  const s = store.data.settings;
  const [theme, setTheme] = useState<Theme>(getTheme);
  const [newTag, setNewTag] = useState('');
  const [keyStatus, setKeyStatus] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [changingPin, setChangingPin] = useState<'old' | 'new' | null>(null);
  const [oldPin, setOldPin] = useState('');
  const [msg, setMsg] = useState('');
  const [wipeMsg, setWipeMsg] = useState('');
  const [bioMsg, setBioMsg] = useState('');
  const [from, setFrom] = useState(addMonths(today(), -12));
  const [to, setTo] = useState(today());

  const update = (patch: (s: Settings) => Settings) => store.saveSettings(patch(structuredClone(s)));

  const setThemeAndSave = (t: Theme) => {
    setTheme(t);
    applyTheme(t);
    try { localStorage.setItem('dagbog-theme', t); } catch { /* ignorer */ }
  };

  const appUrl = location.href.split('#')[0];

  return (
    <div className="stack" style={{ gap: 24 }}>
      <Header back="mere" right={<button className="btn ghost" onClick={store.lock}>Lås nu</button>} />
      <h1>Indstillinger</h1>

      <Section title="Skriv">
        <Row label="Vis dagens spørgsmål" hint="Et lille spørgsmål over skrivefeltet, der skifter hver dag.">
          <Switch label="Vis dagens spørgsmål" checked={s.showQuestion} onChange={(v) => update((x) => ({ ...x, showQuestion: v }))} />
        </Row>
      </Section>

      <Section title="Påmindelser">
        <Row label="Daglig påmindelse" hint="Viser en prik i appen og på app-ikonet, når dagen ikke er skrevet efter tidspunktet. En overset påmindelse gentages ikke.">
          <Switch label="Daglig påmindelse" checked={s.reminder.enabled} onChange={(v) => update((x) => ({ ...x, reminder: { ...x.reminder, enabled: v } }))} />
        </Row>
        {s.reminder.enabled && (
          <>
            <label className="field">Tidspunkt
              <input type="time" value={s.reminder.time} onChange={(e) => update((x) => ({ ...x, reminder: { ...x.reminder, time: e.target.value || '21:00' } }))} />
            </label>
            <label className="field">Tekst
              <input type="text" value={s.reminder.text} onChange={(e) => update((x) => ({ ...x, reminder: { ...x.reminder, text: e.target.value } }))} />
            </label>
          </>
        )}
        <label className="field">Ugeopsummering vises
          <select value={s.summaryWeekday} onChange={(e) => update((x) => ({ ...x, summaryWeekday: Number(e.target.value) }))}>
            {[1, 2, 3, 4, 5, 6, 0].map((d) => <option key={d} value={d}>{WEEKDAYS[d].charAt(0).toUpperCase() + WEEKDAYS[d].slice(1)}</option>)}
          </select>
        </label>
        {badgeSupported() && 'Notification' in window && Notification.permission !== 'granted' && (
          <Row label="Prik på app-ikonet" hint="På iPhone kræver prikken, at appen er føjet til hjemmeskærmen, og at du giver tilladelse.">
            <button className="btn small" onClick={async () => { await Notification.requestPermission(); setMsg('Tak.'); }}>Tillad</button>
          </Row>
        )}
        <div className="stack-sm">
          <p className="tiny muted">
            En webapp uden server kan ikke vække telefonen på et bestemt tidspunkt. Vil du have en påmindelse, der altid kommer, kan du lægge en gentagen begivenhed i din kalender.
          </p>
          <div className="row wrap">
            <button className="btn small" onClick={() => download(new Blob([reminderICS({ time: s.reminder.time, text: s.reminder.text, url: appUrl })], { type: 'text/calendar' }), 'dagbog-paamindelse.ics')}>
              Daglig kalenderpåmindelse
            </button>
            <button className="btn small" onClick={() => download(new Blob([reminderICS({ time: s.reminder.time, text: 'Ugens opsummering er klar', url: `${appUrl}#/uge`, weekly: { weekday: s.summaryWeekday } })], { type: 'text/calendar' }), 'dagbog-uge.ics')}>
              Ugentlig
            </button>
          </div>
        </div>
      </Section>

      <Section title="AI-analyse">
        <Row label="AI-analyse" hint="Bruges til ugeopsummering, månedskapitler, 'Gå dybere' og søgning med naturligt sprog.">
          <Switch label="AI-analyse" checked={s.ai.enabled} onChange={(v) => update((x) => ({ ...x, ai: { ...x.ai, enabled: v } }))} />
        </Row>
        <div className="notice tiny">
          <strong>Sådan behandles teksten:</strong> Når AI er slået til, sendes teksten fra de relevante dage (og humør og tags) krypteret over HTTPS direkte fra denne enhed til Anthropics Claude API. Det sker kun, når en opsummering, et kapitel eller en AI-søgning laves. Ingen anden server er involveret. Anthropic bruger som udgangspunkt ikke API-data til at træne modeller og opbevarer dem kun i en begrænset periode. Se Anthropics privatlivspolitik. Slår du AI fra, forlader intet enheden.
        </div>
        {s.ai.enabled && (
          <>
            <label className="field">Anthropic API-nøgle
              <div className="row">
                <input type={showKey ? 'text' : 'password'} className="grow" value={s.ai.apiKey} placeholder="sk-ant-…" autoComplete="off"
                  onChange={(e) => { setKeyStatus(''); update((x) => ({ ...x, ai: { ...x.ai, apiKey: e.target.value.trim() } })); }} />
                <button className="btn small" type="button" onClick={() => setShowKey((v) => !v)}>{showKey ? 'Skjul' : 'Vis'}</button>
              </div>
            </label>
            <p className="tiny muted">Nøglen gemmes krypteret sammen med dagbogen. Opret en på console.anthropic.com. Sæt gerne en lav månedlig udgiftsgrænse.</p>
            <div className="row">
              <button className="btn small" disabled={!s.ai.apiKey} onClick={async () => {
                setKeyStatus('Tester …');
                try { await testKey(s); setKeyStatus('Nøglen virker.'); } catch (e) { setKeyStatus(e instanceof AIError ? e.message : 'Fejl'); }
              }}>Test nøgle</button>
              <span className="small muted">{keyStatus}</span>
            </div>
            <label className="field">Model til analyse
              <select value={s.ai.analysisModel} onChange={(e) => update((x) => ({ ...x, ai: { ...x.ai, analysisModel: e.target.value } }))}>
                {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
            <label className="field">Model til søgning
              <select value={s.ai.searchModel} onChange={(e) => update((x) => ({ ...x, ai: { ...x.ai, searchModel: e.target.value } }))}>
                {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              </select>
            </label>
          </>
        )}
      </Section>

      <GoogleSection />

      <Section title="Låsning">
        <label className="field">Lås automatisk efter
          <select value={s.autoLockMinutes} onChange={(e) => update((x) => ({ ...x, autoLockMinutes: Number(e.target.value) }))}>
            <option value={0}>Straks når appen lukkes</option>
            <option value={1}>1 minut</option>
            <option value={5}>5 minutter</option>
            <option value={15}>15 minutter</option>
            <option value={60}>1 time</option>
          </select>
        </label>
        {biometricsAvailable() && (
          <Row label="Face ID / fingeraftryk" hint={bioMsg || 'Bruger en passkey på enheden til at låse op. Koden virker stadig.'}>
            <Switch label="Face ID" checked={store.hasBio} onChange={async (v) => {
              setBioMsg('');
              try {
                if (v) { await store.enableBio(); setBioMsg('Face ID er slået til.'); }
                else await store.disableBio();
              } catch (e) {
                const m = (e as Error).message;
                setBioMsg(m === 'PRF_UNSUPPORTED' ? 'Denne enhed/browser understøtter ikke Face ID-oplåsning af krypterede data endnu (kræver fx iOS 18+).' : (e as Error).name === 'NotAllowedError' ? 'Afbrudt.' : m);
              }
            }} />
          </Row>
        )}
        {changingPin === null && <button className="btn small" style={{ alignSelf: 'flex-start' }} onClick={() => setChangingPin('old')}>Skift kode</button>}
        {changingPin === 'old' && (
          <form className="stack-sm" onSubmit={(e) => { e.preventDefault(); setChangingPin('new'); }}>
            <input type="password" autoFocus value={oldPin} onChange={(e) => setOldPin(e.target.value)} placeholder="Nuværende kode" inputMode={store.pinKind.kind === 'digits' ? 'numeric' : 'text'} />
            <div className="row"><button className="btn small">Videre</button><button type="button" className="btn ghost small" onClick={() => { setChangingPin(null); setOldPin(''); }}>Fortryd</button></div>
          </form>
        )}
        {changingPin === 'new' && (
          <PinChooser title="Vælg ny kode" onChosen={async (pin, kind) => {
            await store.changePin(oldPin, pin, kind);
            setChangingPin(null);
            setOldPin('');
            setMsg('Koden er skiftet.');
          }} />
        )}
        {msg && <p className="small muted">{msg}</p>}
      </Section>

      <Section title="Tags">
        <div className="chips">
          {s.tags.map((t) => (
            <span key={t} className="chip row" style={{ gap: 4 }}>
              {t}
              <button className="btn ghost tiny" style={{ padding: '0 4px', minHeight: 0 }} aria-label={`Fjern ${t}`}
                onClick={() => update((x) => ({ ...x, tags: x.tags.filter((y) => y !== t) }))}>×</button>
            </span>
          ))}
        </div>
        <form className="row" onSubmit={(e) => {
          e.preventDefault();
          const t = newTag.trim();
          if (t && !s.tags.includes(t)) update((x) => ({ ...x, tags: [...x.tags, t] }));
          setNewTag('');
        }}>
          <input type="text" className="grow" value={newTag} onChange={(e) => setNewTag(e.target.value)} placeholder="Nyt tag" />
          <button className="btn small" disabled={!newTag.trim()}>Tilføj</button>
        </form>
        <p className="tiny muted">Fjerner du et tag, bliver det stadig på de dage, hvor det allerede er brugt.</p>
      </Section>

      <Section title="Eksport og sikkerhedskopi">
        <div className="row">
          <label className="field grow">Fra<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field grow">Til<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        </div>
        <div className="row wrap">
          <button className="btn small" onClick={async () => download(await toPDF(store.data, from, to), `dagbog-${from}-${to}.pdf`)}>PDF</button>
          <button className="btn small" onClick={() => download(new Blob([toText(store.data, from, to)], { type: 'text/plain;charset=utf-8' }), `dagbog-${from}-${to}.txt`)}>Tekst</button>
          <button className="btn small" onClick={() => { setFrom('1900-01-01'); setTo(today()); }}>Hele dagbogen</button>
        </div>
        <div className="stack-sm">
          <p className="tiny muted">Den fulde sikkerhedskopi (JSON) indeholder alt (dage, fotos, opsummeringer, mennesker og mønstre) og kan læses ind igen på en ny enhed. Den er <strong>ikke</strong> krypteret, så opbevar den et sikkert sted. API-nøglen kommer ikke med.</p>
          <div className="row wrap">
            <button className="btn small" onClick={async () => download(new Blob([toJSON(store.data, await store.allPhotos())], { type: 'application/json' }), `dagbog-backup-${today()}.json`)}>Fuld sikkerhedskopi</button>
            <label className="btn small">
              Indlæs sikkerhedskopi
              <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const backup = parseBackup(await f.text());
                  await store.replaceAll(backup.data, backup.photos, backup.merge);
                  setMsg(backup.merge ? 'Dine gamle noter er lagt ind.' : 'Sikkerhedskopien er indlæst.');
                } catch (err) {
                  setMsg((err as Error).message);
                }
                e.target.value = '';
              }} />
            </label>
          </div>
        </div>
      </Section>

      <Section title="Udseende og sprog">
        <div className="chips">
          {(['system', 'light', 'dark'] as Theme[]).map((t) => (
            <button key={t} className={`chip ${theme === t ? 'on' : ''}`} onClick={() => setThemeAndSave(t)}>
              {t === 'system' ? 'Følg telefonen' : t === 'light' ? 'Lys' : 'Mørk'}
            </button>
          ))}
        </div>
        <p className="small muted">Sprog: dansk</p>
      </Section>

      <Section title="Har du det svært?">
        <p className="small">Appen er ikke terapi. Har du brug for at tale med nogen: <a href="tel:70201201">Livslinien 70 201 201</a>, lægevagten <a href="tel:1813">1813</a>, eller <a href="tel:112">112</a> ved akut fare.</p>
      </Section>

      <Section title="Sletning">
        <p className="tiny muted">Enkelte dage slettes fra dagens side under Husk.</p>
        <DoubleConfirm label="Slet hele dagbogen" first="Vil du slette hele dagbogen på denne telefon? Der gemmes en kopi på Drev først."
          second="Sidste chance: alt på telefonen slettes." onConfirm={async () => {
            // Gem altid en frisk kopi først, så den nyeste kan hentes igen
            if (driveToken()) {
              if (!(await backupNow(store))) return setWipeMsg('Kopien kunne ikke gemmes, så intet er slettet.');
            } else if (Object.keys(store.data.entries).length || store.data.draft) {
              return setWipeMsg('Gem først en kopi under Mere › Sikkerhedskopi. Intet er slettet.');
            }
            await store.wipe();
          }} />
        {wipeMsg && <p className="small" role="alert">{wipeMsg}</p>}
      </Section>
    </div>
  );
}
