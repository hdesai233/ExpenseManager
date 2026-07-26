import { useMemo, useState } from 'react';
import { buildPreview, guessMapping, parseFile, type ParsedFile } from '../lib/importer';
import { ingestRows } from '../lib/ingest';
import { uid, usd2 } from '../lib/format';
import { useStore } from '../store';
import type { Account, AccountType, ColumnMapping, ImportProfile } from '../types';
import { Modal } from '../components/ui';

const ACCOUNT_COLORS = ['#1f6f5c', '#4a9d86', '#5a7f9c', '#c8892b', '#7c6f9c', '#b0736a'];

export default function ImportWizard({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [filename, setFilename] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);

  // account step
  const [accountId, setAccountId] = useState<string>('');
  const [newNick, setNewNick] = useState('');
  const [newBank, setNewBank] = useState('');
  const [newType, setNewType] = useState<AccountType>('credit_card');
  const [newLast4, setNewLast4] = useState('');

  // mapping step
  const [mapping, setMapping] = useState<ColumnMapping>({ date: '', description: '', amount: '' });
  const [flipSign, setFlipSign] = useState(false);
  const [saveProfile, setSaveProfile] = useState(true);

  const isNewAccount = accountId === '__new__';
  const resolvedAccountId = isNewAccount ? 'acct-' + uid() : accountId;

  const handleFile = async (file: File) => {
    setParseError(null);
    try {
      const p = await parseFile(file);
      if (!p.headers.length || !p.rows.length) { setParseError('No rows found in that file.'); return; }
      setParsed(p);
      setFilename(file.name);
      setStep(2);
    } catch (e) {
      setParseError('Could not parse file: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const proceedToMapping = () => {
    const profile = state.profiles.find(p => p.accountId === accountId);
    if (profile) {
      setMapping(profile.mapping);
      setFlipSign(profile.flipSign);
    } else if (parsed) {
      setMapping(guessMapping(parsed.headers));
    }
    setStep(3);
  };

  const [account, setAccount] = useState<Account | null>(null);
  const proceedToPreview = () => {
    if (isNewAccount) {
      setAccount({
        id: resolvedAccountId,
        name: newNick.trim(),
        issuingBank: newBank.trim(),
        accountType: newType,
        lastFour: newLast4 || undefined,
        color: ACCOUNT_COLORS[state.accounts.length % ACCOUNT_COLORS.length],
      });
    } else {
      setAccount(state.accounts.find(a => a.id === accountId) ?? null);
    }
    setStep(4);
  };

  const preview = useMemo(() => {
    if (!parsed || !account) return [];
    return buildPreview(parsed.rows, mapping, flipSign, state.transactions, account.id);
  }, [parsed, mapping, flipSign, state.transactions, account]);

  const valid = preview.filter(r => !r.error && !r.duplicate);
  const dupes = preview.filter(r => r.duplicate).length;
  const errors = preview.filter(r => r.error && r.error !== 'Empty row').length;
  const possibleDupes = preview.filter(r => r.possibleDuplicate).length;

  const commit = () => {
    if (!account || valid.length === 0) return;
    const batchId = uid();
    const allAccounts = state.accounts.some(a => a.id === account.id) ? state.accounts : [...state.accounts, account];
    const txns = ingestRows(
      valid.map(r => ({ date: r.date!, merchantRaw: r.merchantRaw, amount: r.amount!, accountId: account.id })),
      allAccounts, state.rules, state.transactions, batchId,
    );
    const profile: ImportProfile | undefined = saveProfile ? {
      id: 'profile-' + account.id,
      name: `${account.name} (${filename.split('.').pop()?.toUpperCase()})`,
      accountId: account.id,
      mapping,
      flipSign,
    } : undefined;
    dispatch({
      type: 'importCommit',
      transactions: txns,
      batch: { id: batchId, accountId: account.id, sourceFilename: filename, importedAt: new Date().toISOString(), rowCount: txns.length, profileId: profile?.id ?? null },
      account: state.accounts.some(a => a.id === account.id) ? undefined : account,
      profile,
    });
    onClose();
  };

  const pairedCount = useMemo(() => {
    // rough count of likely transfer pairs in the preview (description-based)
    return valid.filter(r => /PAYMENT|AUTOPAY|TRANSFER|PMT/i.test(r.merchantRaw)).length;
  }, [valid]);

  const stepTitles = ['Upload file', 'Choose account', 'Map columns', 'Preview & confirm'];

  return (
    <Modal wide title={
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        Import transactions
        <span style={{ fontSize: 11.5, fontWeight: 500, color: 'var(--muted-2)' }}>Step {step} of 4 · {stepTitles[step - 1]}</span>
      </div>
    } onClose={onClose}
      footer={
        <>
          <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>
            {step === 4 && `${valid.length} rows ready · ${dupes} duplicates skipped · ${errors} invalid`}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {step > 1 && <button className="btn-ghost" onClick={() => setStep(s => (s - 1) as 1 | 2 | 3)}>Back</button>}
            {step === 2 && (
              <button className="btn btn-lg" disabled={!accountId || (isNewAccount && (!newNick.trim() || !newBank.trim()))} onClick={proceedToMapping}>
                Continue
              </button>
            )}
            {step === 3 && (
              <button className="btn btn-lg" disabled={!mapping.date || !mapping.description || (!mapping.amount && !(mapping.debit && mapping.credit))} onClick={proceedToPreview}>
                Preview
              </button>
            )}
            {step === 4 && <button className="btn btn-lg" disabled={valid.length === 0} onClick={commit}>Import {valid.length} transactions</button>}
          </div>
        </>
      }>

      {step === 1 && (
        <div>
          <label
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10,
              border: '2px dashed var(--border)', borderRadius: 12, padding: '46px 20px', cursor: 'pointer', background: 'var(--soft)',
            }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#a09c92" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 16V4" /><path d="M8 8l4-4 4 4" /><path d="M4 20h16" /></svg>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink-3)' }}>Drop a bank export here, or click to browse</div>
            <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>.csv, .xls, and .xlsx exports from any bank or card</div>
            <input type="file" accept=".csv,.xls,.xlsx" style={{ display: 'none' }}
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ''; }} />
          </label>
          {parseError && <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--red)' }}>{parseError}</div>}
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 14 }}>
            Files are parsed entirely on this device. Nothing is uploaded anywhere.
          </div>
        </div>
      )}

      {step === 2 && (
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
            <strong style={{ color: 'var(--ink-3)' }}>{filename}</strong> · {parsed?.rows.length} rows · which account is this export from?
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {state.accounts.map(a => (
              <label key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', border: '1px solid ' + (accountId === a.id ? 'var(--green-2)' : 'var(--card-border)'), borderRadius: 10, cursor: 'pointer', background: accountId === a.id ? '#f2f7f4' : '#fff' }}>
                <input type="radio" name="acct" checked={accountId === a.id} onChange={() => setAccountId(a.id)} />
                <span className="dot" style={{ width: 10, height: 10, background: a.color }} />
                <span style={{ fontSize: 13.5, fontWeight: 500 }}>{a.name}</span>
                <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>{a.issuingBank} · {a.accountType.replace('_', ' ')}{a.lastFour ? ` · ••${a.lastFour}` : ''}</span>
                {state.profiles.some(p => p.accountId === a.id) && <span className="tag-badge" style={{ marginLeft: 'auto', color: 'var(--green-conf)', background: 'var(--green-bg)' }}>SAVED PROFILE</span>}
              </label>
            ))}
            <label style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', border: '1px solid ' + (isNewAccount ? 'var(--green-2)' : 'var(--card-border)'), borderRadius: 10, cursor: 'pointer', background: isNewAccount ? '#f2f7f4' : '#fff' }}>
              <input type="radio" name="acct" checked={isNewAccount} onChange={() => setAccountId('__new__')} />
              <span style={{ fontSize: 13.5, fontWeight: 500 }}>New account…</span>
            </label>
          </div>
          {isNewAccount && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14, padding: '14px 14px', background: 'var(--soft)', borderRadius: 10, border: '1px solid var(--soft-border)' }}>
              <div>
                <label className="field">Account nickname</label>
                <input className="input" style={{ width: '100%' }} value={newNick} onChange={e => setNewNick(e.target.value)} placeholder="e.g. Chase Sapphire" />
              </div>
              <div>
                <label className="field">Issuing bank / institution</label>
                <input className="input" style={{ width: '100%' }} value={newBank} onChange={e => setNewBank(e.target.value)} placeholder="e.g. Chase" />
              </div>
              <div>
                <label className="field">Account type</label>
                <select className="input" style={{ width: '100%' }} value={newType} onChange={e => setNewType(e.target.value as AccountType)}>
                  <option value="credit_card">Credit card</option>
                  <option value="checking">Checking</option>
                  <option value="savings">Savings</option>
                  <option value="cash">Cash</option>
                </select>
              </div>
              <div>
                <label className="field">Last 4 digits (optional)</label>
                <input className="input" style={{ width: '100%' }} maxLength={4} value={newLast4} onChange={e => setNewLast4(e.target.value.replace(/\D/g, ''))} />
              </div>
              <div style={{ gridColumn: '1 / -1', fontSize: 11.5, color: 'var(--muted-2)' }}>
                The issuing bank helps detect credit-card payments ("CHASE CARD PAYMENT") so they're excluded from spending totals.
              </div>
            </div>
          )}
        </div>
      )}

      {step === 3 && parsed && (
        <div>
          <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
            Map your bank's columns to standard fields. {state.profiles.some(p => p.accountId === accountId) ? 'Loaded from your saved profile.' : 'We guessed from the headers — adjust if needed.'}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <MapSelect label="Date" required headers={parsed.headers} value={mapping.date} onChange={v => setMapping(m => ({ ...m, date: v }))} />
            <MapSelect label="Description / merchant" required headers={parsed.headers} value={mapping.description} onChange={v => setMapping(m => ({ ...m, description: v }))} />
            <MapSelect label="Amount (single column)" headers={parsed.headers} value={mapping.amount} onChange={v => setMapping(m => ({ ...m, amount: v }))} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <MapSelect label="…or Debit column" headers={parsed.headers} value={mapping.debit ?? ''} onChange={v => setMapping(m => ({ ...m, debit: v || undefined }))} />
              <MapSelect label="Credit column" headers={parsed.headers} value={mapping.credit ?? ''} onChange={v => setMapping(m => ({ ...m, credit: v || undefined }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 22, marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-3)', cursor: 'pointer' }}>
              <input type="checkbox" checked={flipSign} onChange={e => setFlipSign(e.target.checked)} />
              Flip signs (this export shows purchases as positive)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--ink-3)', cursor: 'pointer' }}>
              <input type="checkbox" checked={saveProfile} onChange={e => setSaveProfile(e.target.checked)} />
              Remember this mapping as the profile for this account
            </label>
          </div>
          <div style={{ marginTop: 16, border: '1px solid var(--card-border)', borderRadius: 10, overflow: 'auto', maxHeight: 200 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 11.5 }}>
              <thead>
                <tr>{parsed.headers.map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '7px 10px', background: 'var(--soft)', borderBottom: '1px solid var(--soft-border)', color: 'var(--muted-3)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {parsed.rows.slice(0, 5).map((r, i) => (
                  <tr key={i}>{parsed.headers.map(h => (
                    <td key={h} style={{ padding: '6px 10px', borderBottom: '1px solid var(--row-border)', color: '#5c584f', whiteSpace: 'nowrap' }}>{r[h]}</td>
                  ))}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {step === 4 && account && (
        <div>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <span className="chip" style={{ background: 'var(--green-bg)', color: 'var(--green-conf)', fontWeight: 600 }}>{valid.length} ready to import</span>
            {dupes > 0 && <span className="chip" style={{ background: 'var(--amber-bg)', color: 'var(--amber)', fontWeight: 600 }}>{dupes} duplicates will be skipped</span>}
            {errors > 0 && <span className="chip" style={{ background: 'var(--red-bg)', color: 'var(--red)', fontWeight: 600 }}>{errors} rows couldn't be parsed</span>}
            {possibleDupes > 0 && <span className="chip" style={{ background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>{possibleDupes} look like possible duplicates — double-check before importing</span>}
            {pairedCount > 0 && <span className="chip" style={{ background: 'var(--blue-bg)', color: 'var(--blue)', fontWeight: 600 }}>{pairedCount} look like payments/transfers — they'll be excluded from spending</span>}
          </div>
          <div style={{ border: '1px solid var(--card-border)', borderRadius: 10, overflow: 'auto', maxHeight: 320 }}>
            <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
              <thead>
                <tr>
                  {['', 'Date', 'Merchant (normalized)', 'Raw description', 'Amount'].map((h, i) => (
                    <th key={i} style={{ textAlign: i === 4 ? 'right' : 'left', padding: '7px 10px', background: 'var(--soft)', borderBottom: '1px solid var(--soft-border)', color: 'var(--muted-3)', fontWeight: 600, position: 'sticky', top: 0 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {preview.filter(r => r.error !== 'Empty row').slice(0, 200).map(r => (
                  <tr key={r.index} style={{ opacity: r.error || r.duplicate ? .5 : 1 }}>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--row-border)', width: 70 }}>
                      {r.error ? <span className="tag-badge" style={{ color: 'var(--red)', background: 'var(--red-bg)' }}>ERROR</span>
                        : r.duplicate ? <span className="tag-badge" style={{ color: 'var(--amber)', background: 'var(--amber-bg)' }}>DUPE</span>
                        : r.possibleDuplicate ? <span className="tag-badge" style={{ color: 'var(--blue)', background: 'var(--blue-bg)' }}>MAYBE DUP</span>
                        : <span className="tag-badge" style={{ color: 'var(--green-conf)', background: 'var(--green-bg)' }}>OK</span>}
                    </td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--row-border)', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.date ?? '—'}</td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--row-border)', fontWeight: 500, color: 'var(--ink-3)' }}>{r.merchantNormalized || '—'}</td>
                    <td className="mono" style={{ padding: '6px 10px', borderBottom: '1px solid var(--row-border)', color: 'var(--faint)', fontSize: 10.5, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {r.merchantRaw}{r.error ? ` · ${r.error}` : ''}
                    </td>
                    <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--row-border)', textAlign: 'right', fontWeight: 600, color: (r.amount ?? 0) > 0 ? 'var(--green-ok)' : 'var(--ink)', whiteSpace: 'nowrap' }}>
                      {r.amount !== null ? usd2(r.amount) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 12 }}>
            Importing into <strong>{account.name}</strong>. Rows are categorized by your rules on import; anything unmatched lands in the review queue. Cross-account payment legs are linked automatically.
          </div>
        </div>
      )}
    </Modal>
  );
}

function MapSelect({ label, required, headers, value, onChange }: {
  label: string; required?: boolean; headers: string[]; value: string; onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="field">{label}{required && ' *'}</label>
      <select className="input" style={{ width: '100%' }} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">—</option>
        {headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
}
