import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import LockScreen from './components/LockScreen';
import { StoreProvider } from './store';

function Root() {
  const [locked, setLocked] = useState<boolean | null>(null); // null = still checking

  useEffect(() => {
    if (!window.ledgerApi) { setLocked(false); return; } // browser fallback — nothing to unlock
    window.ledgerApi.securityGetState().then(s => setLocked(s.locked));
  }, []);

  if (locked === null) return null; // avoid a flash of the (still-locked) app before the check resolves
  if (locked) return <LockScreen onUnlock={() => setLocked(false)} />;
  return (
    <StoreProvider>
      <App />
    </StoreProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
