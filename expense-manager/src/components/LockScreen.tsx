import { useState } from 'react';

/** Shown before the app boots when the database is encrypted-at-rest and needs its passphrase. */
export default function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!passphrase || busy || !window.ledgerApi) return;
    setBusy(true);
    setError(null);
    const result = await window.ledgerApi.securityUnlock(passphrase);
    setBusy(false);
    if (result.ok) {
      onUnlock();
    } else {
      setError(result.error ?? 'Incorrect passphrase.');
      setPassphrase('');
    }
  };

  return (
    <div style={{
      height: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: '#eceae4', fontFamily: "'Helvetica Neue', Helvetica, Arial, sans-serif", gap: 18,
    }}>
      <span style={{ width: 44, height: 44, borderRadius: 13, background: '#1f6f5c', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="9" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
      </span>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 17, fontWeight: 600, color: '#2a2822' }}>Ledger is locked</div>
        <div style={{ fontSize: 13, color: '#8a8880', marginTop: 4 }}>Enter your passphrase to decrypt your database.</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, width: 280 }}>
        <input
          type="password" autoFocus value={passphrase} disabled={busy}
          onChange={e => setPassphrase(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          placeholder="Passphrase"
          style={{ width: '100%', fontSize: 14, padding: '10px 12px', border: '1px solid #e0ddd4', borderRadius: 9, outline: 'none', background: '#fff', color: '#26241f' }}
        />
        {error && <div style={{ fontSize: 12.5, color: '#c0492f', textAlign: 'center' }}>{error}</div>}
        <button onClick={submit} disabled={!passphrase || busy}
          style={{ width: '100%', height: 36, background: '#1f6f5c', border: 'none', borderRadius: 9, color: '#fff', fontSize: 13.5, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: !passphrase || busy ? .6 : 1 }}>
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: '#a8a498', maxWidth: 280, textAlign: 'center', lineHeight: 1.5 }}>
        There's no password reset — if you've lost the passphrase, restore from a JSON backup instead.
      </div>
    </div>
  );
}
