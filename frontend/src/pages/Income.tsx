import { useEffect, useState } from 'react';
import { getIncome, createIncome, updateIncome, deleteIncome, getExpenses } from '../utils/api';
import { formatPence } from '../utils/formatters';
import type { Income as IncomeType, IncomeType as IncomeTypeEnum, Expense } from '../types';

type IncomeForm = Omit<IncomeType, 'id'>;

const emptyForm: IncomeForm = {
  name: '',
  type: 'salary',
  annualAmount: 0,
  taxable: true,
  active: true,
};

const incomeTypeLabels: Record<IncomeTypeEnum, string> = {
  salary: 'Salary',
  side_income: 'Side Income',
  rental: 'Rental',
  other: 'Other',
};

function estimateUkTax(grossAnnualPence: number): number {
  const gross = grossAnnualPence / 100;
  const personalAllowance = 12570;
  const basicRateLimit = 50270;
  const higherRateLimit = 125140;

  let allowance = personalAllowance;
  if (gross > 100000) {
    allowance = Math.max(0, personalAllowance - (gross - 100000) / 2);
  }

  let tax = 0;
  const taxable = Math.max(0, gross - allowance);

  const basicBand = Math.min(taxable, basicRateLimit - personalAllowance);
  tax += basicBand * 0.2;

  const higherBand = Math.min(Math.max(0, taxable - (basicRateLimit - personalAllowance)), higherRateLimit - basicRateLimit);
  tax += higherBand * 0.4;

  const additionalBand = Math.max(0, taxable - (higherRateLimit - personalAllowance));
  tax += additionalBand * 0.45;

  return Math.round(tax * 100);
}

export default function Income() {
  const [incomes, setIncomes] = useState<IncomeType[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<IncomeForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formAmountDisplay, setFormAmountDisplay] = useState('0');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const [incomeData, expenseData] = await Promise.all([getIncome(), getExpenses()]);
      setIncomes(incomeData);
      setExpenses(expenseData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = () => {
    setForm({ ...emptyForm });
    setFormAmountDisplay('0');
    setEditingId(null);
    setShowForm(true);
  };

  const handleEdit = (income: IncomeType) => {
    setForm({
      name: income.name,
      type: income.type,
      annualAmount: income.annualAmount,
      taxable: income.taxable,
      active: income.active,
    });
    setFormAmountDisplay((income.annualAmount / 100).toString());
    setEditingId(income.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteIncome(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete income');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await updateIncome(editingId, form);
      } else {
        await createIncome(form);
      }
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save income');
    } finally {
      setSaving(false);
    }
  };

  const activeIncomes = incomes.filter(i => i.active);
  const totalGrossAnnual = activeIncomes.reduce((sum, i) => sum + i.annualAmount, 0);
  const taxableIncome = activeIncomes.filter(i => i.taxable).reduce((sum, i) => sum + i.annualAmount, 0);
  const estimatedTax = estimateUkTax(taxableIncome);
  const estimatedNetIncome = totalGrossAnnual - estimatedTax;

  const activeExpenses = expenses.filter(e => e.active);
  const totalAnnualExpenses = activeExpenses.reduce((sum, e) => sum + e.monthlyAmount * 12, 0);
  const monthlySurplus = activeExpenses.length > 0 ? (estimatedNetIncome - totalAnnualExpenses) / 12 : null;

  const savingsRate = totalGrossAnnual > 0 && activeExpenses.length > 0
    ? ((estimatedNetIncome - totalAnnualExpenses) / estimatedNetIncome) * 100
    : null;

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-medium)', borderTopColor: 'var(--gold)' }} />
      Loading income...
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between animate-in">
        <h2 className="font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Income</h2>
        <button onClick={handleAdd} className="btn-gold">Add Income</button>
      </div>

      {error && (
        <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--negative-dim)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Gross Annual', value: formatPence(totalGrossAnnual), accent: 'var(--text-primary)' },
          { label: 'Estimated Tax', value: formatPence(estimatedTax), accent: 'var(--negative)' },
          { label: 'Net Income', value: formatPence(estimatedNetIncome), accent: 'var(--positive)' },
          {
            label: monthlySurplus !== null ? 'Monthly Surplus' : 'Monthly Net',
            value: monthlySurplus !== null ? formatPence(Math.round(monthlySurplus)) : formatPence(Math.round(estimatedNetIncome / 12)),
            accent: monthlySurplus !== null && monthlySurplus < 0 ? 'var(--negative)' : 'var(--gold-bright)',
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

      {/* Savings Rate */}
      {savingsRate !== null && (
        <div className="card p-5 animate-in stagger-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[0.7rem] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>
              Savings Rate
            </p>
            <span className="font-mono text-sm font-bold" style={{ color: savingsRate >= 0 ? 'var(--positive)' : 'var(--negative)' }}>
              {savingsRate.toFixed(1)}%
            </span>
          </div>
          <div className="progress-track">
            <div
              className="progress-fill-positive"
              style={{ width: `${Math.max(0, Math.min(100, savingsRate))}%` }}
            />
          </div>
          <p className="text-[0.65rem] mt-2" style={{ color: 'var(--text-muted)' }}>
            (Net Income - Expenses) / Net Income
          </p>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="card p-5 animate-in">
          <h3 className="font-display text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            {editingId ? 'Edit Income' : 'Add Income'}
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
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Type</label>
                <select
                  value={form.type}
                  onChange={e => setForm(prev => ({ ...prev, type: e.target.value as IncomeTypeEnum }))}
                  className="input-dark"
                >
                  {Object.entries(incomeTypeLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Annual Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>£</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formAmountDisplay}
                    onChange={e => {
                      setFormAmountDisplay(e.target.value);
                      setForm(prev => ({ ...prev, annualAmount: Math.round(parseFloat(e.target.value || '0') * 100) }));
                    }}
                    required
                    className="input-dark pl-7 font-mono"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="taxable"
                  checked={form.taxable}
                  onChange={e => setForm(prev => ({ ...prev, taxable: e.target.checked }))}
                />
                <label htmlFor="taxable" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Taxable</label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="incomeActive"
                  checked={form.active}
                  onChange={e => setForm(prev => ({ ...prev, active: e.target.checked }))}
                />
                <label htmlFor="incomeActive" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Active</label>
              </div>
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
      <div className="card overflow-hidden animate-in stagger-6">
        <div className="overflow-x-auto">
          <table className="table-dark">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th className="text-right">Annual Amount</th>
                <th>Taxable</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {incomes.map(income => (
                <tr key={income.id} style={{ opacity: income.active ? 1 : 0.4 }}>
                  <td className="td-primary">{income.name}</td>
                  <td>{incomeTypeLabels[income.type] || income.type}</td>
                  <td className="text-right td-mono">{formatPence(income.annualAmount)}</td>
                  <td>
                    <span className={income.taxable ? 'badge badge-gold' : 'badge badge-gray'}>
                      {income.taxable ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td>
                    <span className={income.active ? 'badge badge-green' : 'badge badge-gray'}>
                      {income.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleEdit(income)}
                        className="text-xs font-medium"
                        style={{ color: 'var(--gold)' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(income.id)}
                        className="btn-danger"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {incomes.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                    No income sources yet. Click "Add Income" to get started.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
