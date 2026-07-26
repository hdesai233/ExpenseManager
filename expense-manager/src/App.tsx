import { useState } from 'react';
import { needsReview } from './lib/categorize';
import { addMonths, currentYM, monthFull } from './lib/format';
import { useStore } from './store';
import type { ViewKey } from './types';
import Dashboard from './screens/Dashboard';
import Transactions from './screens/Transactions';
import Analytics from './screens/Analytics';
import Trends from './screens/Trends';
import Subscriptions from './screens/Subscriptions';
import Savings from './screens/Savings';
import Categories from './screens/Categories';
import Reports from './screens/Reports';
import Settings from './screens/Settings';
import ImportWizard from './screens/ImportWizard';
import AddExpenseModal from './components/AddExpenseModal';
import AskModal from './components/AskModal';

interface NavItem { key: ViewKey; label: string; icon: React.ReactNode }

const ICONS = {
  dashboard: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>,
  transactions: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M4 7h16" /><path d="M4 12h16" /><path d="M4 17h10" /></svg>,
  analytics: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19V5" /><path d="M4 19h16" /><path d="M7 15l4-5 3 3 4-6" /></svg>,
  trends: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 17l5-5 4 3 8-8" /><path d="M15 7h5v5" /></svg>,
  subscriptions: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M20 8a8 8 0 0 0-14.5-3M4 4v4h4" /><path d="M4 16a8 8 0 0 0 14.5 3M20 20v-4h-4" /></svg>,
  savings: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 7v10" /><path d="M15 9.5c0-1.4-1.3-2.5-3-2.5s-3 1-3 2.3c0 3 6 1.4 6 4.4 0 1.3-1.3 2.3-3 2.3s-3-1.1-3-2.5" /></svg>,
  categories: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M4 4h7l9 9-7 7-9-9z" /><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none" /></svg>,
  reports: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 16h6M9 10h2" /></svg>,
  settings: <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><circle cx="12" cy="12" r="3.2" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></svg>,
};

const SECTIONS: Array<{ title: string; items: NavItem[] }> = [
  {
    title: 'Overview',
    items: [
      { key: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard },
      { key: 'transactions', label: 'Transactions', icon: ICONS.transactions },
      { key: 'analytics', label: 'Analytics', icon: ICONS.analytics },
    ],
  },
  {
    title: 'Insights',
    items: [
      { key: 'trends', label: 'Trends', icon: ICONS.trends },
      { key: 'subscriptions', label: 'Subscriptions', icon: ICONS.subscriptions },
      { key: 'savings', label: 'Savings', icon: ICONS.savings },
    ],
  },
  {
    title: 'Manage',
    items: [
      { key: 'categories', label: 'Categories & Rules', icon: ICONS.categories },
      { key: 'reports', label: 'Reports & Export', icon: ICONS.reports },
      { key: 'settings', label: 'Settings', icon: ICONS.settings },
    ],
  },
];

export default function App() {
  const { state } = useStore();
  const [view, setView] = useState<ViewKey>('dashboard');
  const [search, setSearch] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [addExpenseOpen, setAddExpenseOpen] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [reportBannerDismissed, setReportBannerDismissed] = useState(false);

  const reviewCount = state.transactions.filter(needsReview).length;
  const ym = currentYM();
  const showReportBanner = !reportBannerDismissed && state.settings.autoReportEnabled
    && state.settings.autoReportFolder && state.settings.autoReportLastYM !== ym;

  const go = (v: ViewKey) => { setView(v); };

  return (
    <div className="app">
      {/* top bar */}
      <div className="topbar">
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#e06c5e' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#e3b34e' }} />
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: '#67b06a' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 6 }}>
          <span style={{ width: 15, height: 15, borderRadius: 5, background: 'var(--green)', display: 'inline-block' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-3)', letterSpacing: '-.01em' }}>Ledger</span>
        </div>
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: 340, maxWidth: '42vw', height: 28, padding: '0 12px', background: '#eae7e0', border: '1px solid var(--border)', borderRadius: 8 }}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#97938a" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" strokeLinecap="round" /></svg>
            <input
              value={search}
              onChange={e => { setSearch(e.target.value); if (e.target.value && view !== 'transactions') setView('transactions'); }}
              placeholder="Search transactions, merchants, tags…"
              style={{ border: 'none', background: 'transparent', outline: 'none', flex: 1, fontSize: 12.5, color: 'var(--ink-3)' }}
            />
            {search && <button onClick={() => setSearch('')} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#97938a', fontSize: 13, padding: 0 }}>×</button>}
          </div>
        </div>
        <button className="btn-ghost" style={{ marginRight: 8 }} title="Ask a question about your spending" onClick={() => setAskOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 5, verticalAlign: '-2px' }}>
            <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" />
            <path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" />
          </svg>
          Ask
        </button>
        <button className="btn-ghost" style={{ marginRight: 8 }} onClick={() => setAddExpenseOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ marginRight: 5, verticalAlign: '-2px' }}><path d="M12 5v14M5 12h14" /></svg>
          Add expense
        </button>
        <button className="btn" onClick={() => setImportOpen(true)}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3v11" /><path d="M8 10l4 4 4-4" /><path d="M4 19h16" /></svg>
          Import
        </button>
      </div>

      {showReportBanner && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', background: '#fdf7ee', borderBottom: '1px solid #ecdcbf', fontSize: 12.5, color: 'var(--amber-deep)' }}>
          <span>Your {monthFull(addMonths(ym, -1))} monthly summary is ready to generate.</span>
          <button className="link-sm" style={{ fontSize: 12.5 }} onClick={() => { setView('reports'); setReportBannerDismissed(true); }}>Go to Reports &amp; Export</button>
          <button onClick={() => setReportBannerDismissed(true)} style={{ marginLeft: 'auto', border: 'none', background: 'none', cursor: 'pointer', color: 'var(--amber-deep)', fontSize: 14, lineHeight: 1 }}>×</button>
        </div>
      )}

      <div className="body">
        {/* sidebar */}
        <div className="sidebar">
          {SECTIONS.map(section => (
            <div key={section.title}>
              <div className="nav-section">{section.title}</div>
              <div className="nav-list">
                {section.items.map(item => (
                  <button key={item.key} className={'nav-btn' + (view === item.key ? ' active' : '')} onClick={() => go(item.key)}>
                    {item.icon}
                    {item.label}
                    {item.key === 'transactions' && reviewCount > 0 && (
                      <span className="pill-count" style={{ marginLeft: 'auto' }}>{reviewCount}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          ))}

          <div style={{ marginTop: 'auto', paddingTop: 14, borderTop: '1px solid #e4e1d8' }}>
            <div className="nav-section" style={{ paddingTop: 0 }}>Accounts · {state.accounts.length} linked</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5, padding: '0 4px' }}>
              {state.accounts.map(a => (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '2px 6px' }}>
                  <span className="dot" style={{ width: 8, height: 8, background: a.color }} />
                  <span className="ellip" style={{ fontSize: 12, color: '#5c584f' }}>{a.name}</span>
                  {a.lastFour && <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted-3)' }}>•{a.lastFour}</span>}
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12, padding: 8, borderRadius: 9, background: 'var(--panel-hover)' }}>
              <span style={{ width: 26, height: 26, borderRadius: '50%', background: 'var(--green)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>
                {state.settings.householdName.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </span>
              <div style={{ lineHeight: 1.25, minWidth: 0 }}>
                <div className="ellip" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink-3)' }}>{state.settings.householdName}</div>
                <div style={{ fontSize: 10.5, color: 'var(--muted-3)' }}>Local · private</div>
              </div>
            </div>
          </div>
        </div>

        {/* main */}
        <div className="main">
          {view === 'dashboard' && <Dashboard go={go} />}
          {view === 'transactions' && <Transactions search={search} />}
          {view === 'analytics' && <Analytics />}
          {view === 'trends' && <Trends />}
          {view === 'subscriptions' && <Subscriptions />}
          {view === 'savings' && <Savings />}
          {view === 'categories' && <Categories />}
          {view === 'reports' && <Reports />}
          {view === 'settings' && <Settings />}
        </div>
      </div>

      {importOpen && <ImportWizard onClose={() => setImportOpen(false)} />}
      {addExpenseOpen && <AddExpenseModal onClose={() => setAddExpenseOpen(false)} />}
      {askOpen && <AskModal onClose={() => setAskOpen(false)} />}
    </div>
  );
}
