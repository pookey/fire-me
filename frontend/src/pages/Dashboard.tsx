import { useEffect, useState, useMemo } from 'react';
import { getFunds, getSnapshots, getFireConfig } from '../utils/api';
import { calculateFireProjections } from '../utils/fireCalculator';
import { formatPence, formatPenceShort, formatDate } from '../utils/formatters';
import FundBreakdownChart from '../components/charts/FundBreakdownChart';
import type { Fund, Snapshot, FireConfig, FireResult } from '../types';

export default function Dashboard() {
  const [funds, setFunds] = useState<Fund[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [fireConfig, setFireConfig] = useState<FireConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      getFunds(),
      getSnapshots(),
      getFireConfig().catch(() => null),
    ])
      .then(([f, s, fc]) => {
        setFunds(f);
        setSnapshots(s);
        setFireConfig(fc);
      })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const dates = useMemo(() => [...new Set(snapshots.map(s => s.date))].sort().reverse(), [snapshots]);
  const latestDate = dates[0];
  const prevMonthDate = dates[1];
  const prevYearDate = dates.find(d => {
    const latest = new Date(latestDate);
    const candidate = new Date(d);
    return latest.getFullYear() - candidate.getFullYear() >= 1;
  });

  const totalForDate = (date: string | undefined) => {
    if (!date) return 0;
    return snapshots.filter(s => s.date === date).reduce((sum, s) => sum + s.value, 0);
  };

  const categoryTotal = (date: string, category: string) =>
    snapshots.filter(s => s.date === date && s.category === category).reduce((sum, s) => sum + s.value, 0);

  const total = totalForDate(latestDate);
  const savings = latestDate ? categoryTotal(latestDate, 'savings') : 0;
  const pensions = latestDate ? categoryTotal(latestDate, 'pension') : 0;

  const momChange = prevMonthDate ? total - totalForDate(prevMonthDate) : 0;
  const yoyChange = prevYearDate ? total - totalForDate(prevYearDate) : 0;

  const fireResult: FireResult | null = useMemo(() => {
    if (!fireConfig || funds.length === 0 || !latestDate) return null;
    const latestSnaps = snapshots
      .filter(s => s.date === latestDate)
      .map(s => ({ ...s, value: s.value / 100 }));
    return calculateFireProjections(funds, latestSnaps, fireConfig);
  }, [fireConfig, funds, snapshots, latestDate]);

  const fireProgress = useMemo(() => {
    if (!fireConfig || !fireResult || total === 0) return null;
    const lowestRate = Math.min(...fireConfig.withdrawalRates);
    const requiredPotPence = (fireConfig.targetAnnualSpend / (lowestRate / 100)) * 100;
    const percent = Math.min((total / requiredPotPence) * 100, 100);
    return { percent: Math.round(percent * 10) / 10, requiredPotPence };
  }, [fireConfig, fireResult, total]);

  const yearsToFire = useMemo(() => {
    if (!fireResult) return null;
    const lowestRate = fireConfig ? Math.min(...fireConfig.withdrawalRates) : null;
    if (!lowestRate) return null;
    const fd = fireResult.fireDates.find(d => d.withdrawalRate === lowestRate);
    if (!fd || fd.age === null) return null;
    const birthYear = fireConfig ? new Date(fireConfig.dateOfBirth).getFullYear() : null;
    if (!birthYear) return null;
    const currentAge = new Date().getFullYear() - birthYear;
    return Math.max(0, fd.age - currentAge);
  }, [fireResult, fireConfig]);

  const portfolioCagr = useMemo(() => {
    if (dates.length < 2 || !latestDate) return null;
    const firstDate = dates[dates.length - 1];
    const firstTotal = totalForDate(firstDate);
    if (firstTotal <= 0) return null;
    const years = (new Date(latestDate).getTime() - new Date(firstDate).getTime()) / (365.25 * 24 * 60 * 60 * 1000);
    if (years < 0.5) return null;
    const cagr = (Math.pow(total / firstTotal, 1 / years) - 1) * 100;
    return Math.round(cagr * 10) / 10;
  }, [dates, latestDate, total]);

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-medium)', borderTopColor: 'var(--gold)' }} />
      Loading dashboard...
    </div>
  );
  if (error) return <div style={{ color: 'var(--negative)' }}>Error: {error}</div>;

  const recentSnapshots = snapshots.filter(s => s.date === latestDate).sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-6 max-w-7xl">
      {/* Hero Net Worth */}
      <div className="animate-in">
        <p className="text-xs font-medium uppercase tracking-widest mb-1" style={{ color: 'var(--text-tertiary)' }}>
          Total Net Worth
        </p>
        <div className="flex items-baseline gap-4">
          <h1 className="font-mono text-4xl lg:text-5xl font-bold tracking-tight" style={{ color: 'var(--gold-bright)' }}>
            {formatPence(total)}
          </h1>
          {latestDate && (
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              as of {formatDate(latestDate)}
            </span>
          )}
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Savings', value: formatPence(savings), accent: 'var(--teal-bright)' },
          { label: 'Pensions', value: formatPence(pensions), accent: '#818cf8' },
          {
            label: 'Month on Month',
            value: `${momChange >= 0 ? '+' : ''}${formatPenceShort(momChange)}`,
            accent: momChange >= 0 ? 'var(--positive)' : 'var(--negative)',
          },
          {
            label: 'Year on Year',
            value: `${yoyChange >= 0 ? '+' : ''}${formatPenceShort(yoyChange)}`,
            accent: yoyChange >= 0 ? 'var(--positive)' : 'var(--negative)',
          },
        ].map((card, i) => (
          <div key={card.label} className={`card p-4 animate-in stagger-${i + 1}`}>
            <p className="text-[0.7rem] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
              {card.label}
            </p>
            <p className="font-mono text-lg font-semibold" style={{ color: card.accent }}>
              {card.value}
            </p>
          </div>
        ))}
      </div>

      {/* FIRE metrics */}
      {fireConfig && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {fireProgress && (
            <div className="card p-5 animate-in stagger-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[0.7rem] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
                  FIRE Progress
                </p>
                <span className="font-mono text-sm font-bold" style={{ color: 'var(--gold-bright)' }}>
                  {fireProgress.percent}%
                </span>
              </div>
              <div className="progress-track">
                <div
                  className="progress-fill-gold"
                  style={{ width: `${Math.min(fireProgress.percent, 100)}%` }}
                />
              </div>
              <p className="text-[0.65rem] mt-2" style={{ color: 'var(--text-muted)' }}>
                {formatPenceShort(total)} / {formatPenceShort(fireProgress.requiredPotPence)} target
              </p>
            </div>
          )}

          {yearsToFire !== null && (
            <div className="card p-5 animate-in stagger-6">
              <p className="text-[0.7rem] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Years to FIRE
              </p>
              <p className="font-mono text-2xl font-bold" style={{ color: 'var(--teal-bright)' }}>
                {yearsToFire === 0 ? 'Achieved' : yearsToFire}
              </p>
              <p className="text-[0.65rem] mt-1" style={{ color: 'var(--text-muted)' }}>
                At {Math.min(...fireConfig.withdrawalRates)}% withdrawal rate
              </p>
            </div>
          )}

          {portfolioCagr !== null && (
            <div className="card p-5 animate-in stagger-7">
              <p className="text-[0.7rem] font-medium uppercase tracking-wider mb-2" style={{ color: 'var(--text-tertiary)' }}>
                Portfolio CAGR
              </p>
              <p className="font-mono text-2xl font-bold" style={{ color: portfolioCagr >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
                {portfolioCagr >= 0 ? '+' : ''}{portfolioCagr}%
              </p>
              <p className="text-[0.65rem] mt-1" style={{ color: 'var(--text-muted)' }}>
                From first to latest snapshot
              </p>
            </div>
          )}
        </div>
      )}

      {/* Fund Breakdown Chart */}
      <div className="card p-5 animate-in stagger-6">
        <h3 className="font-display text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Fund Breakdown
        </h3>
        <FundBreakdownChart snapshots={snapshots} />
      </div>

      {/* Latest Snapshot Table */}
      <div className="card p-5 animate-in stagger-7">
        <h3 className="font-display text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          Latest Snapshot
          {latestDate && (
            <span className="font-body text-xs font-normal ml-2" style={{ color: 'var(--text-muted)' }}>
              {formatDate(latestDate)}
            </span>
          )}
        </h3>
        <div className="overflow-x-auto">
          <table className="table-dark">
            <thead>
              <tr>
                <th>Fund</th>
                <th>Category</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {recentSnapshots.map(s => (
                <tr key={`${s.fundId}-${s.date}`}>
                  <td className="td-primary">{s.fundName}</td>
                  <td className="capitalize">{s.category}</td>
                  <td className="text-right td-mono">{formatPence(s.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
