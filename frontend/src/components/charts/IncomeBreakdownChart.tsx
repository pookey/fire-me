import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { FireProjection } from '../../types';
import { formatPoundsShort } from '../../utils/formatters';

interface Props {
  projections: FireProjection[];
}

export default function IncomeBreakdownChart({ projections }: Props) {
  const data = projections.map(p => ({
    age: p.age,
    statePension: p.statePension,
    dbIncome: p.definedBenefitIncome ?? 0,
    taxPaid: p.taxPaid ?? 0,
    annualSpend: p.annualSpend,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="age" label={{ value: 'Age', position: 'insideBottom', offset: -5 }} />
        <YAxis tickFormatter={(v: number) => formatPoundsShort(v)} />
        <Tooltip formatter={(value: number) => formatPoundsShort(value)} />
        <Legend />
        <Bar
          dataKey="statePension"
          name="State Pension"
          stackId="1"
          stroke="#059669"
          fill="#a7f3d0"
        />
        <Bar
          dataKey="dbIncome"
          name="DB Pension"
          stackId="1"
          stroke="#0891b2"
          fill="#a5f3fc"
        />
        <Bar
          dataKey="taxPaid"
          name="Tax Paid"
          stackId="1"
          stroke="#dc2626"
          fill="#fecaca"
        />
        <Line
          type="monotone"
          dataKey="annualSpend"
          name="Annual Spend"
          stroke="#6366f1"
          strokeWidth={2}
          strokeDasharray="5 5"
          dot={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
