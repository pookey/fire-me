import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { formatPoundsShort } from '../../utils/formatters';
import type { FireProjection } from '../../types';

interface Props {
  projections: FireProjection[];
}

export default function WrapperBreakdownChart({ projections }: Props) {
  const data = projections.map(p => ({
    age: p.age,
    isa: p.isa ?? 0,
    lisa: p.lisa ?? 0,
    sipp: p.sipp ?? 0,
    gia: p.gia ?? 0,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <AreaChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="age" label={{ value: 'Age', position: 'insideBottom', offset: -5 }} />
        <YAxis tickFormatter={(v: number) => formatPoundsShort(v)} />
        <Tooltip formatter={(value: number) => formatPoundsShort(value)} />
        <Legend />
        <Area type="monotone" dataKey="isa" name="ISA" stackId="1" stroke="#0ea5e9" fill="#bae6fd" />
        <Area type="monotone" dataKey="lisa" name="LISA" stackId="1" stroke="#10b981" fill="#a7f3d0" />
        <Area type="monotone" dataKey="sipp" name="SIPP" stackId="1" stroke="#8b5cf6" fill="#ddd6fe" />
        <Area type="monotone" dataKey="gia" name="GIA" stackId="1" stroke="#f97316" fill="#fed7aa" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
