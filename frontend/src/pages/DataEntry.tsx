import { useEffect, useState, useCallback } from 'react';
import { getFunds, getSnapshots, batchCreateSnapshots } from '../utils/api';
import { formatPence } from '../utils/formatters';
import type { Fund, Snapshot } from '../types';

export default function DataEntry() {
  const [funds, setFunds] = useState<Fund[]>([]);
  const [date, setDate] = useState(() => {
    const now = new Date();
    return now.toISOString().slice(0, 10);
  });
  const [values, setValues] = useState<Record<string, string>>({});
  const [previousSnapshots, setPreviousSnapshots] = useState<Record<string, number>>({});
  const [previousDate, setPreviousDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (funds.length > 0) {
      prefillValues();
      loadPreviousSnapshots();
    }
  }, [date, funds]);

  const loadData = async () => {
    try {
      const loadedFunds = await getFunds();
      setFunds(loadedFunds.filter(f => f.active).sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const prefillValues = async () => {
    try {
      const snapshots: Snapshot[] = await getSnapshots(date, date);
      const newValues: Record<string, string> = {};
      for (const fund of funds) {
        const existing = snapshots.find(s => s.fundId === fund.id);
        if (existing) {
          newValues[fund.id] = (existing.value / 100).toFixed(2);
        }
      }
      setValues(newValues);
    } catch {
      setValues({});
    }
  };

  const loadPreviousSnapshots = async () => {
    try {
      const dayBefore = new Date(date);
      dayBefore.setDate(dayBefore.getDate() - 1);
      const toDate = dayBefore.toISOString().slice(0, 10);
      const allSnapshots: Snapshot[] = await getSnapshots('2000-01-01', toDate);

      if (allSnapshots.length === 0) {
        setPreviousSnapshots({});
        setPreviousDate(null);
        return;
      }

      const latestDate = allSnapshots.reduce((latest, s) => s.date > latest ? s.date : latest, allSnapshots[0].date);
      const latestSnapshots = allSnapshots.filter(s => s.date === latestDate);
      const prevMap: Record<string, number> = {};
      for (const snap of latestSnapshots) {
        prevMap[snap.fundId] = snap.value;
      }

      setPreviousSnapshots(prevMap);
      setPreviousDate(latestDate);
    } catch {
      setPreviousSnapshots({});
      setPreviousDate(null);
    }
  };

  const copyValue = useCallback((fundId: string) => {
    const prevValue = previousSnapshots[fundId];
    if (prevValue !== undefined) {
      setValues(prev => ({ ...prev, [fundId]: (prevValue / 100).toFixed(2) }));
    }
  }, [previousSnapshots]);

  const copyAll = useCallback(() => {
    const newValues: Record<string, string> = { ...values };
    for (const fund of funds) {
      const prevValue = previousSnapshots[fund.id];
      if (prevValue !== undefined) {
        newValues[fund.id] = (prevValue / 100).toFixed(2);
      }
    }
    setValues(newValues);
  }, [previousSnapshots, funds, values]);

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const snapshotValues = funds
        .filter(f => values[f.id] && parseFloat(values[f.id]) > 0)
        .map(f => ({
          fundId: f.id,
          value: Math.round(parseFloat(values[f.id]) * 100),
        }));

      if (snapshotValues.length === 0) {
        setError('No values to save');
        setSaving(false);
        return;
      }

      await batchCreateSnapshots({ date, values: snapshotValues });
      setSuccess(`Saved ${snapshotValues.length} snapshot(s) for ${date}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-medium)', borderTopColor: 'var(--gold)' }} />
      Loading...
    </div>
  );

  const totalPence = funds.reduce((sum, f) => {
    const val = parseFloat(values[f.id] || '0');
    return sum + (isNaN(val) ? 0 : Math.round(val * 100));
  }, 0);

  const prevTotalPence = funds.reduce((sum, f) => sum + (previousSnapshots[f.id] || 0), 0);

  const formatColumnDate = (d: string) => {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const hasPrevious = previousDate !== null;

  return (
    <div className="space-y-6 max-w-4xl">
      <h2 className="font-display text-2xl font-semibold animate-in" style={{ color: 'var(--text-primary)' }}>
        Data Entry
      </h2>

      {error && (
        <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--negative-dim)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--positive-dim)', color: '#86efac', border: '1px solid rgba(34, 197, 94, 0.2)' }}>
          {success}
        </div>
      )}

      <div className="card p-5 animate-in stagger-1">
        <div className="flex items-center gap-4 mb-6">
          <label className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
            Snapshot Date
          </label>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            className="input-dark w-auto"
          />
        </div>

        {/* Column headers */}
        <div className="flex items-center gap-3 mb-2 px-1">
          <div className="w-56 shrink-0 text-[0.65rem] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Fund</div>
          {hasPrevious && (
            <>
              <div className="w-28 text-[0.65rem] font-medium text-right" style={{ color: 'var(--text-muted)' }}>
                {formatColumnDate(previousDate!)}
              </div>
              <div className="w-8" />
            </>
          )}
          <div className="flex-1 max-w-xs text-[0.65rem] font-medium text-right pr-3" style={{ color: 'var(--text-muted)' }}>
            {formatColumnDate(date)}
          </div>
          {hasPrevious && <div className="w-20 text-[0.65rem] font-medium text-right" style={{ color: 'var(--text-muted)' }}>+/-</div>}
        </div>

        <div className="space-y-1">
          {funds.map((fund, i) => {
            const prevValue = previousSnapshots[fund.id];
            return (
              <div key={fund.id} className={`flex items-center gap-3 py-1 animate-in stagger-${Math.min(i + 1, 8)}`}>
                <div className="w-56 shrink-0 text-sm truncate" style={{ color: 'var(--text-secondary)' }} title={fund.name}>
                  {fund.name}
                  <span className="ml-1.5 text-[0.65rem] capitalize" style={{ color: 'var(--text-muted)' }}>
                    ({fund.category})
                  </span>
                </div>
                {hasPrevious && (
                  <>
                    <div className="w-28 text-sm text-right font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                      {prevValue !== undefined ? formatPence(prevValue) : <span style={{ opacity: 0.3 }}>--</span>}
                    </div>
                    <button
                      type="button"
                      onClick={() => copyValue(fund.id)}
                      disabled={prevValue === undefined}
                      className="w-8 h-8 flex items-center justify-center rounded-md transition-colors disabled:opacity-20 disabled:cursor-not-allowed"
                      style={{ color: 'var(--text-muted)' }}
                      title="Copy previous value"
                      onMouseEnter={e => { if (prevValue !== undefined) e.currentTarget.style.color = 'var(--gold)'; }}
                      onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                        <path fillRule="evenodd" d="M7 3a1 1 0 00-1 1v1h4.5A2.5 2.5 0 0113 7.5V12h1a1 1 0 001-1V4a1 1 0 00-1-1H7z" clipRule="evenodd" />
                        <path fillRule="evenodd" d="M4 7a1 1 0 00-1 1v6a1 1 0 001 1h6a1 1 0 001-1V8a1 1 0 00-1-1H4z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </>
                )}
                <div className="relative flex-1 max-w-xs">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    &pound;
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={values[fund.id] || ''}
                    onChange={e => setValues(prev => ({ ...prev, [fund.id]: e.target.value }))}
                    className="input-dark pl-7 text-right font-mono"
                    placeholder="0.00"
                  />
                </div>
                {hasPrevious && (() => {
                  const current = parseFloat(values[fund.id] || '0');
                  const prev = prevValue !== undefined ? prevValue / 100 : 0;
                  const diff = current - prev;
                  if (!values[fund.id] || (prevValue === undefined && current === 0)) return <div className="w-20" />;
                  return (
                    <div className="w-20 text-right text-[0.7rem] font-mono tabular-nums" style={{ color: diff > 0 ? '#10b981' : diff < 0 ? '#ef4444' : 'var(--text-muted)' }}>
                      {diff > 0 ? '+' : ''}{formatPence(Math.round(diff * 100))}
                    </div>
                  );
                })()}
              </div>
            );
          })}
        </div>

        {/* Totals row */}
        <div className="mt-4 flex items-center gap-3 pt-4 px-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
          <div className="w-56 shrink-0 text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>Total</div>
          {hasPrevious && (
            <>
              <div className="w-28 text-sm font-bold text-right font-mono tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {formatPence(prevTotalPence)}
              </div>
              <button
                type="button"
                onClick={copyAll}
                className="w-8 h-8 flex items-center justify-center rounded-md transition-colors"
                style={{ color: 'var(--text-muted)' }}
                title="Copy all previous values"
                onMouseEnter={e => { e.currentTarget.style.color = 'var(--gold)'; }}
                onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M7 3a1 1 0 00-1 1v1h4.5A2.5 2.5 0 0113 7.5V12h1a1 1 0 001-1V4a1 1 0 00-1-1H7z" clipRule="evenodd" />
                  <path fillRule="evenodd" d="M4 7a1 1 0 00-1 1v6a1 1 0 001 1h6a1 1 0 001-1V8a1 1 0 00-1-1H4z" clipRule="evenodd" />
                </svg>
              </button>
            </>
          )}
          <div className="flex-1 max-w-xs text-sm font-bold text-right font-mono pr-3" style={{ color: 'var(--gold-bright)' }}>
            {formatPence(totalPence)}
          </div>
          {hasPrevious && (() => {
            const diff = totalPence - prevTotalPence;
            return (
              <div className="w-20 text-right text-[0.7rem] font-mono font-bold tabular-nums" style={{ color: diff > 0 ? '#10b981' : diff < 0 ? '#ef4444' : 'var(--text-muted)' }}>
                {diff > 0 ? '+' : ''}{formatPence(diff)}
              </div>
            );
          })()}
        </div>

        <div className="mt-4 flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-gold"
          >
            {saving ? 'Saving...' : 'Save All'}
          </button>
        </div>
      </div>
    </div>
  );
}
