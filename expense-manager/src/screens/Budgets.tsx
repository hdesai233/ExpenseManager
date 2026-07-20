import { useState } from 'react';
import { budgetPacing, projectGoal } from '../lib/analytics';
import { currentYM, monthFull, uid, usd } from '../lib/format';
import { useStore } from '../store';
import type { Goal } from '../types';
import { Modal } from '../components/ui';

export default function Budgets() {
  const { state, dispatch } = useStore();
  const ym = currentYM();
  const [editBudgets, setEditBudgets] = useState(false);
  const [goalModal, setGoalModal] = useState<Goal | 'new' | null>(null);

  const pacing = budgetPacing(state.budgets, state.transactions, state.categories, ym);
  const monthName = monthFull(ym);

  return (
    <div className="page">
      <div style={{ marginBottom: 18 }}>
        <div className="page-title">Budgets &amp; Goals</div>
        <div className="page-sub">Monthly targets with forecast overrun warnings · savings goals with feasibility projection</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
        <div className="card" style={{ padding: '20px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div className="card-title" style={{ fontSize: 15 }}>Monthly budgets · {monthName}</div>
            <button className="link-sm" onClick={() => setEditBudgets(true)}>Edit budgets</button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {pacing.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--muted-2)' }}>No budgets yet — click "Edit budgets" to set monthly targets.</div>}
            {pacing.map(b => {
              const over = b.overPace;
              const barW = Math.min(b.spent / b.budget.monthlyLimit, 1) * 100;
              const projLeft = Math.min(b.projected / b.budget.monthlyLimit, 1.3) * 100;
              return (
                <div key={b.budget.id}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="dot" style={{ width: 9, height: 9, background: b.category.color }} />
                      <span style={{ fontSize: 13, color: 'var(--ink-3)', fontWeight: 500 }}>{b.category.name}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 600 }}>{usd(b.spent)}</span>
                      <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>/ {usd(b.budget.monthlyLimit)}</span>
                      <span style={{ fontSize: 11.5, color: over ? 'var(--amber)' : 'var(--muted)' }}>
                        {over ? `On pace for ${usd(b.projected)}` : 'On track'}
                      </span>
                    </div>
                  </div>
                  <div style={{ position: 'relative', height: 7, background: 'var(--track)', borderRadius: 4 }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, height: '100%', width: `${barW}%`, background: b.spent > b.budget.monthlyLimit ? 'var(--red)' : b.category.color, borderRadius: 4 }} />
                    <div title={`Projected ${usd(b.projected)}`} style={{ position: 'absolute', top: -3, height: 13, width: 2, background: 'var(--muted)', left: `${projLeft}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {state.goals.map(g => {
            const p = projectGoal(g);
            const pct = Math.min(g.currentAmount / g.targetAmount * 100, 100);
            const color = p.feasible ? 'var(--green-conf)' : 'var(--amber)';
            const dateLabel = new Date(g.targetDate).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
            return (
              <div key={g.id} className="card" style={{ padding: '20px 22px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <div className="card-title" style={{ fontSize: 15 }}>{g.name}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color, background: 'var(--panel)', padding: '3px 9px', borderRadius: 20 }}>
                      {p.feasible ? 'On track' : 'Off track'}
                    </span>
                    <button className="link-sm" onClick={() => setGoalModal(g)}>Edit</button>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 7, margin: '10px 0 3px' }}>
                  <span style={{ fontSize: 26, fontWeight: 300, color: 'var(--ink)' }}>{usd(g.currentAmount)}</span>
                  <span style={{ fontSize: 13, color: 'var(--muted-2)' }}>of {usd(g.targetAmount)} · by {dateLabel}</span>
                </div>
                <div style={{ height: 7, background: 'var(--track)', borderRadius: 4, overflow: 'hidden', margin: '10px 0' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 4 }} />
                </div>
                <div style={{ fontSize: 12, color: '#6b6862' }}>
                  {p.feasible
                    ? `On track — at ${usd(g.monthlyContribution)}/mo you'll reach ${usd(g.targetAmount)} in ~${isFinite(p.monthsNeeded) ? p.monthsNeeded : '—'} months`
                    : `Behind — needs +${usd(p.extraMonthlyNeeded)}/mo to hit the target date`}
                </div>
              </div>
            );
          })}
          <button className="btn-ghost" style={{ justifyContent: 'center' }} onClick={() => setGoalModal('new')}>+ New savings goal</button>
        </div>
      </div>

      {editBudgets && (
        <Modal title="Monthly budgets" onClose={() => setEditBudgets(false)}
          footer={<><span /><button className="btn btn-lg" onClick={() => setEditBudgets(false)}>Done</button></>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>Set a monthly limit per category. Set to 0 to remove a budget.</div>
            {state.categories.filter(c => !c.parentId && c.id !== 'income').map(c => {
              const b = state.budgets.find(x => x.categoryId === c.id);
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="dot" style={{ width: 9, height: 9, background: c.color }} />
                  <span style={{ flex: 1, fontSize: 13 }}>{c.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>$</span>
                  <input className="input" type="number" min={0} step={10} style={{ width: 110 }}
                    defaultValue={b?.monthlyLimit ?? 0}
                    onBlur={e => dispatch({ type: 'setBudget', categoryId: c.id, monthlyLimit: Math.max(0, +e.target.value || 0) })} />
                  <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>/mo</span>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {goalModal && (
        <GoalModal
          goal={goalModal === 'new' ? null : goalModal}
          onClose={() => setGoalModal(null)}
          onSave={g => { dispatch({ type: 'upsertGoal', goal: g }); setGoalModal(null); }}
          onDelete={goalModal !== 'new' ? () => { dispatch({ type: 'deleteGoal', goalId: goalModal.id }); setGoalModal(null); } : undefined}
        />
      )}
    </div>
  );
}

function GoalModal({ goal, onClose, onSave, onDelete }: {
  goal: Goal | null;
  onClose: () => void;
  onSave: (g: Goal) => void;
  onDelete?: () => void;
}) {
  const [name, setName] = useState(goal?.name ?? '');
  const [target, setTarget] = useState(goal?.targetAmount ?? 5000);
  const [current, setCurrent] = useState(goal?.currentAmount ?? 0);
  const [monthly, setMonthly] = useState(goal?.monthlyContribution ?? 200);
  const [date, setDate] = useState(goal?.targetDate ?? '');

  return (
    <Modal title={goal ? 'Edit goal' : 'New savings goal'} onClose={onClose}
      footer={
        <>
          {onDelete ? <button className="btn-ghost" style={{ color: 'var(--red)' }} onClick={onDelete}>Delete</button> : <span />}
          <button className="btn btn-lg" disabled={!name || !date || target <= 0}
            onClick={() => onSave({
              id: goal?.id ?? uid(),
              name, targetAmount: target, currentAmount: current, monthlyContribution: monthly, targetDate: date,
            })}>Save goal</button>
        </>
      }>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div style={{ gridColumn: '1 / -1' }}>
          <label className="field">Goal name</label>
          <input className="input" style={{ width: '100%' }} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Japan Trip 2027" />
        </div>
        <div>
          <label className="field">Target amount ($)</label>
          <input className="input" style={{ width: '100%' }} type="number" min={1} value={target} onChange={e => setTarget(+e.target.value)} />
        </div>
        <div>
          <label className="field">Saved so far ($)</label>
          <input className="input" style={{ width: '100%' }} type="number" min={0} value={current} onChange={e => setCurrent(+e.target.value)} />
        </div>
        <div>
          <label className="field">Monthly contribution ($)</label>
          <input className="input" style={{ width: '100%' }} type="number" min={0} value={monthly} onChange={e => setMonthly(+e.target.value)} />
        </div>
        <div>
          <label className="field">Target date</label>
          <input className="input" style={{ width: '100%' }} type="date" value={date} onChange={e => setDate(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}
