import { useEffect, useState } from 'react';
import { getExpenses, createExpense, updateExpense, deleteExpense } from '../utils/api';
import { formatPence } from '../utils/formatters';
import type { Expense as ExpenseType, ExpenseCategory } from '../types';

type ExpenseForm = Omit<ExpenseType, 'id'>;

const emptyForm: ExpenseForm = {
  name: '',
  category: 'other',
  monthlyAmount: 0,
  essential: false,
  active: true,
};

const categoryLabels: Record<ExpenseCategory, string> = {
  housing: 'Housing',
  transport: 'Transport',
  food: 'Food',
  utilities: 'Utilities',
  insurance: 'Insurance',
  entertainment: 'Entertainment',
  subscriptions: 'Subscriptions',
  other: 'Other',
};

export default function Expenses() {
  const [expenses, setExpenses] = useState<ExpenseType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ExpenseForm>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [formAmountDisplay, setFormAmountDisplay] = useState('0');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const data = await getExpenses();
      setExpenses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load expenses');
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

  const handleEdit = (expense: ExpenseType) => {
    setForm({
      name: expense.name,
      category: expense.category,
      monthlyAmount: expense.monthlyAmount,
      essential: expense.essential,
      active: expense.active,
    });
    setFormAmountDisplay((expense.monthlyAmount / 100).toString());
    setEditingId(expense.id);
    setShowForm(true);
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteExpense(id);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete expense');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await updateExpense(editingId, form);
      } else {
        await createExpense(form);
      }
      setShowForm(false);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  };

  const activeExpenses = expenses.filter(e => e.active);
  const totalMonthly = activeExpenses.reduce((sum, e) => sum + e.monthlyAmount, 0);
  const totalAnnual = totalMonthly * 12;
  const essentialMonthly = activeExpenses.filter(e => e.essential).reduce((sum, e) => sum + e.monthlyAmount, 0);
  const discretionaryMonthly = totalMonthly - essentialMonthly;

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-medium)', borderTopColor: 'var(--gold)' }} />
      Loading expenses...
    </div>
  );

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex items-center justify-between animate-in">
        <h2 className="font-display text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Expenses</h2>
        <button onClick={handleAdd} className="btn-gold">Add Expense</button>
      </div>

      {error && (
        <div className="text-sm px-4 py-3 rounded-lg" style={{ background: 'var(--negative-dim)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.2)' }}>
          {error}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Total Monthly', value: formatPence(totalMonthly), accent: 'var(--text-primary)' },
          { label: 'Total Annual', value: formatPence(totalAnnual), accent: 'var(--text-primary)' },
          { label: 'Essential', value: formatPence(essentialMonthly), accent: '#fb923c' },
          { label: 'Discretionary', value: formatPence(discretionaryMonthly), accent: 'var(--teal-bright)' },
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

      {/* Essential vs Discretionary bar */}
      {activeExpenses.length > 0 && (
        <div className="card p-5 animate-in stagger-5">
          <p className="text-[0.7rem] font-medium uppercase tracking-wider mb-3" style={{ color: 'var(--text-tertiary)' }}>
            Essential vs Discretionary
          </p>
          <div className="w-full h-2 rounded-full flex overflow-hidden" style={{ background: 'var(--surface-1)' }}>
            {essentialMonthly > 0 && (
              <div
                className="h-2"
                style={{ width: `${(essentialMonthly / totalMonthly) * 100}%`, background: '#fb923c' }}
              />
            )}
            {discretionaryMonthly > 0 && (
              <div
                className="h-2"
                style={{ width: `${(discretionaryMonthly / totalMonthly) * 100}%`, background: 'var(--teal-bright)' }}
              />
            )}
          </div>
          <div className="flex justify-between text-[0.65rem] mt-2" style={{ color: 'var(--text-muted)' }}>
            <span>Essential: {totalMonthly > 0 ? ((essentialMonthly / totalMonthly) * 100).toFixed(0) : 0}%</span>
            <span>Discretionary: {totalMonthly > 0 ? ((discretionaryMonthly / totalMonthly) * 100).toFixed(0) : 0}%</span>
          </div>
        </div>
      )}

      {/* Form */}
      {showForm && (
        <div className="card p-5 animate-in">
          <h3 className="font-display text-base font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
            {editingId ? 'Edit Expense' : 'Add Expense'}
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
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Category</label>
                <select
                  value={form.category}
                  onChange={e => setForm(prev => ({ ...prev, category: e.target.value as ExpenseCategory }))}
                  className="input-dark"
                >
                  {Object.entries(categoryLabels).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-tertiary)' }}>Monthly Amount</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: 'var(--text-muted)' }}>£</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={formAmountDisplay}
                    onChange={e => {
                      setFormAmountDisplay(e.target.value);
                      setForm(prev => ({ ...prev, monthlyAmount: Math.round(parseFloat(e.target.value || '0') * 100) }));
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
                  id="essential"
                  checked={form.essential}
                  onChange={e => setForm(prev => ({ ...prev, essential: e.target.checked }))}
                />
                <label htmlFor="essential" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Essential</label>
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="expenseActive"
                  checked={form.active}
                  onChange={e => setForm(prev => ({ ...prev, active: e.target.checked }))}
                />
                <label htmlFor="expenseActive" className="text-sm" style={{ color: 'var(--text-secondary)' }}>Active</label>
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
                <th>Category</th>
                <th className="text-right">Monthly</th>
                <th className="text-right">Annual</th>
                <th>Essential</th>
                <th>Status</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {expenses.map(expense => (
                <tr key={expense.id} style={{ opacity: expense.active ? 1 : 0.4 }}>
                  <td className="td-primary">{expense.name}</td>
                  <td>{categoryLabels[expense.category] || expense.category}</td>
                  <td className="text-right td-mono">{formatPence(expense.monthlyAmount)}</td>
                  <td className="text-right td-mono">{formatPence(expense.monthlyAmount * 12)}</td>
                  <td>
                    <span className={expense.essential ? 'badge badge-orange' : 'badge badge-teal'}>
                      {expense.essential ? 'Essential' : 'Discretionary'}
                    </span>
                  </td>
                  <td>
                    <span className={expense.active ? 'badge badge-green' : 'badge badge-gray'}>
                      {expense.active ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => handleEdit(expense)}
                        className="text-xs font-medium"
                        style={{ color: 'var(--gold)' }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(expense.id)}
                        className="btn-danger"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-8 text-center" style={{ color: 'var(--text-muted)' }}>
                    No expenses yet. Click "Add Expense" to get started.
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
