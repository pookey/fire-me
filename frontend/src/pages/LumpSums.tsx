import { useEffect, useMemo, useState } from 'react';
import { getFunds, updateFund } from '../utils/api';
import type { Fund, LumpSum } from '../types';
import MonthYearPicker from '../components/MonthYearPicker';
import { formatStartDate } from '../utils/dateHelpers';

type FormState = {
  fundId: string;
  type: LumpSum['type'];
  amount: number;
  date: string;
  description: string;
  active: boolean;
};

const emptyForm: FormState = {
  fundId: '',
  type: 'inflow',
  amount: 0,
  date: '',
  description: '',
  active: true,
};

type AggregatedLumpSum = LumpSum & {
  fundId: string;
  fundName: string;
  index: number;
};

export default function LumpSums() {
  const [funds, setFunds] = useState<Fund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<{ fundId: string; index: number } | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadFunds();
  }, []);

  const loadFunds = async () => {
    try {
      const data = await getFunds();
      setFunds(data.sort((a, b) => a.sortOrder - b.sortOrder));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load funds');
    } finally {
      setLoading(false);
    }
  };

  const aggregated = useMemo<AggregatedLumpSum[]>(() => {
    const rows: AggregatedLumpSum[] = [];
    for (const f of funds) {
      (f.lumpSums ?? []).forEach((ls, index) => {
        rows.push({ ...ls, fundId: f.id, fundName: f.name, index });
      });
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    return rows;
  }, [funds]);

  const handleAdd = () => {
    setForm({ ...emptyForm, fundId: funds[0]?.id ?? '' });
    setEditing(null);
    setShowForm(true);
  };

  const handleEdit = (row: AggregatedLumpSum) => {
    setForm({
      fundId: row.fundId,
      type: row.type,
      amount: row.amount,
      date: row.date,
      description: row.description,
      active: row.active !== false,
    });
    setEditing({ fundId: row.fundId, index: row.index });
    setShowForm(true);
  };

  const handleRemove = async (row: AggregatedLumpSum) => {
    if (!confirm(`Remove "${row.description || 'lump sum'}" from ${row.fundName}?`)) return;
    setError('');
    try {
      const fund = funds.find(f => f.id === row.fundId);
      if (!fund) return;
      const next = (fund.lumpSums ?? []).filter((_, i) => i !== row.index);
      await updateFund(row.fundId, { lumpSums: next });
      await loadFunds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove lump sum');
    }
  };

  const handleToggleActive = async (row: AggregatedLumpSum) => {
    setError('');
    try {
      const fund = funds.find(f => f.id === row.fundId);
      if (!fund) return;
      const isActive = row.active !== false;
      const next = (fund.lumpSums ?? []).map((ls, i) =>
        i === row.index ? { ...ls, active: !isActive } : ls,
      );
      await updateFund(row.fundId, { lumpSums: next });
      await loadFunds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update lump sum');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fundId) {
      setError('Pick a fund');
      return;
    }
    if (!form.date) {
      setError('Pick a date');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const newEntry: LumpSum = {
        type: form.type,
        amount: form.amount,
        date: form.date,
        description: form.description,
        active: form.active,
      };

      if (editing && editing.fundId === form.fundId) {
        const fund = funds.find(f => f.id === form.fundId);
        if (!fund) throw new Error('Fund no longer exists');
        const next = (fund.lumpSums ?? []).map((ls, i) => (i === editing.index ? newEntry : ls));
        await updateFund(form.fundId, { lumpSums: next });
      } else if (editing) {
        // Moved between funds: remove from old, add to new
        const oldFund = funds.find(f => f.id === editing.fundId);
        const newFund = funds.find(f => f.id === form.fundId);
        if (!oldFund || !newFund) throw new Error('Fund no longer exists');
        const oldNext = (oldFund.lumpSums ?? []).filter((_, i) => i !== editing.index);
        await updateFund(editing.fundId, { lumpSums: oldNext });
        const newNext = [...(newFund.lumpSums ?? []), newEntry];
        await updateFund(form.fundId, { lumpSums: newNext });
      } else {
        const fund = funds.find(f => f.id === form.fundId);
        if (!fund) throw new Error('Fund no longer exists');
        const next = [...(fund.lumpSums ?? []), newEntry];
        await updateFund(form.fundId, { lumpSums: next });
      }
      setShowForm(false);
      setEditing(null);
      await loadFunds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save lump sum');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-medium)', borderTopColor: 'var(--gold)' }} />
      Loading lump sums...
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between animate-in">
        <div>
          <h2 className="font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Lump Sums</h2>
          <p className="text-sm mt-1" style={{ color: 'var(--text-tertiary)' }}>
            One-off inflows (e.g. inheritance, bonus) or outflows (e.g. car purchase) applied to FIRE projections.
          </p>
        </div>
        <button onClick={handleAdd} className="btn-gold" disabled={funds.length === 0}>Add Lump Sum</button>
      </div>

      {error && (
        <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--negative-dim)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </div>
      )}

      {showForm && (
        <div className="card p-5 animate-in">
          <h3 className="font-display text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            {editing ? 'Edit Lump Sum' : 'Add Lump Sum'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Description</label>
              <input
                type="text"
                value={form.description}
                onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                placeholder="e.g. Inheritance, bonus, car purchase"
                className="input-dark"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Fund</label>
                <select
                  value={form.fundId}
                  onChange={e => setForm(prev => ({ ...prev, fundId: e.target.value }))}
                  className="input-dark"
                  required
                >
                  <option value="">Pick a fund</option>
                  {funds.map(f => (
                    <option key={f.id} value={f.id}>{f.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm(prev => ({ ...prev, type: e.target.value as LumpSum['type'] }))}
                  className="input-dark"
                >
                  <option value="inflow">Inflow</option>
                  <option value="outflow">Outflow</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Date</label>
                <MonthYearPicker
                  value={form.date || undefined}
                  onChange={v => setForm(prev => ({ ...prev, date: v ?? '' }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Amount (£)</label>
                <input
                  type="number"
                  value={form.amount || ''}
                  onChange={e => setForm(prev => ({ ...prev, amount: Number(e.target.value) }))}
                  className="input-dark font-mono"
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-gold">
                {saving ? 'Saving...' : editing ? 'Update' : 'Create'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setEditing(null); }} className="btn-ghost">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="card overflow-hidden animate-in stagger-1">
        <div className="overflow-x-auto">
          <table className="table-dark">
            <thead>
              <tr>
                <th>Date</th>
                <th>Fund</th>
                <th>Type</th>
                <th className="text-right">Amount</th>
                <th>Description</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {aggregated.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center text-sm" style={{ color: 'var(--text-muted)', padding: '2rem' }}>
                    No lump sums yet. {funds.length === 0 ? 'Add a fund first.' : 'Click "Add Lump Sum" to get started.'}
                  </td>
                </tr>
              ) : aggregated.map(row => {
                const isActive = row.active !== false;
                return (
                  <tr key={`${row.fundId}-${row.index}`} style={{ opacity: isActive ? 1 : 0.4 }}>
                    <td>{formatStartDate(row.date) || row.date}</td>
                    <td className="td-primary">{row.fundName}</td>
                    <td>
                      <span className={row.type === 'inflow' ? 'badge badge-green' : 'badge badge-gray'}>
                        {row.type === 'inflow' ? 'Inflow' : 'Outflow'}
                      </span>
                    </td>
                    <td className="td-mono text-right">
                      {row.type === 'outflow' ? '-' : ''}£{row.amount.toLocaleString('en-GB')}
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{row.description || '—'}</td>
                    <td>
                      <span className={isActive ? 'badge badge-green' : 'badge badge-gray'}>
                        {isActive ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleEdit(row)}
                          className="text-xs font-medium transition-colors"
                          style={{ color: 'var(--gold)' }}
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleToggleActive(row)}
                          className="text-xs font-medium transition-colors"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          {isActive ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          onClick={() => handleRemove(row)}
                          className="text-xs font-medium transition-colors"
                          style={{ color: 'var(--text-tertiary)' }}
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
