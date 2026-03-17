import { useState } from 'react';
import { formatPoundsShort } from '../../utils/formatters';
import type { FireProjection } from '../../types';

interface Props {
  projections: FireProjection[];
  fireAge: number | null;
  currentAge: number;
}

export default function ProjectionTable({ projections, fireAge, currentAge }: Props) {
  const [expanded, setExpanded] = useState(false);

  // Show every year if expanded, otherwise show every 5 years plus key ages
  const filtered = expanded
    ? projections
    : projections.filter(p =>
        p.age === currentAge ||
        p.age % 5 === 0 ||
        p.age === fireAge ||
        p.age === projections[projections.length - 1]?.age
      );

  const isFired = (p: FireProjection) => fireAge !== null && p.age >= fireAge;

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-[0.65rem] font-medium transition-colors"
          style={{ color: 'var(--gold)' }}
        >
          {expanded ? 'Show summary' : 'Show all years'}
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="table-dark w-full text-[0.7rem]">
          <thead>
            <tr>
              <th className="sticky left-0" style={{ background: 'var(--surface-2)' }}>Age</th>
              <th>Year</th>
              <th>ISA</th>
              <th>LISA</th>
              <th>SIPP</th>
              <th>GIA</th>
              <th>Total</th>
              <th>Contribs</th>
              <th>Spend</th>
              <th>Income</th>
              <th>Tax</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(p => {
              const fired = isFired(p);
              const isFireYear = p.age === fireAge;
              const guaranteed = p.guaranteedIncome ?? 0;
              const drawdown = p.drawdownIncome ?? 0;

              return (
                <tr
                  key={p.age}
                  style={isFireYear ? { background: 'rgba(201, 162, 39, 0.08)', borderLeft: '2px solid var(--gold)' } : undefined}
                >
                  <td
                    className="td-mono sticky left-0"
                    style={{
                      background: isFireYear ? 'rgba(201, 162, 39, 0.12)' : 'var(--surface-2)',
                      color: isFireYear ? 'var(--gold-bright)' : p.age === currentAge ? 'var(--teal-bright)' : 'var(--text-secondary)',
                      fontWeight: isFireYear || p.age === currentAge ? 600 : 400,
                    }}
                  >
                    {p.age}
                  </td>
                  <td className="td-mono">{p.year}</td>
                  <td className="td-mono">{formatPoundsShort(p.isa ?? 0)}</td>
                  <td className="td-mono">{formatPoundsShort(p.lisa ?? 0)}</td>
                  <td className="td-mono">{formatPoundsShort(p.sipp ?? 0)}</td>
                  <td className="td-mono">{formatPoundsShort(p.gia ?? 0)}</td>
                  <td className="td-mono td-primary">{formatPoundsShort(p.total)}</td>
                  <td className="td-mono" style={{ color: (p.contributions ?? 0) > 0 ? 'var(--teal-bright)' : 'var(--text-muted)' }}>
                    {(p.contributions ?? 0) > 0 ? `+${formatPoundsShort(p.contributions!)}` : '—'}
                  </td>
                  <td className="td-mono" style={{ color: 'var(--text-secondary)' }}>
                    {formatPoundsShort(p.annualSpend)}
                  </td>
                  <td className="td-mono" style={{ color: fired && drawdown > 0 ? 'var(--gold)' : 'var(--text-muted)' }}>
                    {fired ? (
                      <span title={`Drawdown: ${formatPoundsShort(drawdown)}, Guaranteed: ${formatPoundsShort(guaranteed)}`}>
                        {formatPoundsShort(drawdown + guaranteed)}
                      </span>
                    ) : guaranteed > 0 ? formatPoundsShort(guaranteed) : '—'}
                  </td>
                  <td className="td-mono" style={{ color: (p.taxPaid ?? 0) > 0 ? 'var(--negative)' : 'var(--text-muted)' }}>
                    {(p.taxPaid ?? 0) > 0 ? formatPoundsShort(p.taxPaid!) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
