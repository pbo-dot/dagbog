import { addDays, fromISO, MONTHS, monthId, today } from '../lib/dates';
import { useStore } from '../lib/store';
import { DKK_PER_USD, FEATURE_GROUPS, kr, krText, monthName, monthTotal } from '../lib/usage';
import { go, Header, Switch } from '../ui';


/** Månedens forbrug som lille kort under Indstillinger → AI. */
export function UsageCard() {
  const { data } = useStore();
  const id = monthId(today());
  const total = monthTotal(data.usage[id]);
  const limit = data.settings.ai.limitKr;
  return (
    <button className="usage-card" onClick={() => go('forbrug')}>
      <span className="small muted">Forbrug i {monthName(id)}</span>
      <span className="usage-big">ca. {krText(total)}</span>
      {limit > 0 && (
        <>
          <span className="usage-bar"><i style={{ width: `${Math.min(100, (kr(total) / limit) * 100)}%` }} className={kr(total) > limit ? 'over' : ''} /></span>
          <span className="small muted">{Math.round(kr(total))} af {limit} kr · din grænse</span>
        </>
      )}
      <span className="usage-link">Se forbrug ›</span>
    </button>
  );
}

/** Siden "Forbrug": hvad Claude har kostet i måneden, fordelt og dag for dag. */
export function UsageScreen() {
  const store = useStore();
  const { data } = store;
  const s = data.settings;
  const t = today();
  const id = monthId(t);
  const month = data.usage[id];
  const total = monthTotal(month);
  const groups = FEATURE_GROUPS
    .map((g) => ({ label: g.label, usd: g.features.reduce((a, f) => a + (month?.features[f] ?? 0), 0) }))
    .filter((g) => g.usd > 0);
  const top = Math.max(...groups.map((g) => g.usd), 1e-9);
  // De seneste 14 dage (også fra sidste måned)
  const days = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
  const perDay = days.map((d) => data.usage[monthId(d)]?.days[d] ?? 0);
  const dayTop = Math.max(...perDay, 1e-9);
  const models = Object.entries(month?.models ?? {}).sort((a, b) => b[1] - a[1]);
  const prev = data.usage[monthId(addDays(`${id}-01`, -1))];
  const setAi = (patch: Partial<typeof s.ai>) => store.saveSettings({ ...s, ai: { ...s.ai, ...patch } });

  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header back="indstillinger" />
      <div className="stack-sm" style={{ gap: 2 }}>
        <h1>Forbrug</h1>
        <span className="small muted">{monthName(id)[0].toUpperCase() + monthName(id).slice(1)} · {month?.count ?? 0} svar</span>
        <span className="usage-big" style={{ fontSize: '2.4rem' }}>ca. {krText(total)}</span>
        {prev && <span className="small muted">{monthName(prev.id)}: ca. {krText(monthTotal(prev))}</span>}
      </div>

      {groups.length > 0 ? (
        <section className="stack-sm">
          <h3>Hvad det gik til</h3>
          <div className="card stack-sm">
            {groups.map((g) => (
              <div key={g.label} className="stack-sm" style={{ gap: 4 }}>
                <div className="row between"><span>{g.label}</span><strong>{krText(g.usd)}</strong></div>
                <span className="usage-bar"><i style={{ width: `${(g.usd / top) * 100}%` }} /></span>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="muted">Intet brugt endnu i {monthName(id)}. Forbruget tælles fra nu af.</p>
      )}

      {perDay.some((v) => v > 0) && (
        <section className="stack-sm">
          <h3>Pr. dag</h3>
          <div className="card">
            <div className="usage-days" role="img" aria-label="Forbrug de seneste 14 dage">
              {perDay.map((v, i) => <i key={days[i]} style={{ height: `${Math.max(v > 0 ? 4 : 0, (v / dayTop) * 100)}%` }} title={`${fromISO(days[i]).getDate()}.: ${krText(v)}`} />)}
            </div>
            <div className="row between tiny muted"><span>{fromISO(days[0]).getDate()}. {MONTHS[fromISO(days[0]).getMonth()].slice(0, 3)}.</span><span>i dag</span></div>
          </div>
        </section>
      )}

      {models.length > 0 && (
        <section className="stack-sm">
          <h3>Modeller</h3>
          <div className="card stack-sm">
            {models.map(([m, usd]) => <div key={m} className="row between"><span>{m}</span><strong>{krText(usd)}</strong></div>)}
          </div>
        </section>
      )}

      <section className="stack-sm">
        <h3>Advar mig</h3>
        <div className="card stack">
          <div className="setting">
            <span>Når måneden passerer en grænse</span>
            <Switch label="Grænse" checked={s.ai.limitKr > 0} onChange={(v) => setAi({ limitKr: v ? 100 : 0 })} />
          </div>
          {s.ai.limitKr > 0 && (
            <label className="field">Grænse i kroner
              <input type="number" inputMode="numeric" min={1} value={s.ai.limitKr}
                onChange={(e) => { const v = Math.round(Number(e.target.value)); if (v > 0) setAi({ limitKr: v }); }} />
            </label>
          )}
          <div className="setting">
            <span>Vis prisen under hvert svar</span>
            <Switch label="Vis pris" checked={s.ai.showCost} onChange={(v) => setAi({ showCost: v })} />
          </div>
        </div>
      </section>

      <p className="small muted">
        Et skøn ud fra Anthropics priser og {DKK_PER_USD.toLocaleString('da-DK')} kr pr. dollar. Den præcise regning:{' '}
        <a href="https://console.anthropic.com/usage" target="_blank" rel="noopener noreferrer">console.anthropic.com</a>
      </p>
    </div>
  );
}
