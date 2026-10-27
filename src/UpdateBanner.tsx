import { useEffect } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

/** Ny version klar: én knap genindlæser appen med den nye version. */
export function UpdateBanner() {
  const { needRefresh: [needRefresh], updateServiceWorker } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // Kig efter en ny version, når appen kommer frem, og hver time
      const check = () => { if (!document.hidden) reg.update().catch(() => undefined); };
      document.addEventListener('visibilitychange', check);
      setInterval(check, 60 * 60_000);
    },
  });
  useEffect(() => {
    document.body.classList.toggle('has-update', needRefresh);
  }, [needRefresh]);
  if (!needRefresh) return null;
  return (
    <div className="update-banner" role="status">
      <span className="grow">Ny version klar</span>
      <button className="btn primary small" onClick={() => updateServiceWorker(true)}>Opdatér</button>
    </div>
  );
}
