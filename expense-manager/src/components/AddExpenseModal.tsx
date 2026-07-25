import { useState } from 'react';
import { todayISO, usd2 } from '../lib/format';
import { useStore } from '../store';
import { Modal } from './ui';

// ---- Manual expense entry ----
// For spending that never reaches a statement — cash, splitting a bill with a friend, an IOU.
// Everything here is entered by the user, so it lands fully categorized and already reviewed.

export default function AddExpenseModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();

  const cashAccount = state.accounts.find(a => a.accountType === 'cash');
  const [date, setDate] = useState(todayISO());
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [catValue, setCatValue] = useState('');
  const [accountId, setAccountId] = useState<string>(cashAccount?.id ?? '');
  const [tagText, setTagText] = useState('');
  const [notes, setNotes] = useState('');
  const [addedCount, setAddedCount] = useState(0);

  const topCats = state.categories.filter(c => !c.parentId);
  const numericAmount = Number(amount);
  const amountValid = amount.trim() !== '' && Number.isFinite(numericAmount) && numericAmount > 0;
  const canSave = description.trim() !== '' && amountValid && date !== '';

  const save = (keepOpen: boolean) => {
    if (!canSave) return;
    const cat = state.categories.find(c => c.id === catValue);
    dispatch({
      type: 'addManualExpense',
      expense: {
        date,
        description,
        amount: numericAmount,
        categoryId: cat ? (cat.parentId ?? cat.id) : null,
        subcategoryId: cat?.parentId ? cat.id : null,
        accountId: accountId || null,
        tags: tagText.split(',').map(t => t.trim()).filter(Boolean),
        notes: notes.trim(),
      },
    });

    if (!keepOpen) { onClose(); return; }
    // Keep the date, category and account — entering a stack of receipts usually shares them.
    setDescription('');
    setAmount('');
    setTagText('');
    setNotes('');
    setAddedCount(n => n + 1);
  };

  return (
    <Modal
      title="Add expense"
      onClose={onClose}
      footer={
        <>
          <span style={{ fontSize: 11.5, color: 'var(--green-conf)' }}>
            {addedCount > 0 && `Added ${addedCount} expense${addedCount === 1 ? '' : 's'}`}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" disabled={!canSave} onClick={() => save(true)}>Save &amp; add another</button>
            <button className="btn btn-lg" disabled={!canSave} onClick={() => save(false)}>Save</button>
          </div>
        </>
      }
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 14 }}>
        <div>
          <label className="field">What was it for</label>
          <input
            className="input" style={{ width: '100%' }} autoFocus value={description}
            onChange={e => setDescription(e.target.value)}
            placeholder="e.g. Farmers market"
            onKeyDown={e => { if (e.key === 'Enter' && canSave) save(false); }}
          />
        </div>
        <div>
          <label className="field">Amount</label>
          <input
            className="input" style={{ width: '100%' }} type="number" min="0" step="0.01" inputMode="decimal"
            value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
            onKeyDown={e => { if (e.key === 'Enter' && canSave) save(false); }}
          />
        </div>

        <div>
          <label className="field">Category</label>
          <select className="input" style={{ width: '100%' }} value={catValue} onChange={e => setCatValue(e.target.value)}>
            <option value="">Uncategorized</option>
            {topCats.map(c => (
              <optgroup key={c.id} label={c.name}>
                <option value={c.id}>{c.name}</option>
                {state.categories.filter(s => s.parentId === c.id).map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div>
          <label className="field">Date</label>
          <input className="input" style={{ width: '100%' }} type="date" max={todayISO()} value={date} onChange={e => setDate(e.target.value)} />
        </div>

        <div>
          <label className="field">Paid with</label>
          <select className="input" style={{ width: '100%' }} value={accountId} onChange={e => setAccountId(e.target.value)}>
            <option value="">{cashAccount ? cashAccount.name : 'Cash (will be created)'}</option>
            {state.accounts.filter(a => a.id !== cashAccount?.id).map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="field">Tags (optional)</label>
          <input className="input" style={{ width: '100%' }} value={tagText} onChange={e => setTagText(e.target.value)} placeholder="comma, separated" />
        </div>

        <div style={{ gridColumn: '1 / -1' }}>
          <label className="field">Notes (optional)</label>
          <input className="input" style={{ width: '100%' }} value={notes} onChange={e => setNotes(e.target.value)} />
        </div>
      </div>

      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 12 }}>
        {amountValid
          ? <>Recorded as <strong>{usd2(-numericAmount)}</strong> — counts toward your spending like any imported charge.</>
          : 'Enter the amount you spent as a positive number.'}
      </div>
    </Modal>
  );
}
