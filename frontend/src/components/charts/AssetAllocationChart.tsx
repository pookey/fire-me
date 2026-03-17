import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { FireProjection } from '../../types';

interface Props {
  projections: FireProjection[];
}

export default function AssetAllocationChart({ projections }: Props) {
  const data = projections.map(p => {
    const ab = p.accessibleBreakdown ?? { equities: 0, bonds: 0, cash: 0, property: 0 };
    const lb = p.lockedBreakdown ?? { equities: 0, bonds: 0, cash: 0, property: 0 };
    const totalEquities = ab.equities + lb.equities;
    const totalBonds = ab.bonds + lb.bonds;
    const totalCash = ab.cash + lb.cash;
    const totalProperty = ab.property + lb.property;
    const grandTotal = totalEquities + totalBonds + totalCash + totalProperty;

    if (grandTotal === 0) {
      return { age: p.age, equities: 0, bonds: 0, cash: 0, property: 0 };
    }

    return {
      age: p.age,
      equities: Math.round((totalEquities / grandTotal) * 10000) / 100,
      bonds: Math.round((totalBonds / grandTotal) * 10000) / 100,
      cash: Math.round((totalCash / grandTotal) * 10000) / 100,
      property: Math.round((totalProperty / grandTotal) * 10000) / 100,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }} stackOffset="expand">
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis dataKey="age" stroke="var(--text-muted)" label={{ value: 'Age', position: 'insideBottom', offset: -5, fill: 'var(--text-tertiary)' }} />
        <YAxis tickFormatter={(v: number) => `${Math.round(v * 100)}%`} stroke="var(--text-muted)" />
        <Tooltip
          formatter={(value: number) => `${value.toFixed(1)}%`}
          contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border-medium)', borderRadius: '0.5rem' }}
          labelStyle={{ color: 'var(--text-secondary)' }}
          itemStyle={{ color: 'var(--text-primary)' }}
        />
        <Legend />
        <Area type="monotone" dataKey="equities" name="Equities" stackId="1" stroke="var(--teal-bright)" fill="var(--teal-bright)" fillOpacity={0.3} />
        <Area type="monotone" dataKey="bonds" name="Bonds" stackId="1" stroke="#818cf8" fill="#818cf8" fillOpacity={0.3} />
        <Area type="monotone" dataKey="cash" name="Cash" stackId="1" stroke="var(--gold)" fill="var(--gold)" fillOpacity={0.3} />
        <Area type="monotone" dataKey="property" name="Property" stackId="1" stroke="#f97316" fill="#f97316" fillOpacity={0.3} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
