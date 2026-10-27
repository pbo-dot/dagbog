import type { ReactNode } from 'react';
import { useStore } from '../lib/store';
import { go, Header, Icon } from '../ui';
import { whenText } from './Backup';

function Row({ icon, title, text, onClick, href }: { icon: ReactNode; title: string; text: string; onClick?: () => void; href?: string }) {
  const body = (
    <div className="row" style={{ gap: 12 }}>
      <span style={{ width: 22, height: 22, display: 'inline-flex', flex: 'none', color: 'var(--accent)' }}>{icon}</span>
      <span className="grow">
        <strong style={{ display: 'block' }}>{title}</strong>
        <span className="small muted">{text}</span>
      </span>
      <span style={{ width: 18, height: 18, display: 'inline-flex', flex: 'none' }} className="muted">{Icon.chevronRight}</span>
    </div>
  );
  return href
    ? <a className="list-item" href={href} target="_blank" rel="noreferrer" style={{ color: 'inherit', textDecoration: 'none' }}>{body}</a>
    : <button className="list-item" onClick={onClick}>{body}</button>;
}

/** Fanen "Mere": det, der bruges sjældnere, samlet ét sted. */
export function MoreScreen() {
  const store = useStore();
  const patterns = Object.keys(store.data.patterns).length;
  const b = store.data.settings.backup;
  return (
    <div className="stack" style={{ gap: 20 }}>
      <Header title="Mere" />
      <div className="card list" style={{ padding: '2px 16px' }}>
        <Row icon={Icon.patterns} title="Mønstre" text={patterns ? `${patterns} ${patterns === 1 ? 'mønster' : 'mønstre'}` : 'Tanker og mønstre, der går igen'} onClick={() => go('moenstre')} />
        <Row icon={Icon.cloud} title="Sikkerhedskopi" text={b.last ? `Gemt på Drev · ${whenText(b.last).toLowerCase()}` : 'Gem en låst kopi på Google Drev'} onClick={() => go('kopi')} />
        <Row icon={Icon.gear} title="Indstillinger" text="Låsning, AI, påmindelser og sikkerhedskopi" onClick={() => go('indstillinger')} />
        <Row icon={Icon.lock} title="Lås nu" text="Dagbogen låses straks" onClick={store.lock} />
      </div>
      <p className="tiny muted" style={{ textAlign: 'center' }}>Version {__BUILD__}</p>
    </div>
  );
}
