import StressTestChart from './StressTestChart';
import { formatPoundsShort } from '../../utils/formatters';
import type { StressTestResult, StressScenarioConfig } from '../../types';

interface Props {
  stressResult: StressTestResult;
  scenarios: StressScenarioConfig[];
  onScenariosChange: (scenarios: StressScenarioConfig[]) => void;
}

export default function StressTestPanel({ stressResult, scenarios, onScenariosChange }: Props) {
  const { baseCase } = stressResult;

  const updateScenario = (index: number, updates: Partial<StressScenarioConfig>) => {
    onScenariosChange(scenarios.map((s, i) => i === index ? { ...s, ...updates } : s));
  };

  return (
    <div className="space-y-6">
      <h3 className="font-display text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        Bridge Stress Test
      </h3>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Tests whether your accessible savings survive from retirement (age {stressResult.retirementAge}) until pensions unlock (age {stressResult.pensionAccessAge}) under adverse market conditions.
      </p>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Base case card */}
        <div className="rounded-lg p-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
          <div className="text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
            Base Case
          </div>
          {baseCase.survived ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium"
              style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
              Bridge Survives
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium"
              style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--negative)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              Depleted at Age {baseCase.depletionAge}
            </span>
          )}
          <div className="text-xs font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
            {formatPoundsShort(baseCase.terminalBalance)} remaining
          </div>
        </div>

        {/* Scenario cards */}
        {stressResult.scenarios.map(scenario => (
          <div key={scenario.config.type} className="rounded-lg p-3" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
            <div className="text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
              {scenario.config.label}
            </div>
            {scenario.survived ? (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium"
                style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                Bridge Survives
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium"
                style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--negative)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                Depleted at Age {scenario.depletionAge}
              </span>
            )}
            <div className="text-xs font-mono mt-1" style={{ color: 'var(--text-secondary)' }}>
              {formatPoundsShort(scenario.terminalBalance)} remaining
            </div>
          </div>
        ))}
      </div>

      {/* Chart */}
      <StressTestChart stressResult={stressResult} />

      {/* Scenario configuration */}
      <div className="space-y-3">
        <h4 className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Scenario Settings</h4>
        {scenarios.map((scenario, i) => (
          <div key={scenario.type} className="rounded-lg p-3 space-y-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id={`stress_${scenario.type}`}
                checked={scenario.enabled}
                onChange={e => updateScenario(i, { enabled: e.target.checked })}
              />
              <label htmlFor={`stress_${scenario.type}`} className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                {scenario.label}
              </label>
            </div>

            {scenario.enabled && (
              <div className="flex flex-wrap gap-3 pl-5">
                {scenario.type === 'immediate_crash' && (
                  <>
                    <div>
                      <label className="block text-[0.6rem] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>Crash %</label>
                      <input
                        type="number"
                        value={scenario.crashPercent ?? 40}
                        onChange={e => updateScenario(i, { crashPercent: Number(e.target.value) })}
                        className="input-dark font-mono w-16 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[0.6rem] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>Recovery years</label>
                      <input
                        type="number"
                        value={scenario.durationYears ?? 3}
                        onChange={e => updateScenario(i, { durationYears: Number(e.target.value) })}
                        className="input-dark font-mono w-16 text-xs"
                      />
                    </div>
                  </>
                )}

                {scenario.type === 'prolonged_stagnation' && (
                  <div>
                    <label className="block text-[0.6rem] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>Duration (years)</label>
                    <input
                      type="number"
                      value={scenario.durationYears ?? 5}
                      onChange={e => updateScenario(i, { durationYears: Number(e.target.value) })}
                      className="input-dark font-mono w-16 text-xs"
                    />
                  </div>
                )}

                {scenario.type === 'high_inflation' && (
                  <>
                    <div>
                      <label className="block text-[0.6rem] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>Inflation %</label>
                      <input
                        type="number"
                        value={scenario.inflationOverride ?? 8}
                        onChange={e => updateScenario(i, { inflationOverride: Number(e.target.value) })}
                        className="input-dark font-mono w-16 text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-[0.6rem] uppercase tracking-wider mb-0.5" style={{ color: 'var(--text-muted)' }}>Duration (years)</label>
                      <input
                        type="number"
                        value={scenario.durationYears ?? 5}
                        onChange={e => updateScenario(i, { durationYears: Number(e.target.value) })}
                        className="input-dark font-mono w-16 text-xs"
                      />
                    </div>
                  </>
                )}

                {scenario.type === 'historical_2000s' && (
                  <p className="text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>
                    Applies FTSE-inspired returns: -8%, -14%, -23%, +16%, +8%, +18%, +11%, +4%, -31%. No parameters to configure.
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
