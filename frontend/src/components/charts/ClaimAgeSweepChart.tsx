import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatPoundsShort } from '../../utils/formatters';
import type { ClaimAgeSweepRow } from '../../utils/teachersPension';

export interface NpaMarker {
  age: number;
  label: string;
  color: string;
}

interface Props {
  rows: ClaimAgeSweepRow[];
  selectedClaimAge: number;
  npaMarkers: NpaMarker[];
}

const tooltipStyle = {
  contentStyle: { background: 'var(--surface-3)', border: '1px solid var(--border-medium)', borderRadius: '0.5rem' },
  labelStyle: { color: 'var(--text-secondary)' },
  itemStyle: { color: 'var(--text-primary)' },
};

/**
 * Two single-axis charts (annual pension, lump sum) sharing the claim-age
 * x-domain, rather than one dual-y-axis chart — combining £/yr pension and a
 * one-off £ lump sum on two independent scales in one plot invents a visual
 * correlation that isn't there (see the dataviz skill's anti-pattern list).
 * Vertical reference lines mark each tranche's Normal Pension Age and the
 * currently-selected claim age, since both live on the same age axis.
 */
export default function ClaimAgeSweepChart({ rows, selectedClaimAge, npaMarkers }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Not enough data to sweep claim ages yet.
      </p>
    );
  }

  const selectedRow = rows.find(r => r.claimAge === Math.round(selectedClaimAge));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Annual Pension by Claim Age (today&rsquo;s £)
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={rows} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="claimAge" stroke="var(--text-muted)" label={{ value: 'Claim age', position: 'insideBottom', offset: -5, fill: 'var(--text-tertiary)' }} />
              <YAxis tickFormatter={(v: number) => formatPoundsShort(v)} stroke="var(--text-muted)" width={60} />
              <Tooltip formatter={(value: number) => formatPoundsShort(value)} labelFormatter={(v: number) => `Claim age ${v}`} {...tooltipStyle} />
              {npaMarkers.map(m => (
                <ReferenceLine key={`p-${m.label}`} x={m.age} stroke={m.color} strokeDasharray="3 3" label={{ value: m.label, position: 'top', fontSize: 10, fill: m.color }} />
              ))}
              <ReferenceLine x={selectedClaimAge} stroke="var(--negative)" strokeDasharray="3 3" label={{ value: 'Selected', position: 'insideTopRight', fontSize: 10, fill: 'var(--negative)' }} />
              <Line type="monotone" dataKey="annualPensionReal" name="Annual pension" stroke="var(--teal-bright)" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div>
          <p className="text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Lump Sum by Claim Age (today&rsquo;s £)
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rows} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="claimAge" stroke="var(--text-muted)" label={{ value: 'Claim age', position: 'insideBottom', offset: -5, fill: 'var(--text-tertiary)' }} />
              <YAxis tickFormatter={(v: number) => formatPoundsShort(v)} stroke="var(--text-muted)" width={60} />
              <Tooltip formatter={(value: number) => formatPoundsShort(value)} labelFormatter={(v: number) => `Claim age ${v}`} {...tooltipStyle} />
              {npaMarkers.map(m => (
                <ReferenceLine key={`l-${m.label}`} x={m.age} stroke={m.color} strokeDasharray="3 3" label={{ value: m.label, position: 'top', fontSize: 10, fill: m.color }} />
              ))}
              <ReferenceLine x={selectedClaimAge} stroke="var(--negative)" strokeDasharray="3 3" label={{ value: 'Selected', position: 'insideTopRight', fontSize: 10, fill: 'var(--negative)' }} />
              <Bar dataKey="lumpSumReal" name="Lump sum" fill="var(--gold)" fillOpacity={0.7} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="table-dark w-full text-[0.7rem]">
          <thead>
            <tr>
              <th>Claim age</th>
              <th>Annual pension</th>
              <th>Lump sum</th>
              <th>Cumulative to life expectancy</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const isSelected = r.claimAge === Math.round(selectedClaimAge);
              return (
                <tr key={r.claimAge} style={isSelected ? { background: 'rgba(201, 162, 39, 0.08)', borderLeft: '2px solid var(--gold)' } : undefined}>
                  <td className="td-mono" style={{ color: isSelected ? 'var(--gold-bright)' : 'var(--text-secondary)', fontWeight: isSelected ? 600 : 400 }}>
                    {r.claimAge}
                  </td>
                  <td className="td-mono">{formatPoundsShort(r.annualPensionReal)}</td>
                  <td className="td-mono">{formatPoundsShort(r.lumpSumReal)}</td>
                  <td className="td-mono td-primary">{formatPoundsShort(r.cumulativeRealToLifeExpectancy)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!selectedRow && (
        <p className="text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>
          Your claim age of {Math.round(selectedClaimAge)} falls outside the sweep range shown above.
        </p>
      )}
    </div>
  );
}
