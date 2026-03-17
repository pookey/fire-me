import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { formatPoundsShort } from '../../utils/formatters';
import type { FireProjection } from '../../types';

interface Props {
  projections: FireProjection[];
  pensionAccessAge: number;
}

export default function WrapperDrawdownChart({ projections, pensionAccessAge }: Props) {
  const data = projections.map(p => ({
    age: p.age,
    ISA: p.isa ?? 0,
    LISA: p.lisa ?? 0,
    SIPP: p.sipp ?? 0,
    GIA: p.gia ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={350}>
      <AreaChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis dataKey="age" stroke="var(--text-muted)" label={{ value: 'Age', position: 'insideBottom', offset: -5, fill: 'var(--text-tertiary)' }} />
        <YAxis tickFormatter={(v: number) => formatPoundsShort(v)} stroke="var(--text-muted)" />
        <Tooltip
          formatter={(value: number) => formatPoundsShort(value)}
          contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border-medium)', borderRadius: '0.5rem' }}
          labelStyle={{ color: 'var(--text-secondary)' }}
          itemStyle={{ color: 'var(--text-primary)' }}
        />
        <Legend />
        <ReferenceLine x={pensionAccessAge} stroke="var(--gold)" strokeDasharray="3 3" label={{ value: 'SIPP Access', position: 'top', fontSize: 10, fill: 'var(--gold)' }} />
        <Area type="monotone" dataKey="ISA" name="ISA" stackId="1" stroke="var(--teal-bright)" fill="var(--teal-bright)" fillOpacity={0.3} />
        <Area type="monotone" dataKey="LISA" name="LISA" stackId="1" stroke="#10b981" fill="#10b981" fillOpacity={0.3} />
        <Area type="monotone" dataKey="SIPP" name="SIPP" stackId="1" stroke="#818cf8" fill="#818cf8" fillOpacity={0.3} />
        <Area type="monotone" dataKey="GIA" name="GIA" stackId="1" stroke="#f97316" fill="#f97316" fillOpacity={0.3} />
      </AreaChart>
    </ResponsiveContainer>
  );
}
