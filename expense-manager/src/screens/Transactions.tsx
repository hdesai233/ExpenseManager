import { useMemo, useState } from 'react';
import { needsReview } from '../lib/categorize';
import { monthLabel, shortDate, signedUsd2, uid, usd2 } from '../lib/format';
import { accountName, categoryColor, txnCategoryLabel, useStore } from '../store';
import type { AppData, Transaction, TransactionSplit } from '../types';
import { ConfidenceBadge, CreditIcon, Modal, TransferIcon } from '../components/ui';

type Tab = 'all' | 'spending' | 'transfers' | 'review';

function resolveCategorySelection(state: AppData, value: string): { categoryId: string; subcategoryId: string | null } | null {
  const cat = state.categories.find(c => c.id === value);
  if (!cat) return null;
  return { categoryId: cat.parentId ?? cat.id, subcategoryId: cat.parentId ? cat.id : null };
}

export default function Transactions({ search }: { search: string }) {
  const { state, dispatch } = useStore();
  const [tab, setTab] = useState<Tab>('all');
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailTxn, setDetailTxn] = useState<Transaction | null>(null);
  const [bulkTag, setBulkTag] = useState('');

  const txns = useMemo(() => {
    let list = [...state.transactions].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    switch (tab) {
      case 'spending': list = list.filter(t => t.flowType === 'expense' || t.flowType === 'merchant_credit'); break;
      case 'transfers': list = list.filter(t => t.flowType === 'transfer'); break;
      case 'review': list = list.filter(needsReview); break;
    }
    const q = search.trim().toLowerCase();
    if (q) {
      list = list.filter(t =>
        t.merchantNormalized.toLowerCase().includes(q) ||
        t.merchantRaw.toLowerCase().includes(q) ||
        txnCategoryLabel(state, t).toLowerCase().includes(q) ||
        t.tags.some(tag => tag.toLowerCase().includes(q)) ||
        t.notes.toLowerCase().includes(q));
    }
    return list;
  }, [state, tab, search]);

  const visible = txns.slice(0, 400);
  const reviewCount = state.transactions.filter(needsReview).length;
  const latest = state.transactions.reduce((a, t) => t.date > a ? t.date : a, '0000-00-00');

  const subcatsOf = (parentId: string) => state.categories.filter(c => c.parentId === parentId);
  const topCats = state.categories.filter(c => !c.parentId);

  const applyCategory = (t: Transaction, value: string) => {
    const sel = resolveCategorySelection(state, value);
    if (!sel) return;
    dispatch({ type: 'categorize', txnIds: [t.id], categoryId: sel.categoryId, subcategoryId: sel.subcategoryId, learn: true });
    setEditing(null);
  };

  const toggleSelected = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allVisibleSelected = visible.length > 0 && visible.every(t => selected.has(t.id));
  const toggleSelectAll = () => {
    setSelected(allVisibleSelected ? new Set() : new Set(visible.map(t => t.id)));
  };

  const clearSelection = () => setSelected(new Set());

  const bulkCategorize = (value: string) => {
    const sel = resolveCategorySelection(state, value);
    if (!sel) return;
    const ids = visible.filter(t => selected.has(t.id) && t.flowType !== 'transfer').map(t => t.id);
    if (ids.length) dispatch({ type: 'categorize', txnIds: ids, categoryId: sel.categoryId, subcategoryId: sel.subcategoryId, learn: true });
    clearSelection();
  };

  const bulkDelete = () => {
    if (!confirm(`Delete ${selected.size} transaction${selected.size > 1 ? 's' : ''}? This can't be undone.`)) return;
    dispatch({ type: 'deleteTxns', txnIds: [...selected] });
    clearSelection();
  };

  const bulkAddTag = () => {
    const tag = bulkTag.trim();
    if (!tag || selected.size === 0) return;
    dispatch({ type: 'bulkAddTag', txnIds: [...selected], tag });
    setBulkTag('');
  };

  const cols = '28px 66px 1fr 178px 120px 116px 100px 34px';

  return (
    <div className="page">
      <div style={{ marginBottom: 18 }}>
        <div className="page-title">Transactions</div>
        <div className="page-sub">
          {state.transactions.length.toLocaleString()} transactions · {reviewCount} flagged for review · latest {latest !== '0000-00-00' ? monthLabel(latest.slice(0, 7)) : '—'}
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <div className="seg">
          {([['all', 'All'], ['spending', 'Spending'], ['transfers', 'Transfers']] as Array<[Tab, string]>).map(([k, label]) => (
            <button key={k} className={'seg-item' + (tab === k ? ' active' : '')} onClick={() => setTab(k)}>{label}</button>
          ))}
          <button className={'seg-item' + (tab === 'review' ? ' active' : '')} style={{ color: tab === 'review' ? 'var(--red)' : 'var(--red)' }} onClick={() => setTab('review')}>
            Needs review
            {reviewCount > 0 && <span style={{ fontSize: 10, fontWeight: 700, background: 'var(--red-bg)', padding: '1px 6px', borderRadius: 20 }}>{reviewCount}</span>}
          </button>
        </div>
        {search && <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--muted)' }}>Filtering by “{search}”</span>}
      </div>

      {selected.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, padding: '9px 14px',
          background: '#eaf3ee', border: '1px solid #cfe3d8', borderRadius: 10,
        }}>
          <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--green)' }}>{selected.size} selected</span>
          <select className="input" style={{ fontSize: 12, padding: '5px 8px' }} defaultValue=""
            onChange={e => { if (e.target.value) bulkCategorize(e.target.value); e.target.value = ''; }}>
            <option value="" disabled>Categorize as…</option>
            {topCats.map(c => (
              <optgroup key={c.id} label={c.name}>
                <option value={c.id}>{c.name}</option>
                {subcatsOf(c.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
          <input className="input" style={{ fontSize: 12, padding: '5px 8px', width: 130 }} placeholder="Add tag…"
            value={bulkTag} onChange={e => setBulkTag(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') bulkAddTag(); }} />
          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: 12 }} onClick={bulkAddTag}>Add tag</button>
          <button className="btn-ghost" style={{ padding: '5px 10px', fontSize: 12, color: 'var(--red)' }} onClick={bulkDelete}>Delete</button>
          <button className="link-sm" style={{ marginLeft: 'auto', fontSize: 12 }} onClick={clearSelection}>Clear</button>
        </div>
      )}

      <div style={{ background: '#fff', border: '1px solid var(--card-border)', borderRadius: 14, overflow: 'hidden' }}>
        <div className="thead" style={{ display: 'grid', gridTemplateColumns: cols, alignItems: 'center' }}>
          <div>
            <input type="checkbox" checked={allVisibleSelected} onChange={toggleSelectAll}
              style={{ width: 14, height: 14, cursor: 'pointer' }} title="Select all visible" />
          </div>
          <div>Date</div><div>Merchant</div><div>Category</div><div>Account</div><div>Confidence</div><div style={{ textAlign: 'right' }}>Amount</div><div />
        </div>
        {txns.length === 0 && (
          <div style={{ padding: '28px 16px', textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>No transactions match.</div>
        )}
        {visible.map(t => {
          const flagged = needsReview(t);
          const isSplit = !!(t.splits && t.splits.length > 1);
          return (
            <div key={t.id} className="trow" style={{
              display: 'grid', gridTemplateColumns: cols, alignItems: 'center',
              background: flagged ? '#fcf6ee' : t.flowType === 'transfer' ? 'var(--soft)' : '#fff',
            }}>
              <div>
                <input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSelected(t.id)}
                  style={{ width: 14, height: 14, cursor: 'pointer' }} />
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{shortDate(t.date)}</div>
              <div style={{ minWidth: 0, paddingRight: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  {t.flowType === 'transfer' && <TransferIcon />}
                  {t.flowType === 'merchant_credit' && <CreditIcon />}
                  <span className="ellip" style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink-2)' }}>{t.merchantNormalized}</span>
                  {flagged && <span className="tag-badge" style={{ color: 'var(--amber)', background: 'var(--amber-bg)', flex: 'none' }}>REVIEW</span>}
                  {t.notes && <span title={t.notes} style={{ flex: 'none', color: 'var(--muted-2)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 4h16v12H8l-4 4z" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>}
                  {t.tags.map(tag => <span key={tag} className="tag-badge" style={{ color: 'var(--blue)', background: 'var(--blue-bg)', flex: 'none' }}>{tag}</span>)}
                </div>
                <div className="raw-desc" style={{ marginTop: 2 }}>{t.merchantRaw}</div>
              </div>
              <div>
                {t.flowType === 'transfer' ? (
                  <span className="chip" style={{ color: '#9b968c' }}>
                    <span className="dot" style={{ width: 7, height: 7, background: '#b6b2a8' }} />
                    {txnCategoryLabel(state, t)}
                  </span>
                ) : isSplit ? (
                  <button className="chip clickable" title="Edit split" onClick={() => setDetailTxn(t)} style={{ border: 'none' }}>
                    <span className="dot" style={{ width: 7, height: 7, background: '#b6b2a8' }} />
                    <span className="ellip">{txnCategoryLabel(state, t)}</span>
                  </button>
                ) : editing === t.id ? (
                  <select
                    className="input" autoFocus
                    style={{ fontSize: 12, padding: '3px 6px', maxWidth: 165 }}
                    defaultValue={t.subcategoryId ?? t.categoryId ?? ''}
                    onBlur={() => setEditing(null)}
                    onChange={e => applyCategory(t, e.target.value)}
                  >
                    <option value="">Choose…</option>
                    {topCats.map(c => (
                      <optgroup key={c.id} label={c.name}>
                        <option value={c.id}>{c.name}</option>
                        {subcatsOf(c.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </optgroup>
                    ))}
                  </select>
                ) : (
                  <button className="chip clickable" title="Click to change category" onClick={() => setEditing(t.id)} style={{ border: 'none' }}>
                    <span className="dot" style={{ width: 7, height: 7, background: categoryColor(state, t.categoryId) }} />
                    <span className="ellip">{txnCategoryLabel(state, t)}</span>
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)' }}>{accountName(state, t.accountId)}</div>
              <div><ConfidenceBadge t={t} /></div>
              <div style={{ textAlign: 'right', fontSize: 13.5, fontWeight: 600, color: t.flowType === 'transfer' ? '#9b968c' : t.amount > 0 ? 'var(--green-ok)' : 'var(--ink)' }}>
                {signedUsd2(t.amount)}
              </div>
              <div style={{ textAlign: 'right' }}>
                <button title="Edit transaction" onClick={() => setDetailTxn(t)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--muted-2)', padding: 4, display: 'inline-flex' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
                </button>
              </div>
            </div>
          );
        })}
        {txns.length > 400 && (
          <div style={{ padding: '10px 16px', fontSize: 12, color: 'var(--muted-2)' }}>Showing first 400 of {txns.length.toLocaleString()} — refine your search to narrow down.</div>
        )}
      </div>

      {detailTxn && (
        <TransactionModal
          txn={state.transactions.find(t => t.id === detailTxn.id) ?? detailTxn}
          onClose={() => setDetailTxn(null)}
        />
      )}
    </div>
  );
}

function TransactionModal({ txn, onClose }: { txn: Transaction; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const topCats = state.categories.filter(c => !c.parentId);
  const subcatsOf = (parentId: string) => state.categories.filter(c => c.parentId === parentId);
  const isTransfer = txn.flowType === 'transfer';

  const [splitMode, setSplitMode] = useState(!!(txn.splits && txn.splits.length > 1));
  const [splits, setSplits] = useState<TransactionSplit[]>(
    txn.splits && txn.splits.length > 1 ? txn.splits : [
      { id: uid(), categoryId: txn.categoryId ?? '', subcategoryId: txn.subcategoryId, amount: txn.amount, notes: '' },
      { id: uid(), categoryId: '', subcategoryId: null, amount: 0, notes: '' },
    ],
  );
  const [singleValue, setSingleValue] = useState(txn.subcategoryId ?? txn.categoryId ?? '');
  const [tags, setTags] = useState<string[]>(txn.tags);
  const [tagInput, setTagInput] = useState('');
  const [notes, setNotes] = useState(txn.notes);

  const allocated = splits.reduce((a, s) => a + s.amount, 0);
  const remaining = Math.round((txn.amount - allocated) * 100) / 100;
  const splitsValid = splits.length >= 2 && splits.every(s => s.categoryId) && Math.abs(remaining) < 0.005;

  const updateSplit = (id: string, patch: Partial<TransactionSplit>) => {
    setSplits(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
  };
  const setSplitCategory = (id: string, value: string) => {
    const sel = resolveCategorySelection(state, value);
    updateSplit(id, { categoryId: sel?.categoryId ?? '', subcategoryId: sel?.subcategoryId ?? null });
  };
  const addSplitRow = () => setSplits(prev => [...prev, { id: uid(), categoryId: '', subcategoryId: null, amount: remaining, notes: '' }]);
  const removeSplitRow = (id: string) => setSplits(prev => prev.length > 2 ? prev.filter(s => s.id !== id) : prev);

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput('');
  };
  const removeTag = (t: string) => setTags(prev => prev.filter(x => x !== t));

  const save = () => {
    if (splitMode) {
      if (!splitsValid) return;
      dispatch({
        type: 'updateTxn', txnId: txn.id,
        patch: { splits, categoryId: null, subcategoryId: null, tags, notes, confidence: 1, categorizationSource: 'manual', reviewed: true },
      });
    } else {
      const sel = resolveCategorySelection(state, singleValue);
      dispatch({
        type: 'updateTxn', txnId: txn.id,
        patch: {
          splits: undefined,
          categoryId: sel ? sel.categoryId : txn.categoryId,
          subcategoryId: sel ? sel.subcategoryId : txn.subcategoryId,
          tags, notes,
          confidence: sel ? 1 : txn.confidence,
          categorizationSource: sel ? 'manual' : txn.categorizationSource,
          reviewed: true,
        },
      });
    }
    onClose();
  };

  const del = () => {
    if (confirm(`Delete this transaction from ${txn.merchantNormalized}? This can't be undone.`)) {
      dispatch({ type: 'deleteTxns', txnIds: [txn.id] });
      onClose();
    }
  };

  return (
    <Modal
      wide
      title={
        <div>
          <div>{txn.merchantNormalized}</div>
          <div style={{ fontSize: 11.5, fontWeight: 400, color: 'var(--muted-2)', marginTop: 2 }}>
            {shortDate(txn.date)} · {accountName(state, txn.accountId)} · <span className="mono">{txn.merchantRaw}</span>
          </div>
        </div>
      }
      onClose={onClose}
      footer={
        <>
          <button className="btn-ghost" style={{ color: 'var(--red)' }} onClick={del}>Delete transaction</button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-lg" disabled={splitMode ? !splitsValid : (!isTransfer && !singleValue)} onClick={save}>Save</button>
          </div>
        </>
      }
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 18 }}>
        <span style={{ fontSize: 24, fontWeight: 300, color: txn.amount > 0 ? 'var(--green-ok)' : 'var(--ink)' }}>{signedUsd2(txn.amount)}</span>
        {isTransfer && <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>Card payments and transfers can't be categorized or split — they're excluded from spend.</span>}
      </div>

      {!isTransfer && (
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <label className="field" style={{ marginBottom: 0 }}>Category</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-3)', cursor: 'pointer' }}>
              <input type="checkbox" checked={splitMode} onChange={e => setSplitMode(e.target.checked)} />
              Split into multiple categories
            </label>
          </div>

          {!splitMode ? (
            <select className="input" style={{ width: '100%' }} value={singleValue} onChange={e => setSingleValue(e.target.value)}>
              <option value="">Choose…</option>
              {topCats.map(c => (
                <optgroup key={c.id} label={c.name}>
                  <option value={c.id}>{c.name}</option>
                  {subcatsOf(c.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
              ))}
            </select>
          ) : (
            <div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {splits.map(s => (
                  <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 28px', gap: 8, alignItems: 'center' }}>
                    <select className="input" value={s.subcategoryId ?? s.categoryId} onChange={e => setSplitCategory(s.id, e.target.value)}>
                      <option value="">Choose category…</option>
                      {topCats.map(c => (
                        <optgroup key={c.id} label={c.name}>
                          <option value={c.id}>{c.name}</option>
                          {subcatsOf(c.id).map(sc => <option key={sc.id} value={sc.id}>{sc.name}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <input className="input" type="number" step="0.01" value={s.amount}
                      onChange={e => updateSplit(s.id, { amount: parseFloat(e.target.value) || 0 })} />
                    <button onClick={() => removeSplitRow(s.id)} disabled={splits.length <= 2}
                      style={{ border: 'none', background: 'none', cursor: splits.length > 2 ? 'pointer' : 'default', opacity: splits.length > 2 ? 1 : .3, color: 'var(--red)', fontSize: 16, lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                <button className="link-sm" onClick={addSplitRow}>+ Add split</button>
                <span style={{ fontSize: 12, fontWeight: 600, color: Math.abs(remaining) < 0.005 ? 'var(--green-conf)' : 'var(--red)' }}>
                  {Math.abs(remaining) < 0.005 ? 'Fully allocated' : `${usd2(remaining)} remaining`}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginBottom: 20 }}>
        <label className="field">Tags</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
          {tags.map(t => (
            <span key={t} className="tag-badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: 'var(--blue)', background: 'var(--blue-bg)', padding: '4px 8px' }}>
              {t}
              <button onClick={() => removeTag(t)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--blue)', fontSize: 12, lineHeight: 1, padding: 0 }}>×</button>
            </span>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input className="input" style={{ flex: 1 }} placeholder="e.g. Japan Trip 2026" value={tagInput}
            onChange={e => setTagInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }} />
          <button className="btn-ghost" onClick={addTag}>Add</button>
        </div>
      </div>

      <div>
        <label className="field">Notes</label>
        <textarea className="input" style={{ width: '100%', minHeight: 70, resize: 'vertical', fontFamily: 'inherit' }}
          value={notes} onChange={e => setNotes(e.target.value)} placeholder="Free-text notes…" />
      </div>
    </Modal>
  );
}
