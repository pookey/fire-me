import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import type { Snapshot } from '../../types';
import { formatPenceShort, formatDate } from '../../utils/formatters';

interface Props {
  snapshots: Snapshot[];
}

export default function FundBreakdownChart({ snapshots }: Props) {
  const fundNames = [...new Set(snapshots.map(s => s.fundName))];
  const dates = [...new Set(snapshots.map(s => s.date))].sort();

  const data = dates.map(date => {
    const entry: Record<string, string | number> = { date, timestamp: new Date(date).getTime(), label: formatDate(date) };
    for (const name of fundNames) {
      const snap = snapshots.find(s => s.date === date && s.fundName === name);
      entry[name] = snap?.value ?? 0;
    }
    return entry;
  });

  const colors = [
    '#e8c547', '#2dd4bf', '#818cf8', '#f97316', '#ec4899',
    '#84cc16', '#06b6d4', '#a855f7', '#f43f5e', '#fbbf24',
  ];

  return (
    <ResponsiveContainer width="100%" height={400}>
      <AreaChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
        {fundNames.map((name, i) => (
          <Area
            key={name}
            type="monotone"
            dataKey={name}
            stackId="1"
            stroke={colors[i % colors.length]}
            fill={colors[i % colors.length]}
            fillOpacity={0.3}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
