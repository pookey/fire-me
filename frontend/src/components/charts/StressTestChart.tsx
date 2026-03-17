import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { formatPoundsShort } from '../../utils/formatters';
import type { StressTestResult } from '../../types';

const SCENARIO_COLORS = ['#ef4444', '#f97316', '#a855f7', '#ec4899'];

interface Props {
  stressResult: StressTestResult;
}

export default function StressTestChart({ stressResult }: Props) {
  const { baseCase, scenarios, pensionAccessAge } = stressResult;

  // Build chart data keyed by age
  const ageMap = new Map<number, Record<string, number>>();

  for (const by of baseCase.bridgeYears) {
    ageMap.set(by.age, { age: by.age, baseCase: by.balance });
  }

  scenarios.forEach((scenario, i) => {
    for (const by of scenario.bridgeYears) {
      const entry = ageMap.get(by.age);
      if (entry) {
        entry[`scenario_${i}`] = by.balance;
      } else {
        ageMap.set(by.age, { age: by.age, [`scenario_${i}`]: by.balance });
      }
    }
  });

  const data = [...ageMap.values()].sort((a, b) => a.age - b.age);

  if (data.length === 0) return null;

  return (
    <ResponsiveContainer width="100%" height={350}>
      <LineChart data={data} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
        <XAxis
          dataKey="age"
          stroke="var(--text-muted)"
          label={{ value: 'Age', position: 'insideBottom', offset: -5, fill: 'var(--text-tertiary)' }}
        />
        <YAxis
          tickFormatter={(v: number) => formatPoundsShort(v)}
          stroke="var(--text-muted)"
        />
        <Tooltip
          formatter={(value: number, name: string) => [formatPoundsShort(value), name]}
          contentStyle={{ background: 'var(--surface-3)', border: '1px solid var(--border-medium)', borderRadius: '0.5rem' }}
          labelStyle={{ color: 'var(--text-secondary)' }}
          itemStyle={{ color: 'var(--text-primary)' }}
          labelFormatter={(age: number) => `Age ${age}`}
        />
        <Legend />
        <ReferenceLine y={0} stroke="var(--negative)" strokeDasharray="5 5" strokeWidth={1} />
        <ReferenceLine
          x={pensionAccessAge}
          stroke="var(--gold)"
          strokeDasharray="3 3"
          label={{ value: 'Pensions Unlock', position: 'top', fontSize: 10, fill: 'var(--gold)' }}
        />
        <Line
          type="monotone"
          dataKey="baseCase"
          name="Base Case"
          stroke="var(--gold-bright)"
          strokeWidth={2}
          dot={false}
        />
        {scenarios.map((scenario, i) => (
          <Line
            key={scenario.config.type}
            type="monotone"
            dataKey={`scenario_${i}`}
            name={scenario.config.label}
            stroke={SCENARIO_COLORS[i % SCENARIO_COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}
