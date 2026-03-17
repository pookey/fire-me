import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import type { FireProjection } from '../../types';

interface Props {
  projections: FireProjection[];
}

export default function WithdrawalRateChart({ projections }: Props) {
  const data = projections.map(p => {
    const impliedRate = p.total > 0 ? (p.annualSpend / p.total) * 100 : 0;
    return {
      age: p.age,
      impliedRate: Math.round(impliedRate * 100) / 100,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={300}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis dataKey="age" stroke="var(--text-muted)" label={{ value: 'Age', position: 'insideBottom', offset: -5, fill: 'var(--text-tertiary)' }} />
        <YAxis
          tickFormatter={(v: number) => `${v}%`}
          domain={[0, 'auto']}
          stroke="var(--text-muted)"
          label={{ value: 'Withdrawal Rate %', angle: -90, position: 'insideLeft', fill: 'var(--text-tertiary)' }}
        />
        <Tooltip
          formatter={(value: number) => `${value}%`}
          contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border-medium)', borderRadius: '0.5rem' }}
          labelStyle={{ color: 'var(--text-secondary)' }}
          itemStyle={{ color: 'var(--text-primary)' }}
        />
        <Legend />
        <ReferenceLine y={4} stroke="var(--negative)" strokeDasharray="3 3" label={{ value: '4% rule', position: 'right', fontSize: 10, fill: 'var(--negative)' }} />
        <ReferenceLine y={3} stroke="var(--gold)" strokeDasharray="3 3" label={{ value: '3%', position: 'right', fontSize: 10, fill: 'var(--gold)' }} />
        <Line
          type="monotone"
          dataKey="impliedRate"
          name="Implied Withdrawal Rate"
          stroke="var(--teal-bright)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
