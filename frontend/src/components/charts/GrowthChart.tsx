import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { Snapshot } from '../../types';
import { formatPenceShort, formatDate } from '../../utils/formatters';

interface Props {
  snapshots: Snapshot[];
}

export default function GrowthChart({ snapshots }: Props) {
  // Group snapshots by month, taking the latest snapshot per fund per month
  const monthFundMap = new Map<string, Map<string, { value: number; category: string; date: string }>>();

  for (const s of snapshots) {
    const month = s.date.slice(0, 7); // YYYY-MM
    if (!monthFundMap.has(month)) monthFundMap.set(month, new Map());
    const fundMap = monthFundMap.get(month)!;
    const existing = fundMap.get(s.fundId);
    if (!existing || s.date > existing.date) {
      fundMap.set(s.fundId, { value: s.value, category: s.category, date: s.date });
    }
  }

  // Aggregate per month
  const monthMap = new Map<string, { savings: number; pensions: number; property: number }>();
  for (const [month, fundMap] of monthFundMap) {
    const totals = { savings: 0, pensions: 0, property: 0 };
    for (const { value, category } of fundMap.values()) {
      if (category === 'pension') totals.pensions += value;
      else if (category === 'property') totals.property += value;
      else totals.savings += value;
    }
    monthMap.set(month, totals);
  }

  const sortedMonths = Array.from(monthMap.entries()).sort(([a], [b]) => a.localeCompare(b));

  const data = sortedMonths.slice(1).map(([month, values], i) => {
    const prev = sortedMonths[i][1];
    return {
      date: month,
      label: formatDate(month + '-01'),
      savings: values.savings - prev.savings,
      pensions: values.pensions - prev.pensions,
      property: values.property - prev.property,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={400}>
      <BarChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis dataKey="label" stroke="var(--text-muted)" />
        <YAxis tickFormatter={(v: number) => formatPenceShort(v)} stroke="var(--text-muted)" />
        <Tooltip
          formatter={(value: number) => formatPenceShort(value)}
          contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border-medium)', borderRadius: '0.5rem' }}
          labelStyle={{ color: 'var(--text-secondary)' }}
          itemStyle={{ color: 'var(--text-primary)' }}
        />
        <Legend />
        <Bar dataKey="savings" name="Savings" fill="var(--teal-bright)" radius={[2, 2, 0, 0]} />
        <Bar dataKey="pensions" name="Pensions" fill="#818cf8" radius={[2, 2, 0, 0]} />
        <Bar dataKey="property" name="Property" fill="var(--gold)" radius={[2, 2, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
