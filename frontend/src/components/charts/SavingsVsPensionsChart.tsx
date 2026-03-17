import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { Snapshot } from '../../types';
import { formatPenceShort, formatDate } from '../../utils/formatters';

interface Props {
  snapshots: Snapshot[];
}

export default function SavingsVsPensionsChart({ snapshots }: Props) {
  const dateMap = new Map<string, { savings: number; pensions: number }>();

  for (const s of snapshots) {
    const entry = dateMap.get(s.date) || { savings: 0, pensions: 0 };
    if (s.category === 'pension') {
      entry.pensions += s.value;
    } else {
      entry.savings += s.value;
    }
    dateMap.set(s.date, entry);
  }

  const data = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({
      date,
      timestamp: new Date(date).getTime(),
      label: formatDate(date),
      savings: values.savings,
      pensions: values.pensions,
    }));

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="timestamp"
          type="number"
          scale="time"
          domain={['dataMin', 'dataMax']}
          tickFormatter={(ts: number) => formatDate(new Date(ts).toISOString().slice(0, 10))}
          stroke="var(--text-muted)"
        />
        <YAxis tickFormatter={(v: number) => formatPenceShort(v)} stroke="var(--text-muted)" />
        <Tooltip
          formatter={(value: number) => formatPenceShort(value)}
          labelFormatter={(ts: number) => formatDate(new Date(ts).toISOString().slice(0, 10))}
          contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border-medium)', borderRadius: '0.5rem' }}
          labelStyle={{ color: 'var(--text-secondary)' }}
          itemStyle={{ color: 'var(--text-primary)' }}
        />
        <Legend />
        <Line type="monotone" dataKey="savings" name="Savings" stroke="var(--teal-bright)" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="pensions" name="Pensions" stroke="#818cf8" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
