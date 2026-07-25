import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { AI_PROVIDERS, categorizeMerchants, modelFor, providerDef } from '../lib/api';
import { isDesktop } from '../lib/persist';
import { accountTxnCount, txnCategoryList, useStore } from '../store';
import type { Account, AccountType, AiProvider, AppData } from '../types';
import { Modal, Toggle } from '../components/ui';

export default function Settings() {
  const { state, dispatch } = useStore();
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [keyModal, setKeyModal] = useState(false);
  const [aiStatus, setAiStatus] = useState<string | null>(null);
  const [dbInfo, setDbInfo] = useState<{ path: string; sizeBytes: number } | null>(null);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);
  const [apiKeyMasked, setApiKeyMasked] = useState('');
  const [encState, setEncState] = useState<{ locked: boolean; encrypted: boolean } | null>(null);
  const [encModal, setEncModal] = useState<'enable' | 'change' | null>(null);
  const [householdName, setHouseholdName] = useState(state.settings.householdName);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setHouseholdName(state.settings.householdName); }, [state.settings.householdName]);

  const commitHouseholdName = () => {
    const trimmed = householdName.trim();
    if (trimmed && trimmed !== state.settings.householdName) {
      dispatch({ type: 'updateSettings', patch: { householdName: trimmed } });
    } else {
      setHouseholdName(state.settings.householdName);
    }
  };

  const provider = state.settings.aiProvider;
  const providerInfo = providerDef(provider);
  const activeModel = modelFor(provider, state.settings.aiModels);

  const setModel = (value: string) => {
    const next = { ...state.settings.aiModels };
    // Storing the built-in default as an override would freeze it; keep "default" as absent.
    if (!value.trim() || value.trim() === providerInfo.model) delete next[provider];
    else next[provider] = value.trim();
    dispatch({ type: 'updateSettings', patch: { aiModels: next } });
  };

  const refreshApiKey = () => {
    if (window.ledgerApi) window.ledgerApi.secretsGetApiKeyMasked(provider).then(setApiKeyMasked);
  };
  const refreshEncryption = () => {
    if (window.ledgerApi) window.ledgerApi.securityGetState().then(setEncState);
  };

  useEffect(() => {
    if (window.ledgerApi) window.ledgerApi.info().then(setDbInfo);
    refreshApiKey();
    refreshEncryption();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.transactions.length, provider]);

  const sizeKB = dbInfo ? Math.round(dbInfo.sizeBytes / 1024) : Math.round(JSON.stringify(state).length / 1024);

  const download = (name: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const exportJSON = () => download('ledger-backup.json', JSON.stringify(state, null, 2), 'application/json');

  const backupDatabase = async () => {
    if (!window.ledgerApi) { exportJSON(); return; }
    setBackupStatus('Saving…');
    const result = await window.ledgerApi.backup();
    setBackupStatus(result.ok ? `Saved to ${result.path}` : null);
  };

  const restoreDatabase = async () => {
    if (!window.ledgerApi) { fileRef.current?.click(); return; }
    if (!confirm('Restoring will replace all current data with the chosen backup file. Continue?')) return;
    const result = await window.ledgerApi.restore();
    if (result.ok && result.data) dispatch({ type: 'restore', data: result.data });
    else if (!result.ok) setBackupStatus(null);
  };

  const exportCSV = () => {
    const header = 'date,merchant,raw_description,amount,currency,account,category,subcategory,flow_type,confidence,tags,notes';
    const esc = (s: string) => '"' + s.replace(/"/g, '""') + '"';
    const rows = state.transactions.map(t => [
      t.date, esc(t.merchantNormalized), esc(t.merchantRaw), t.amount.toFixed(2), t.currency,
      esc(state.accounts.find(a => a.id === t.accountId)?.name ?? ''),
      esc(t.splits && t.splits.length > 1 ? txnCategoryList(state, t) : (state.categories.find(c => c.id === t.categoryId)?.name ?? '')),
      esc(state.categories.find(c => c.id === t.subcategoryId)?.name ?? ''),
      t.flowType + (t.transferSubtype ? ':' + t.transferSubtype : ''),
      t.confidence.toFixed(2), esc(t.tags.join(';')), esc(t.notes),
    ].join(','));
    download('ledger-transactions.csv', [header, ...rows].join('\n'), 'text/csv');
  };

  const restore = async (file: File) => {
    try {
      const data = JSON.parse(await file.text()) as AppData;
      if (data.schemaVersion !== 1 || !Array.isArray(data.transactions)) throw new Error('bad shape');
      if (window.ledgerApi) {
        const result = await window.ledgerApi.restoreFromJson(data);
        if (result.ok && result.data) dispatch({ type: 'restore', data: result.data });
      } else {
        dispatch({ type: 'restore', data });
      }
    } catch {
      alert('That file is not a valid Ledger backup.');
    }
  };

  const runAiCategorization = async () => {
    if (!window.ledgerApi) return;
    const apiKey = await window.ledgerApi.secretsGetApiKeyForUse(provider);
    if (!apiKey) { setAiStatus(`No ${providerInfo.label} API key set.`); return; }
    const uncategorized = [...new Set(
      state.transactions
        .filter(t => !t.categoryId && t.flowType !== 'transfer' && !t.reviewed)
        .map(t => t.merchantNormalized),
    )];
    if (uncategorized.length === 0) { setAiStatus('Nothing to categorize — all merchants matched.'); return; }
    setAiStatus(`Asking ${activeModel} about ${uncategorized.length} merchant${uncategorized.length > 1 ? 's' : ''}…`);
    try {
      const results = await categorizeMerchants(provider, apiKey, uncategorized, state.categories, activeModel);
      dispatch({ type: 'applyApiResults', results });
      setAiStatus(`Categorized ${results.filter(r => r.categoryId).length} of ${uncategorized.length} merchants. Low-confidence ones stay in the review queue.`);
    } catch (e) {
      setAiStatus(`${providerInfo.label} call failed: ` + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <div className="page page-narrow">
      <div style={{ marginBottom: 18 }}>
        <div className="page-title">Settings</div>
        <div className="page-sub">Accounts, privacy, and your local data — nothing leaves this device by default</div>
      </div>

      {/* household */}
      <div className="card" style={{ padding: '20px 22px', marginBottom: 14 }}>
        <div className="card-title" style={{ fontSize: 15, marginBottom: 6 }}>Household</div>
        <label className="field">Household name</label>
        <input
          className="input"
          style={{ width: '100%', maxWidth: 320 }}
          value={householdName}
          onChange={e => setHouseholdName(e.target.value)}
          onBlur={commitHouseholdName}
          onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') { setHouseholdName(state.settings.householdName); e.currentTarget.blur(); }
          }}
        />
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 10 }}>
          Shown on the Dashboard greeting, the sidebar, and report headers.
        </div>
      </div>

      {/* accounts */}
      <div className="card" style={{ padding: '20px 22px', marginBottom: 14 }}>
        <div className="card-title" style={{ fontSize: 15, marginBottom: 16 }}>Accounts</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {state.accounts.map(a => {
            const txnCount = accountTxnCount(state, a.id);
            return (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 13, padding: '12px 8px', borderTop: '1px solid #f2efe8' }}>
                <span style={{ width: 34, height: 34, borderRadius: 9, background: a.color, opacity: .18, flex: 'none' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink-2)' }}>{a.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>
                    {a.issuingBank} · {a.accountType.replace('_', ' ')}{a.lastFour ? ` · ••${a.lastFour}` : ''}
                  </div>
                </div>
                <button className="link-sm" style={{ fontSize: 12 }} onClick={() => setEditAccount(a)}>Edit</button>
                <button
                  className="link-sm"
                  style={{ fontSize: 12, color: txnCount === 0 ? 'var(--red)' : 'var(--muted-3)', cursor: txnCount === 0 ? 'pointer' : 'default' }}
                  disabled={txnCount > 0}
                  title={txnCount > 0 ? `Has ${txnCount} transaction${txnCount > 1 ? 's' : ''} — delete or reassign them first` : undefined}
                  onClick={() => {
                    if (txnCount > 0) return;
                    if (confirm(`Delete "${a.name}"? This can't be undone.`)) dispatch({ type: 'deleteAccount', accountId: a.id });
                  }}
                >
                  Delete
                </button>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 12 }}>
          New accounts are created during import — the issuing bank powers credit-card-payment detection.
        </div>
      </div>

      {/* privacy & categorization */}
      <div className="card" style={{ padding: '20px 22px', marginBottom: 14 }}>
        <div className="card-title" style={{ fontSize: 15, marginBottom: 6 }}>Privacy &amp; categorization</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid #f2efe8' }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>AI categorization fallback</div>
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)', maxWidth: 440 }}>
              Only merchant names are ever sent — never amounts, dates, or accounts. Rules run first, offline.
            </div>
          </div>
          <Toggle on={state.settings.apiFallbackEnabled} onChange={v => dispatch({ type: 'updateSettings', patch: { apiFallbackEnabled: v } })} />
        </div>
        {isDesktop ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid #f2efe8' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>Model provider</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted-2)', maxWidth: 440 }}>
                  Each provider keeps its own key and model, so switching back and forth doesn't lose either one.
                </div>
              </div>
              <div className="seg" style={{ flex: 'none' }}>
                {AI_PROVIDERS.map(p => (
                  <button
                    key={p.key}
                    className={'seg-item' + (provider === p.key ? ' active' : '')}
                    onClick={() => dispatch({ type: 'updateSettings', patch: { aiProvider: p.key as AiProvider } })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid #f2efe8', gap: 16 }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>Model</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted-2)', maxWidth: 430 }}>
                  Providers retire model ids over time. If a call fails with "model not available",
                  set a current one here — no rebuild needed.
                </div>
              </div>
              <input
                className="input"
                list={`models-${provider}`}
                style={{ width: 230, flex: 'none' }}
                value={activeModel}
                onChange={e => setModel(e.target.value)}
                placeholder={providerInfo.model}
              />
              <datalist id={`models-${provider}`}>
                {[providerInfo.model, ...providerInfo.alternateModels].map(m => <option key={m} value={m} />)}
              </datalist>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0', borderBottom: '1px solid #f2efe8' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>{providerInfo.label} API key</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>
                  {apiKeyMasked ? `${apiKeyMasked} · in your OS keychain` : `Not set — get one at ${providerInfo.keyUrl}`}
                </div>
              </div>
              <button className="link-sm" style={{ fontSize: 12 }} onClick={() => setKeyModal(true)}>Update</button>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 0' }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-3)' }}>Categorize unmatched merchants now</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted-2)', maxWidth: 440 }}>
                  {aiStatus ?? 'Sends only merchant names still unmatched by rules; results are cached so a merchant is never asked twice.'}
                </div>
              </div>
              <button className="btn-ghost" disabled={!state.settings.apiFallbackEnabled || !apiKeyMasked}
                style={{ opacity: state.settings.apiFallbackEnabled && apiKeyMasked ? 1 : .45 }}
                onClick={runAiCategorization}>Run</button>
            </div>
          </>
        ) : (
          <div style={{ padding: '14px 0', fontSize: 11.5, color: 'var(--muted-2)' }}>
            Model provider and API key management require the desktop app (keys are stored in your OS keychain, not available in this browser preview).
          </div>
        )}
      </div>

      {/* database encryption */}
      {isDesktop && (
        <div className="card" style={{ padding: '20px 22px', marginBottom: 14 }}>
          <div className="card-title" style={{ fontSize: 15, marginBottom: 6 }}>Database encryption</div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)', maxWidth: 480, marginBottom: 14 }}>
            When enabled, your database file is AES-256 encrypted on disk whenever Ledger isn't running, and only
            decrypted after you enter your passphrase. It's plaintext on disk while the app is open (SQLite needs
            direct access), so this protects data at rest between sessions — not a live process. There's no
            password reset: losing the passphrase means restoring from a JSON backup instead.
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
            <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {encState?.encrypted ? 'Encryption is on' : 'Encryption is off'}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {encState?.encrypted ? (
                <>
                  <button className="btn-ghost" onClick={() => setEncModal('change')}>Change passphrase</button>
                  <button className="btn-ghost" style={{ color: 'var(--red)' }}
                    onClick={async () => {
                      if (!window.ledgerApi) return;
                      if (!confirm('Turn off database encryption? The file will stay plaintext on disk going forward.')) return;
                      await window.ledgerApi.securityDisable();
                      refreshEncryption();
                    }}>Disable</button>
                </>
              ) : (
                <button className="btn-ghost" onClick={() => setEncModal('enable')}>Enable…</button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* data & backup */}
      <div className="card" style={{ padding: '20px 22px' }}>
        <div className="card-title" style={{ fontSize: 15, marginBottom: 14 }}>Data &amp; backup</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn-ghost" onClick={exportCSV}>Export transactions (CSV)</button>
          <button className="btn-ghost" onClick={isDesktop ? backupDatabase : exportJSON}>
            {isDesktop ? 'Backup database (SQLite)' : 'Backup database (JSON)'}
          </button>
          {isDesktop && <button className="btn-ghost" onClick={exportJSON}>Export full backup (JSON)</button>}
          <button className="btn-ghost" onClick={restoreDatabase}>Restore…</button>
          <button className="btn-ghost" style={{ color: 'var(--red)' }}
            onClick={() => { if (confirm('Replace all data with fresh sample data?')) dispatch({ type: 'resetAll' }); }}>
            Reset to sample data
          </button>
          <input ref={fileRef} type="file" accept=".json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ''; }} />
        </div>
        {backupStatus && <div style={{ fontSize: 11.5, color: 'var(--green-conf)', marginTop: 10 }}>{backupStatus}</div>}
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 14 }}>
          {isDesktop && dbInfo
            ? <>Storage location · {dbInfo.path} · {state.transactions.length.toLocaleString()} transactions · {sizeKB} KB</>
            : <>Storage · browser local storage · {state.transactions.length.toLocaleString()} transactions · {sizeKB} KB</>}
        </div>
      </div>

      {editAccount && (
        <AccountModal account={editAccount} onClose={() => setEditAccount(null)}
          onSave={a => { dispatch({ type: 'updateAccount', account: a }); setEditAccount(null); }} />
      )}

      {keyModal && (
        <KeyModal provider={provider} onClose={() => setKeyModal(false)} onSaved={() => { setKeyModal(false); refreshApiKey(); }} />
      )}

      {encModal && (
        <EncryptionModal mode={encModal} onClose={() => setEncModal(null)} onDone={() => { setEncModal(null); refreshEncryption(); }} />
      )}
    </div>
  );
}

function AccountModal({ account, onClose, onSave }: { account: Account; onClose: () => void; onSave: (a: Account) => void }) {
  const [name, setName] = useState(account.name);
  const [bank, setBank] = useState(account.issuingBank);
  const [type, setType] = useState<AccountType>(account.accountType);
  const [last4, setLast4] = useState(account.lastFour ?? '');

  return (
    <Modal title="Edit account" onClose={onClose}
      footer={<><span /><button className="btn btn-lg" disabled={!name || !bank}
        onClick={() => onSave({ ...account, name, issuingBank: bank, accountType: type, lastFour: last4 || undefined })}>Save</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div>
          <label className="field">Nickname</label>
          <input className="input" style={{ width: '100%' }} value={name} onChange={e => setName(e.target.value)} />
        </div>
        <div>
          <label className="field">Issuing bank</label>
          <input className="input" style={{ width: '100%' }} value={bank} onChange={e => setBank(e.target.value)} />
        </div>
        <div>
          <label className="field">Account type</label>
          <select className="input" style={{ width: '100%' }} value={type} onChange={e => setType(e.target.value as AccountType)}>
            <option value="checking">Checking</option>
            <option value="credit_card">Credit card</option>
            <option value="savings">Savings</option>
            <option value="cash">Cash</option>
          </select>
        </div>
        <div>
          <label className="field">Last 4 digits (optional)</label>
          <input className="input" style={{ width: '100%' }} maxLength={4} value={last4} onChange={e => setLast4(e.target.value.replace(/\D/g, ''))} />
        </div>
      </div>
    </Modal>
  );
}

function KeyModal({ provider, onClose, onSaved }: { provider: AiProvider; onClose: () => void; onSaved: () => void }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const info = providerDef(provider);

  const save = async () => {
    if (!window.ledgerApi) return;
    setBusy(true);
    await window.ledgerApi.secretsSetApiKey(provider, key.trim());
    setBusy(false);
    onSaved();
  };
  const clear = async () => {
    if (!window.ledgerApi) return;
    setBusy(true);
    await window.ledgerApi.secretsClearApiKey(provider);
    setBusy(false);
    onSaved();
  };

  return (
    <Modal title={`${info.label} API key`} onClose={onClose}
      footer={<>
        <button className="btn-ghost" style={{ color: 'var(--red)' }} onClick={clear} disabled={busy}>Clear</button>
        <button className="btn btn-lg" onClick={save} disabled={busy || !key.trim()}>Save</button>
      </>}>
      <label className="field">API key</label>
      <input className="input" style={{ width: '100%' }} type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={info.keyPlaceholder} autoFocus />
      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 10 }}>
        Get a key at {info.keyUrl}. Stored in your OS keychain (Windows: DPAPI tied to your login; never written to the database, a JSON backup, or anywhere else in this app) and used directly from this device for merchant-name-only categorization calls.
      </div>
    </Modal>
  );
}

function EncryptionModal({ mode, onClose, onDone }: { mode: 'enable' | 'change'; onClose: () => void; onDone: () => void }) {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mismatch = confirmPass.length > 0 && passphrase !== confirmPass;
  const tooShort = passphrase.length > 0 && passphrase.length < 8;

  const save = async () => {
    if (!window.ledgerApi || passphrase.length < 8 || passphrase !== confirmPass) return;
    setBusy(true);
    setError(null);
    const result = mode === 'enable'
      ? await window.ledgerApi.securityEnable(passphrase)
      : await window.ledgerApi.securityChangePassphrase(passphrase);
    setBusy(false);
    if (result.ok) onDone();
    else setError(result.error ?? 'Something went wrong.');
  };

  return (
    <Modal title={mode === 'enable' ? 'Enable database encryption' : 'Change passphrase'} onClose={onClose}
      footer={<><span /><button className="btn btn-lg" disabled={busy || passphrase.length < 8 || mismatch} onClick={save}>
        {mode === 'enable' ? 'Enable' : 'Save'}
      </button></>}>
      <label className="field">Passphrase</label>
      <input className="input" style={{ width: '100%' }} type="password" autoFocus value={passphrase} onChange={e => setPassphrase(e.target.value)} placeholder="At least 8 characters" />
      {tooShort && <div style={{ fontSize: 11.5, color: 'var(--amber)', marginTop: 6 }}>At least 8 characters.</div>}
      <label className="field" style={{ marginTop: 12 }}>Confirm passphrase</label>
      <input className="input" style={{ width: '100%' }} type="password" value={confirmPass} onChange={e => setConfirmPass(e.target.value)} />
      {mismatch && <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 6 }}>Passphrases don't match.</div>}
      {error && <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 6 }}>{error}</div>}
      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 12 }}>
        Your database is encrypted the next time you quit Ledger, and decrypted with this passphrase the next time
        you open it. There's no recovery if you forget it — keep a JSON backup somewhere safe (Data &amp; backup, below).
      </div>
    </Modal>
  );
}
