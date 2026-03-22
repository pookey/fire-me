import { useEffect, useState } from 'react';
import { getFunds, createFund, updateFund } from '../utils/api';
import type { Fund, TaxWrapper } from '../types';

type FundForm = Omit<Fund, 'id'>;

const emptyForm: FundForm = {
  name: '',
  description: '',
  category: 'savings',
  subcategory: 'equities',
  wrapper: 'gia',
  active: true,
  sortOrder: 0,
  drawdownAge: undefined,
  monthlyContribution: undefined,
  contributionEndAge: undefined,
  take25PctLumpSum: undefined,
};

export default function Funds() {
  const [funds, setFunds] = useState<Fund[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FundForm>(emptyForm);
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

  const handleAdd = () => {
    setForm({ ...emptyForm, sortOrder: funds.length });
    setEditingId(null);
    setShowForm(true);
  };

  const handleEdit = (fund: Fund) => {
    setForm({
      name: fund.name,
      description: fund.description ?? '',
      category: fund.category,
      subcategory: fund.subcategory,
      wrapper: fund.wrapper ?? (fund.category === 'pension' ? 'sipp' : 'gia'),
      active: fund.active,
      sortOrder: fund.sortOrder,
      drawdownAge: fund.drawdownAge,
      monthlyContribution: fund.monthlyContribution,
      contributionEndAge: fund.contributionEndAge,
      take25PctLumpSum: fund.take25PctLumpSum,
    });
    setEditingId(fund.id);
    setShowForm(true);
  };

  const handleToggleActive = async (fund: Fund) => {
    try {
      await updateFund(fund.id, { active: !fund.active });
      await loadFunds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update fund');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await updateFund(editingId, form);
      } else {
        await createFund(form);
      }
      setShowForm(false);
      await loadFunds();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save fund');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-medium)', borderTopColor: 'var(--gold)' }} />
      Loading funds...
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between animate-in">
        <h2 className="font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Funds</h2>
        <button onClick={handleAdd} className="btn-gold">Add Fund</button>
      </div>

      {error && (
        <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--negative-dim)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="card p-5 animate-in">
          <h3 className="font-display text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            {editingId ? 'Edit Fund' : 'Add Fund'}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Name</label>
                <input
                  type="text"
                  value={form.name}
                  onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                  required
                  className="input-dark"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Description</label>
                <textarea
                  value={form.description ?? ''}
                  onChange={e => setForm(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Optional — e.g. purpose, notes for FIRE advisor"
                  rows={2}
                  className="input-dark resize-y"
                />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Category</label>
                <select
                  value={form.category}
                  onChange={e => setForm(prev => ({ ...prev, category: e.target.value as Fund['category'] }))}
                  className="input-dark"
                >
                  <option value="savings">Savings</option>
                  <option value="pension">Pension</option>
                  <option value="property">Property</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Subcategory</label>
                <select
                  value={form.subcategory}
                  onChange={e => setForm(prev => ({ ...prev, subcategory: e.target.value as Fund['subcategory'] }))}
                  className="input-dark"
                >
                  <option value="equities">Equities</option>
                  <option value="bonds">Bonds</option>
                  <option value="cash">Cash</option>
                  <option value="property">Property</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Tax Wrapper</label>
                <select
                  value={form.wrapper ?? 'gia'}
                  onChange={e => setForm(prev => ({ ...prev, wrapper: e.target.value as TaxWrapper }))}
                  className="input-dark"
                >
                  <option value="isa">ISA</option>
                  <option value="lisa">LISA</option>
                  <option value="sipp">SIPP</option>
                  <option value="gia">GIA</option>
                  <option value="none">None</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Sort Order</label>
                <input
                  type="number"
                  value={form.sortOrder}
                  onChange={e => setForm(prev => ({ ...prev, sortOrder: Number(e.target.value) }))}
                  className="input-dark"
                />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="active"
                checked={form.active}
                onChange={e => setForm(prev => ({ ...prev, active: e.target.checked }))}
              />
              <label htmlFor="active" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Active</label>
            </div>

            {/* Projections */}
            <div className="pt-4 mt-2" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <h4 className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>Projections</h4>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Drawdown Age</label>
                  <input
                    type="number"
                    value={form.drawdownAge ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, drawdownAge: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder={form.wrapper === 'sipp' || (form.category === 'pension' && !form.wrapper) ? 'Pension age' : form.wrapper === 'lisa' ? '60' : 'Now'}
                    className="input-dark"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Monthly Contribution</label>
                  <input
                    type="number"
                    value={form.monthlyContribution ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, monthlyContribution: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="None"
                    className="input-dark font-mono"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Contribution End Age</label>
                  <input
                    type="number"
                    value={form.contributionEndAge ?? ''}
                    onChange={e => setForm(prev => ({ ...prev, contributionEndAge: e.target.value ? Number(e.target.value) : undefined }))}
                    placeholder="Indefinite"
                    className="input-dark"
                  />
                </div>
              </div>
              {(form.wrapper === 'sipp' || (form.category === 'pension' && !form.wrapper)) && (
                <div className="flex items-center gap-2 mt-3">
                  <input
                    type="checkbox"
                    id="take25PctLumpSum"
                    checked={form.take25PctLumpSum ?? false}
                    onChange={e => setForm(prev => ({ ...prev, take25PctLumpSum: e.target.checked }))}
                  />
                  <label htmlFor="take25PctLumpSum" className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    Take 25% tax-free lump sum at drawdown age
                  </label>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button type="submit" disabled={saving} className="btn-gold">
                {saving ? 'Saving...' : editingId ? 'Update' : 'Create'}
              </button>
              <button type="button" onClick={() => setShowForm(false)} className="btn-ghost">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Table */}
      <div className="card overflow-hidden animate-in stagger-1">
        <div className="overflow-x-auto">
          <table className="table-dark">
            <thead>
              <tr>
                <th>Name</th>
                <th>Category</th>
                <th>Subcategory</th>
                <th>Wrapper</th>
                <th>Contribution</th>
                <th>Drawdown</th>
                <th>Order</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {funds.map(fund => (
                <tr key={fund.id} style={{ opacity: fund.active ? 1 : 0.4 }}>
                  <td className="td-primary">
                    {fund.name}
                    {fund.description && (
                      <div className="text-xs mt-0.5 font-normal" style={{ color: 'var(--text-tertiary)' }}>
                        {fund.description}
                      </div>
                    )}
                  </td>
                  <td className="capitalize">{fund.category}</td>
                  <td className="capitalize">{fund.subcategory}</td>
                  <td className="uppercase">{fund.wrapper ?? '-'}</td>
                  <td className="td-mono">
                    {fund.monthlyContribution ? `£${fund.monthlyContribution}/mo` : '—'}
                  </td>
                  <td>{fund.drawdownAge ? `Age ${fund.drawdownAge}` : 'Default'}</td>
                  <td>{fund.sortOrder}</td>
                  <td>
                    <span className={fund.active ? 'badge badge-green' : 'badge badge-gray'}>
                      {fund.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleEdit(fund)}
                        className="text-xs font-medium transition-colors"
                        style={{ color: 'var(--gold)' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleToggleActive(fund)}
                        className="text-xs font-medium transition-colors"
                        style={{ color: 'var(--text-tertiary)' }}
                      >
                        {fund.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
