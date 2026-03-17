import { useEffect, useState, useMemo } from 'react';
import { getSnapshots } from '../utils/api';
import NetWorthChart from '../components/charts/NetWorthChart';
import FundBreakdownChart from '../components/charts/FundBreakdownChart';
import SavingsVsPensionsChart from '../components/charts/SavingsVsPensionsChart';
import GrowthChart from '../components/charts/GrowthChart';
import type { Snapshot } from '../types';

const tabs = [
  { id: 'networth', label: 'Net Worth' },
  { id: 'breakdown', label: 'Fund Breakdown' },
  { id: 'savpen', label: 'Savings vs Pensions' },
  { id: 'growth', label: 'Growth' },
] as const;

type TabId = (typeof tabs)[number]['id'];

const TIME_RANGES = [
  { id: '6m', label: '6m', months: 6 },
  { id: '12m', label: '12m', months: 12 },
  { id: '24m', label: '24m', months: 24 },
  { id: '36m', label: '3y', months: 36 },
  { id: '60m', label: '5y', months: 60 },
  { id: 'all', label: 'All', months: 0 },
] as const;

type RangeId = (typeof TIME_RANGES)[number]['id'];

export default function Charts() {
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<TabId>('networth');
  const [range, setRange] = useState<RangeId>('all');

  useEffect(() => {
    getSnapshots()
      .then(setSnapshots)
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const filteredSnapshots = useMemo(() => {
    const selected = TIME_RANGES.find(r => r.id === range);
    if (!selected || selected.months === 0) return snapshots;
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - selected.months);
    const cutoffStr = cutoff.toISOString().slice(0, 10);
    return snapshots.filter(s => s.date >= cutoffStr);
  }, [snapshots, range]);

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-medium)', borderTopColor: 'var(--gold)' }} />
      Loading charts...
    </div>
  );
  if (error) return <div style={{ color: 'var(--negative)' }}>Error: {error}</div>;

  return (
    <div className="space-y-6 max-w-7xl">
      <h2 className="font-display text-2xl font-semibold animate-in" style={{ color: 'var(--text-primary)' }}>
        Charts
      </h2>

      <div className="card animate-in stagger-1">
        {/* Tabs + time range */}
        <div className="flex items-center justify-between px-1 pt-1" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
          <div className="flex gap-0">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className="px-5 py-3 text-sm font-medium transition-all relative"
                style={{
                  color: activeTab === tab.id ? 'var(--gold-bright)' : 'var(--text-tertiary)',
                }}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <span
                    className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full"
                    style={{ background: 'var(--gold)' }}
                  />
                )}
              </button>
            ))}
          </div>
          <div className="flex gap-1 pr-3">
            {TIME_RANGES.map(r => (
              <button
                key={r.id}
                onClick={() => setRange(r.id)}
                className="px-2.5 py-1 rounded-md text-[0.7rem] font-medium transition-all"
                style={{
                  background: range === r.id ? 'var(--surface-3)' : 'transparent',
                  color: range === r.id ? 'var(--gold-bright)' : 'var(--text-muted)',
                  border: range === r.id ? '1px solid var(--border-medium)' : '1px solid transparent',
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {/* Chart content */}
        <div className="p-5">
          {activeTab === 'networth' && <NetWorthChart snapshots={filteredSnapshots} />}
          {activeTab === 'breakdown' && <FundBreakdownChart snapshots={filteredSnapshots} />}
          {activeTab === 'savpen' && <SavingsVsPensionsChart snapshots={filteredSnapshots} />}
          {activeTab === 'growth' && <GrowthChart snapshots={filteredSnapshots} />}
        </div>
      </div>
    </div>
  );
}
