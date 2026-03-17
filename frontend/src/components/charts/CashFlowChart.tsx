import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatPoundsShort } from '../../utils/formatters';
import type { FireProjection } from '../../types';

interface Props {
  projections: FireProjection[];
  retirementStartAge: number;
}

export default function CashFlowChart({ projections, retirementStartAge }: Props) {
  const data = projections
    .filter(p => p.age >= retirementStartAge)
    .map(p => ({
      age: p.age,
      drawdownIsa: p.drawdownIsa ?? 0,
      drawdownLisa: p.drawdownLisa ?? 0,
      drawdownSipp: p.drawdownSipp ?? 0,
      drawdownGia: p.drawdownGia ?? 0,
      statePension: p.statePension,
      definedBenefitIncome: p.definedBenefitIncome ?? 0,
      taxPaid: p.taxPaid ?? 0,
      annualSpend: p.annualSpend,
    }));

  if (data.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        No retirement projections available yet.
      </p>
    );
  }

  return (
    <ResponsiveContainer width="100%" height={350}>
      <ComposedChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
        <Bar dataKey="drawdownIsa" name="ISA Drawdown" stackId="income" fill="var(--teal-bright)" fillOpacity={0.7} />
        <Bar dataKey="drawdownLisa" name="LISA Drawdown" stackId="income" fill="#10b981" fillOpacity={0.7} />
        <Bar dataKey="drawdownSipp" name="SIPP Drawdown" stackId="income" fill="#818cf8" fillOpacity={0.7} />
        <Bar dataKey="drawdownGia" name="GIA Drawdown" stackId="income" fill="#f97316" fillOpacity={0.7} />
        <Bar dataKey="statePension" name="State Pension" stackId="income" fill="var(--gold)" fillOpacity={0.7} />
        <Bar dataKey="definedBenefitIncome" name="DB Pension" stackId="income" fill="#06b6d4" fillOpacity={0.7} />
        <Bar dataKey="taxPaid" name="Tax" stackId="income" fill="var(--negative)" fillOpacity={0.5} />
        <Line type="monotone" dataKey="annualSpend" name="Annual Spend" stroke="var(--negative)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
