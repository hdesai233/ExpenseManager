import { useState } from 'react';
import { useStore } from '../store';
import { isSpend } from '../lib/analytics';
import { categoryNameTaken, categoryUsage, isProtectedCategory, type CategoryUsage } from '../lib/categoryOps';
import { Modal } from '../components/ui';
import type { Category, MatchType } from '../types';

const SWATCHES = ['#1f6f5c', '#4a9d86', '#86b8a5', '#5a7f9c', '#c8892b', '#d9a441', '#7c6f9c', '#b0736a', '#9aa06b', '#cdc7bb'];

type ModalState =
  | { kind: 'add'; parentId: string | null }
  | { kind: 'edit'; category: Category }
  | { kind: 'delete'; category: Category }
  | { kind: 'merge'; category: Category }
  | null;

export default function Categories() {
  const { state, dispatch } = useStore();
  const [ruleModal, setRuleModal] = useState(false);
  const [modal, setModal] = useState<ModalState>(null);

  const topCats = state.categories.filter(c => !c.parentId);
  const countByCat = new Map<string, number>();
  for (const t of state.transactions) {
    if (!isSpend(t) || !t.categoryId) continue;
    countByCat.set(t.categoryId, (countByCat.get(t.categoryId) ?? 0) + 1);
    if (t.subcategoryId) countByCat.set(t.subcategoryId, (countByCat.get(t.subcategoryId) ?? 0) + 1);
  }

  const catLabel = (categoryId: string, subcategoryId: string | null) => {
    const sub = subcategoryId ? state.categories.find(c => c.id === subcategoryId) : null;
    const cat = state.categories.find(c => c.id === categoryId);
    return sub?.name ?? cat?.name ?? categoryId;
  };

  return (
    <div className="page">
      <div style={{ marginBottom: 18 }}>
        <div className="page-title">Categories &amp; Rules</div>
        <div className="page-sub">Add, rename, merge, or delete categories and subcategories — mark "Tax" to include one in Reports &amp; Export's tax-relevant export</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 14 }}>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div className="card-title" style={{ fontSize: 15 }}>Categories</div>
            <button className="link-sm" onClick={() => setModal({ kind: 'add', parentId: null })}>+ New category</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, maxHeight: 620, overflowY: 'auto' }}>
            {topCats.map(c => {
              const subs = state.categories.filter(s => s.parentId === c.id);
              return (
                <div key={c.id}>
                  <CategoryRow
                    category={c} count={countByCat.get(c.id) ?? 0}
                    onAddSub={() => setModal({ kind: 'add', parentId: c.id })}
                    onEdit={() => setModal({ kind: 'edit', category: c })}
                    onMerge={() => setModal({ kind: 'merge', category: c })}
                    onDelete={() => setModal({ kind: 'delete', category: c })}
                    onToggleTax={v => dispatch({ type: 'setTaxDeductible', categoryId: c.id, taxDeductible: v })}
                  />
                  {subs.map(s => (
                    <CategoryRow
                      key={s.id} category={s} count={countByCat.get(s.id) ?? 0} indent
                      onEdit={() => setModal({ kind: 'edit', category: s })}
                      onMerge={() => setModal({ kind: 'merge', category: s })}
                      onDelete={() => setModal({ kind: 'delete', category: s })}
                      onToggleTax={v => dispatch({ type: 'setTaxDeductible', categoryId: s.id, taxDeductible: v })}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>

        <div className="card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div className="card-title" style={{ fontSize: 15 }}>Auto-categorization rules</div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{state.rules.length} active</span>
              <button className="link-sm" onClick={() => setRuleModal(true)}>+ New rule</button>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 560, overflowY: 'auto' }}>
            {[...state.rules].reverse().map(r => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', background: 'var(--soft)', border: '1px solid #f0ece4', borderRadius: 10 }}>
                <span className="mono ellip" style={{ fontSize: 11.5, color: '#6b6862', background: '#fff', border: '1px solid var(--soft-border)', padding: '3px 8px', borderRadius: 6, maxWidth: 180 }}>{r.merchantPattern}</span>
                <span style={{ fontSize: 10.5, color: 'var(--faint)', flex: 'none' }}>{r.matchType}</span>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c2bdb2" strokeWidth="2" style={{ flex: 'none' }}><path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span className="ellip" style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>{catLabel(r.categoryId, r.subcategoryId)}</span>
                <span className="tag-badge" style={{
                  marginLeft: 'auto', flex: 'none', fontSize: 10,
                  color: r.createdFrom === 'user' ? 'var(--blue)' : 'var(--muted)',
                  background: r.createdFrom === 'user' ? 'var(--blue-bg)' : '#f0efe9',
                }}>{r.createdFrom === 'user' ? 'Learned' : 'Seed'}</span>
                <button title="Delete rule" onClick={() => dispatch({ type: 'deleteRule', ruleId: r.id })}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--faint)', fontSize: 14, lineHeight: 1, flex: 'none' }}>×</button>
              </div>
            ))}
          </div>
        </div>
      </div>

      {ruleModal && <NewRuleModal onClose={() => setRuleModal(false)} />}
      {modal?.kind === 'add' && <CategoryFormModal parentId={modal.parentId} onClose={() => setModal(null)} />}
      {modal?.kind === 'edit' && <CategoryFormModal category={modal.category} onClose={() => setModal(null)} />}
      {modal?.kind === 'delete' && <DeleteCategoryModal category={modal.category} onClose={() => setModal(null)} />}
      {modal?.kind === 'merge' && <MergeCategoryModal category={modal.category} onClose={() => setModal(null)} />}
    </div>
  );
}

function CategoryRow({ category, count, indent, onAddSub, onEdit, onMerge, onDelete, onToggleTax }: {
  category: Category; count: number; indent?: boolean;
  onAddSub?: () => void; onEdit: () => void; onMerge: () => void; onDelete: () => void; onToggleTax: (v: boolean) => void;
}) {
  const protectedCat = isProtectedCategory(category.id);
  return (
    <div className="hover-row" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: indent ? '7px 10px 7px 30px' : '9px 10px', borderRadius: 10 }}>
      <span className="dot" style={{ width: indent ? 8 : 11, height: indent ? 8 : 11, background: category.color }} />
      <div className="ellip" style={{ flex: 1, fontSize: indent ? 12.5 : 13.5, fontWeight: indent ? 450 : 500, color: 'var(--ink-2)' }}>{category.name}</div>
      <label title="Include in tax-relevant exports" style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: category.taxDeductible ? 'var(--green)' : 'var(--muted-2)', cursor: 'pointer', flex: 'none' }}>
        <input type="checkbox" checked={!!category.taxDeductible} onChange={e => onToggleTax(e.target.checked)} />
        Tax
      </label>
      <span style={{ fontSize: 10.5, color: 'var(--muted-2)', flex: 'none', width: 40, textAlign: 'right' }}>{count} txns</span>
      <div style={{ display: 'flex', gap: 2, flex: 'none' }}>
        {onAddSub && <IconButton title="Add subcategory" onClick={onAddSub}><path d="M12 5v14M5 12h14" /></IconButton>}
        <IconButton title="Rename / recolor" onClick={onEdit}><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></IconButton>
        {!protectedCat && <IconButton title="Merge into another category" onClick={onMerge}><path d="M8 3v7a3 3 0 0 0 3 3h5M13 10l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" /></IconButton>}
        {!protectedCat && <IconButton title="Delete" danger onClick={onDelete}><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" strokeLinecap="round" strokeLinejoin="round" /></IconButton>}
      </div>
    </div>
  );
}

function IconButton({ title, onClick, danger, children }: { title: string; onClick: () => void; danger?: boolean; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick}
      style={{ width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', background: 'none', cursor: 'pointer', color: danger ? 'var(--red)' : 'var(--muted-2)', borderRadius: 6 }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">{children}</svg>
    </button>
  );
}

function CategoryFormModal({ category, parentId, onClose }: { category?: Category; parentId?: string | null; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const isEdit = !!category;
  const effectiveParentId = category ? category.parentId : (parentId ?? null);
  const parent = effectiveParentId ? state.categories.find(c => c.id === effectiveParentId) : null;

  const [name, setName] = useState(category?.name ?? '');
  const [color, setColor] = useState(category?.color ?? SWATCHES[state.categories.length % SWATCHES.length]);
  const [error, setError] = useState<string | null>(null);

  const save = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (categoryNameTaken(state.categories, trimmed, effectiveParentId, category?.id)) {
      setError(`Another ${effectiveParentId ? 'subcategory' : 'category'} here is already named "${trimmed}".`);
      return;
    }
    if (isEdit) {
      dispatch({ type: 'editCategory', categoryId: category.id, patch: { name: trimmed, color } });
    } else {
      dispatch({ type: 'addCategory', name: trimmed, color, parentId: effectiveParentId });
    }
    onClose();
  };

  return (
    <Modal title={isEdit ? 'Edit category' : parent ? `New subcategory of ${parent.name}` : 'New category'} onClose={onClose}
      footer={<><span /><button className="btn btn-lg" disabled={!name.trim()} onClick={save}>{isEdit ? 'Save' : 'Add'}</button></>}>
      <label className="field">Name</label>
      <input className="input" style={{ width: '100%' }} autoFocus value={name}
        onChange={e => { setName(e.target.value); setError(null); }} placeholder="e.g. Pet Care" />
      {error && <div style={{ fontSize: 11.5, color: 'var(--red)', marginTop: 6 }}>{error}</div>}
      <label className="field" style={{ marginTop: 14 }}>Color</label>
      <div style={{ display: 'flex', gap: 8 }}>
        {SWATCHES.map(sw => (
          <button key={sw} onClick={() => setColor(sw)}
            style={{ width: 24, height: 24, borderRadius: '50%', background: sw, border: color === sw ? '2px solid var(--ink)' : '2px solid transparent', cursor: 'pointer', padding: 0 }} />
        ))}
      </div>
    </Modal>
  );
}

function DeleteCategoryModal({ category, onClose }: { category: Category; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const usage: CategoryUsage = categoryUsage(state, category.id);
  const isTop = !category.parentId;
  const subCount = isTop ? state.categories.filter(c => c.parentId === category.id).length : 0;

  // top-level categories can only reassign to other top-level categories; subcategories to other subcategories (any parent)
  const sameLevel = state.categories.filter(c => c.id !== category.id && !!c.parentId === !!category.parentId);
  const [reassignTo, setReassignTo] = useState('');

  const hasImpact = usage.transactions > 0 || usage.splits > 0 || usage.rules > 0 || usage.budgets > 0 || subCount > 0;

  const confirm = () => {
    dispatch({ type: 'deleteCategory', categoryId: category.id, reassignTo: reassignTo || null });
    onClose();
  };

  return (
    <Modal title={`Delete "${category.name}"`} onClose={onClose}
      footer={<><span /><button className="btn btn-lg" style={{ background: 'var(--red)' }} onClick={confirm}>Delete</button></>}>
      {isTop && subCount > 0 && (
        <div style={{ fontSize: 12.5, color: 'var(--amber-deep)', background: 'var(--amber-bg)', borderRadius: 8, padding: '9px 11px', marginBottom: 12 }}>
          This category has {subCount} subcategor{subCount === 1 ? 'y' : 'ies'} — deleting it removes those too. To keep subcategories, use "Merge into another category" instead.
        </div>
      )}
      {hasImpact ? (
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 14 }}>
          This affects <strong>{usage.transactions}</strong> transaction{usage.transactions === 1 ? '' : 's'}
          {usage.splits > 0 && <> ({usage.splits} within splits)</>}, <strong>{usage.rules}</strong> rule{usage.rules === 1 ? '' : 's'}, and <strong>{usage.budgets}</strong> budget{usage.budgets === 1 ? '' : 's'}.
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--muted-2)', marginBottom: 14 }}>Nothing currently uses this category — it's safe to remove.</div>
      )}
      <label className="field">Move affected data to</label>
      <select className="input" style={{ width: '100%' }} value={reassignTo} onChange={e => setReassignTo(e.target.value)}>
        <option value="">Uncategorized</option>
        {sameLevel.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 10 }}>
        Split transactions can't be left without a category, so any split portions fall back to "Other / Uncategorized" if you don't pick a target.
      </div>
    </Modal>
  );
}

function MergeCategoryModal({ category, onClose }: { category: Category; onClose: () => void }) {
  const { state, dispatch } = useStore();
  const usage: CategoryUsage = categoryUsage(state, category.id);
  const isTop = !category.parentId;
  const subCount = isTop ? state.categories.filter(c => c.parentId === category.id).length : 0;

  const targets = state.categories.filter(c => c.id !== category.id && !!c.parentId === !!category.parentId);
  const [intoId, setIntoId] = useState('');

  const confirm = () => {
    if (!intoId) return;
    dispatch({ type: 'mergeCategory', fromId: category.id, intoId });
    onClose();
  };

  return (
    <Modal title={`Merge "${category.name}" into…`} onClose={onClose}
      footer={<><span /><button className="btn btn-lg" disabled={!intoId} onClick={confirm}>Merge</button></>}>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 14 }}>
        Moves <strong>{usage.transactions}</strong> transaction{usage.transactions === 1 ? '' : 's'}, <strong>{usage.rules}</strong> rule{usage.rules === 1 ? '' : 's'}, and any budget onto the target category
        {isTop && subCount > 0 && <> — its {subCount} subcategor{subCount === 1 ? 'y stays' : 'ies stay'}, just reparented under the target</>}.
        "{category.name}" is then removed.
      </div>
      {targets.length === 0 ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>
          There's no other {category.parentId ? 'subcategory' : 'top-level category'} to merge into yet.
        </div>
      ) : (
        <>
          <label className="field">Merge into</label>
          <select className="input" style={{ width: '100%' }} value={intoId} onChange={e => setIntoId(e.target.value)}>
            <option value="">Choose…</option>
            {targets.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </>
      )}
    </Modal>
  );
}

function NewRuleModal({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useStore();
  const [pattern, setPattern] = useState('');
  const [matchType, setMatchType] = useState<MatchType>('contains');
  const [catValue, setCatValue] = useState('');

  const topCats = state.categories.filter(c => !c.parentId);

  const save = () => {
    const cat = state.categories.find(c => c.id === catValue);
    if (!cat || !pattern.trim()) return;
    dispatch({
      type: 'addRule',
      rule: {
        id: 'user-' + Math.random().toString(36).slice(2, 10),
        merchantPattern: pattern.trim(),
        matchType,
        categoryId: cat.parentId ?? cat.id,
        subcategoryId: cat.parentId ? cat.id : null,
        createdFrom: 'user',
        createdAt: new Date().toISOString(),
      },
    });
    onClose();
  };

  return (
    <Modal title="New categorization rule" onClose={onClose}
      footer={<><span /><button className="btn btn-lg" disabled={!pattern.trim() || !catValue} onClick={save}>Add rule</button></>}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 14 }}>
        <div>
          <label className="field">Merchant pattern</label>
          <input className="input" style={{ width: '100%' }} value={pattern} onChange={e => setPattern(e.target.value)} placeholder="e.g. WHOLEFDS or Whole Foods" />
        </div>
        <div>
          <label className="field">Match type</label>
          <select className="input" style={{ width: '100%' }} value={matchType} onChange={e => setMatchType(e.target.value as MatchType)}>
            <option value="contains">contains</option>
            <option value="exact">exact</option>
            <option value="regex">regex</option>
          </select>
        </div>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="field">Category</label>
          <select className="input" style={{ width: '100%' }} value={catValue} onChange={e => setCatValue(e.target.value)}>
            <option value="">Choose…</option>
            {topCats.map(c => (
              <optgroup key={c.id} label={c.name}>
                <option value={c.id}>{c.name}</option>
                {state.categories.filter(s => s.parentId === c.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </optgroup>
            ))}
          </select>
        </div>
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 12 }}>
        Rules match against the normalized merchant name and the raw bank description. New imports and re-categorizations use them automatically.
      </div>
    </Modal>
  );
}
