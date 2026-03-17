import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { Snapshot } from '../../types';
import { formatPenceShort, formatDate } from '../../utils/formatters';

interface Props {
  snapshots: Snapshot[];
}

export default function NetWorthChart({ snapshots }: Props) {
  const dateMap = new Map<string, number>();
  for (const s of snapshots) {
    dateMap.set(s.date, (dateMap.get(s.date) || 0) + s.value);
  }

  const data = Array.from(dateMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, value]) => ({
      date,
      timestamp: new Date(date).getTime(),
      label: formatDate(date),
      value,
    }));

  return (
    <ResponsiveContainer width="100%" height={400}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <defs>
          <linearGradient id="goldLine" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#c9a227" />
            <stop offset="100%" stopColor="#e8c547" />
          </linearGradient>
        </defs>
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
          formatter={(value: number) => [formatPenceShort(value), 'Net Worth']}
          labelFormatter={(ts: number) => formatDate(new Date(ts).toISOString().slice(0, 10))}
          contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border-medium)', borderRadius: '0.5rem' }}
          labelStyle={{ color: 'var(--text-secondary)' }}
          itemStyle={{ color: 'var(--text-primary)' }}
        />
        <Line type="monotone" dataKey="value" stroke="url(#goldLine)" strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
