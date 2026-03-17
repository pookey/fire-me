import { useEffect, useState, useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts';
import { getFunds, getSnapshots, getFireConfig, updateFireConfig, getFireScenarios, createFireScenario, updateFireScenario, deleteFireScenario } from '../utils/api';
import { calculateFireProjections } from '../utils/fireCalculator';
import { formatPoundsShort } from '../utils/formatters';
import WithdrawalRateChart from '../components/charts/WithdrawalRateChart';
import AssetAllocationChart from '../components/charts/AssetAllocationChart';
import CashFlowChart from '../components/charts/CashFlowChart';
import WrapperDrawdownChart from '../components/charts/WrapperDrawdownChart';
import ProjectionTable from '../components/charts/ProjectionTable';
import StressTestPanel from '../components/charts/StressTestPanel';
import { runStressTest, DEFAULT_STRESS_SCENARIOS } from '../utils/stressTestCalculator';
import type { Fund, Snapshot, FireConfig, FireResult, FireScenario, LumpSum, TaxConfig, StressScenarioConfig } from '../types';

const SCENARIO_COLORS = ['#f97316', '#14b8a6', '#ec4899', '#84cc16', '#a855f7'];

const TABS = ['Projection', 'Cash Flow', 'Accounts', 'Stress Test', 'Analysis'] as const;
type Tab = typeof TABS[number];

const defaultConfig: FireConfig = {
  targetAnnualSpend: 30000,
  growthRates: { equities: 7, bonds: 3, cash: 1, property: 4 },
  inflationRate: 2.5,
  pensionAccessAge: 57,
  statePensionAmount: 11000,
  statePensionAge: 68,
  withdrawalRates: [3, 3.5, 4],
  dateOfBirth: '1990-01-01',
  lumpSums: [],
  lifeExpectancy: 100,
  showRealTerms: false,
};

const emptyLumpSum: LumpSum = {
  type: 'inflow',
  category: 'savings',
  subcategory: 'equities',
  amount: 0,
  age: 40,
  description: '',
};

export default function Fire() {
  const [funds, setFunds] = useState<Fund[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [config, setConfig] = useState<FireConfig>(defaultConfig);
  const [result, setResult] = useState<FireResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('Projection');
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['Basic Settings']));

  const [scenarios, setScenarios] = useState<FireScenario[]>([]);
  const [selectedScenarioIds, setSelectedScenarioIds] = useState<string[]>([]);
  const [scenarioName, setScenarioName] = useState('');
  const [savingScenario, setSavingScenario] = useState(false);
  const [stressScenarios, setStressScenarios] = useState<StressScenarioConfig[]>(DEFAULT_STRESS_SCENARIOS);

  useEffect(() => {
    loadData();
  }, []);

  const latestSnapshots = useMemo(() => {
    if (snapshots.length === 0) return [];
    const dates = [...new Set(snapshots.map(s => s.date))].sort();
    const latestDate = dates[dates.length - 1];
    return snapshots.filter(s => s.date === latestDate);
  }, [snapshots]);

  const latestSnapshotsInPounds = useMemo(
    () => latestSnapshots.map(s => ({ ...s, value: s.value / 100 })),
    [latestSnapshots]
  );

  useEffect(() => {
    if (funds.length > 0 && latestSnapshotsInPounds.length > 0) {
      const r = calculateFireProjections(funds, latestSnapshotsInPounds, config);
      setResult(r);
    }
  }, [funds, latestSnapshotsInPounds, config]);

  const scenarioResults = useMemo(() => {
    if (funds.length === 0 || latestSnapshotsInPounds.length === 0) return [];
    return scenarios
      .filter(s => selectedScenarioIds.includes(s.id))
      .map(s => ({
        scenario: s,
        result: calculateFireProjections(funds, latestSnapshotsInPounds, s.config),
      }));
  }, [funds, latestSnapshotsInPounds, scenarios, selectedScenarioIds]);

  const currentAge = useMemo(() => {
    const birthDate = new Date(config.dateOfBirth);
    return new Date().getFullYear() - birthDate.getFullYear();
  }, [config.dateOfBirth]);

  const earliestFireAge = useMemo(() => {
    if (!result) return null;
    // Show the earliest age at which ANY withdrawal rate is sustainable
    const earliest = result.fireDates.reduce((best, fd) => {
      if (fd.age === null) return best;
      if (best === null) return fd.age;
      return fd.age < best ? fd.age : best;
    }, null as number | null);
    return earliest;
  }, [result]);

  const currentPot = useMemo(() => {
    if (!result) return 0;
    const currentProjection = result.projections.find(p => p.age === currentAge);
    return currentProjection?.accessible ?? 0;
  }, [result, currentAge]);

  const stressTestResult = useMemo(() => {
    if (!result) return null;
    const retAge = config.targetRetirementAge ?? earliestFireAge;
    if (retAge === null) return null;
    return runStressTest(result, config, funds, latestSnapshotsInPounds, stressScenarios, retAge);
  }, [result, config, funds, latestSnapshotsInPounds, stressScenarios, earliestFireAge]);

  const loadData = async () => {
    try {
      const [loadedFunds, loadedSnapshots, loadedConfig, loadedScenarios] = await Promise.all([
        getFunds(),
        getSnapshots(),
        getFireConfig().catch(() => defaultConfig),
        getFireScenarios().catch(() => [] as FireScenario[]),
      ]);
      setFunds(loadedFunds);
      setSnapshots(loadedSnapshots);
      if (loadedConfig.growthRates && loadedConfig.growthRates.property == null) {
        loadedConfig.growthRates.property = 4;
      }
      if (loadedConfig.targetAnnualSpend > 100000) {
        loadedConfig.targetAnnualSpend = Math.round(loadedConfig.targetAnnualSpend / 100);
        loadedConfig.statePensionAmount = Math.round(loadedConfig.statePensionAmount / 100);
      }
      setConfig(loadedConfig);
      setScenarios(loadedScenarios);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      await updateFireConfig(config);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveAsScenario = async () => {
    if (!scenarioName.trim()) return;
    setSavingScenario(true);
    try {
      const created = await createFireScenario({ name: scenarioName.trim(), config });
      setScenarios(prev => [...prev, created]);
      setScenarioName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save scenario');
    } finally {
      setSavingScenario(false);
    }
  };

  const handleDeleteScenario = async (id: string) => {
    try {
      await deleteFireScenario(id);
      setScenarios(prev => prev.filter(s => s.id !== id));
      setSelectedScenarioIds(prev => prev.filter(sid => sid !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete scenario');
    }
  };

  const handleLoadScenario = (scenario: FireScenario) => {
    setConfig(scenario.config);
  };

  const handleUpdateScenario = async (scenario: FireScenario) => {
    try {
      const updated = await updateFireScenario(scenario.id, { name: scenario.name, config });
      setScenarios(prev => prev.map(s => s.id === updated.id ? updated : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update scenario');
    }
  };

  const toggleScenarioComparison = (id: string) => {
    setSelectedScenarioIds(prev =>
      prev.includes(id) ? prev.filter(sid => sid !== id) : [...prev, id]
    );
  };

  const updateConfig = (updates: Partial<FireConfig>) => {
    setConfig(prev => ({ ...prev, ...updates }));
  };

  const updateGrowthRate = (key: keyof FireConfig['growthRates'], value: number) => {
    setConfig(prev => ({
      ...prev,
      growthRates: { ...prev.growthRates, [key]: value },
    }));
  };

  const lumpSums = config.lumpSums ?? [];
  const addLumpSum = () => {
    updateConfig({ lumpSums: [...lumpSums, { ...emptyLumpSum }] });
  };
  const removeLumpSum = (index: number) => {
    updateConfig({ lumpSums: lumpSums.filter((_, i) => i !== index) });
  };
  const updateLumpSum = (index: number, updates: Partial<LumpSum>) => {
    updateConfig({
      lumpSums: lumpSums.map((l, i) => (i === index ? { ...l, ...updates } : l)),
    });
  };

  const toggleSection = (section: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const comparisonChartData = useMemo(() => {
    if (!result) return [];
    const baseData = result.projections.map(p => ({
      age: p.age,
      total: p.total,
    }));
    for (const { scenario, result: sr } of scenarioResults) {
      for (const p of sr.projections) {
        const entry = baseData.find(d => d.age === p.age);
        if (entry) {
          (entry as Record<string, number>)[`scenario_${scenario.id}`] = p.total;
        }
      }
    }
    return baseData;
  }, [result, scenarioResults]);

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-medium)', borderTopColor: 'var(--gold)' }} />
      Loading FIRE calculator...
    </div>
  );
  if (error) return <div style={{ color: 'var(--negative)' }}>Error: {error}</div>;

  const yearsToFire = earliestFireAge !== null ? earliestFireAge - currentAge : null;

  return (
    <div className="space-y-6">
      <h2 className="font-display text-2xl font-semibold animate-in" style={{ color: 'var(--text-primary)' }}>
        FIRE Calculator
      </h2>

      {/* Hero Dashboard */}
      {result && (
        <div className="card p-6 animate-in stagger-1">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
            {/* Earliest FIRE Age */}
            <div className="text-center">
              <p className="text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Earliest FIRE Age
              </p>
              <p className="font-display text-4xl font-bold" style={{ color: 'var(--gold-bright)' }}>
                {earliestFireAge !== null ? earliestFireAge : '—'}
              </p>
              {earliestFireAge !== null && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  Year {new Date().getFullYear() + (earliestFireAge - currentAge)}
                </p>
              )}
            </div>

            {/* Target Retirement Age */}
            <div className="text-center">
              <p className="text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Target Age
              </p>
              <div className="flex items-center justify-center gap-2">
                <input
                  type="number"
                  value={config.targetRetirementAge ?? ''}
                  onChange={e => updateConfig({ targetRetirementAge: e.target.value ? Number(e.target.value) : undefined })}
                  placeholder="—"
                  className="input-dark font-display text-2xl font-bold text-center w-20"
                  style={{ color: 'var(--text-primary)' }}
                />
              </div>
              {result.targetAnalysis && (
                <div className="mt-1.5 space-y-1">
                  {result.targetAnalysis.isFeasible ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium"
                      style={{ background: 'rgba(16, 185, 129, 0.15)', color: '#10b981', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                      On Track
                    </span>
                  ) : (
                    <>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium"
                        style={{ background: 'rgba(239, 68, 68, 0.15)', color: 'var(--negative)', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
                        Shortfall: {formatPoundsShort(result.targetAnalysis.shortfallPerYear)}/yr
                      </span>
                      <div className="text-[0.6rem] leading-tight" style={{ color: 'var(--text-muted)' }}>
                        <div>Need {formatPoundsShort(result.targetAnalysis.requiredPot)}</div>
                        <div>Have {formatPoundsShort(result.targetAnalysis.projectedPot)} accessible</div>
                        {result.targetAnalysis.projectedPot < result.targetAnalysis.requiredPot && (() => {
                          const targetProj = result!.projections.find(p => p.age === config.targetRetirementAge);
                          const lockedAtTarget = targetProj ? targetProj.locked : 0;
                          return lockedAtTarget > 0 ? (
                            <div style={{ color: 'var(--gold)' }}>{formatPoundsShort(lockedAtTarget)} locked in pension</div>
                          ) : null;
                        })()}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Years to FIRE */}
            <div className="text-center">
              <p className="text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Years to FIRE
              </p>
              <p className="font-display text-4xl font-bold" style={{ color: yearsToFire !== null && yearsToFire <= 10 ? 'var(--teal-bright)' : 'var(--text-primary)' }}>
                {yearsToFire !== null ? yearsToFire : '—'}
              </p>
              {yearsToFire !== null && (
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  from age {currentAge}
                </p>
              )}
            </div>

            {/* Current Accessible Pot */}
            <div className="text-center">
              <p className="text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                Accessible Pot
              </p>
              <p className="font-display text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {formatPoundsShort(currentPot)}
              </p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                total: {formatPoundsShort(result.projections.find(p => p.age === currentAge)?.total ?? 0)}
              </p>
            </div>
          </div>

          {/* Scenario Comparison Summary */}
          {scenarioResults.length > 0 && (
            <div className="mt-5 pt-5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left pb-2 font-medium" style={{ color: 'var(--text-tertiary)' }}>Metric</th>
                    <th className="text-center pb-2 font-medium" style={{ color: 'var(--gold-bright)' }}>Current</th>
                    {scenarioResults.map(({ scenario }, i) => (
                      <th key={scenario.id} className="text-center pb-2 font-medium" style={{ color: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }}>
                        {scenario.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td className="py-1" style={{ color: 'var(--text-secondary)' }}>FIRE Age</td>
                    <td className="text-center font-mono" style={{ color: 'var(--text-primary)' }}>
                      {earliestFireAge ?? '—'}
                    </td>
                    {scenarioResults.map(({ scenario, result: sr }) => {
                      const sAge = sr.fireDates.reduce((min, fd) => {
                        if (fd.age === null) return min;
                        if (min === null) return fd.age;
                        return fd.age > min ? fd.age : min;
                      }, null as number | null);
                      return (
                        <td key={scenario.id} className="text-center font-mono" style={{ color: 'var(--text-primary)' }}>
                          {sAge ?? '—'}
                        </td>
                      );
                    })}
                  </tr>
                  <tr>
                    <td className="py-1" style={{ color: 'var(--text-secondary)' }}>Required Pot</td>
                    <td className="text-center font-mono" style={{ color: 'var(--text-primary)' }}>
                      {result.targetAnalysis ? formatPoundsShort(result.targetAnalysis.requiredPot) : '—'}
                    </td>
                    {scenarioResults.map(({ scenario, result: sr }) => (
                      <td key={scenario.id} className="text-center font-mono" style={{ color: 'var(--text-primary)' }}>
                        {sr.targetAnalysis ? formatPoundsShort(sr.targetAnalysis.requiredPot) : '—'}
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--surface-1)' }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className="flex-1 py-2 px-3 rounded-md text-xs font-medium transition-all"
            style={{
              background: activeTab === tab ? 'var(--surface-3)' : 'transparent',
              color: activeTab === tab ? 'var(--gold-bright)' : 'var(--text-muted)',
              border: activeTab === tab ? '1px solid var(--border-medium)' : '1px solid transparent',
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {result && (
        <div className="card p-5 animate-in">
          {activeTab === 'Projection' && (
            <>
              <h3 className="font-display text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Projection</h3>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={selectedScenarioIds.length > 0 ? comparisonChartData : result.projections} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
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
                  {selectedScenarioIds.length > 0 && (
                    <Line type="monotone" dataKey="total" name="Current" stroke="var(--gold-bright)" strokeWidth={2} dot={false} />
                  )}
                  {selectedScenarioIds.length > 0 && scenarioResults.map(({ scenario }, i) => (
                    <Line key={scenario.id} type="monotone" dataKey={`scenario_${scenario.id}`} name={scenario.name} stroke={SCENARIO_COLORS[i % SCENARIO_COLORS.length]} strokeWidth={2} dot={false} />
                  ))}
                  {selectedScenarioIds.length === 0 && (
                    <Line type="monotone" dataKey="accessible" name="Accessible" stroke="var(--teal-bright)" strokeWidth={2} dot={false} />
                  )}
                  {selectedScenarioIds.length === 0 && (
                    <Line type="monotone" dataKey="locked" name="Locked (Pension)" stroke="#818cf8" strokeWidth={2} dot={false} />
                  )}
                  {selectedScenarioIds.length === 0 && (
                    <Line type="monotone" dataKey="total" name="Total" stroke="var(--gold-bright)" strokeWidth={2} dot={false} />
                  )}
                  {selectedScenarioIds.length === 0 && config.showRealTerms && (
                    <Line type="monotone" dataKey="realTotal" name="Total (Real)" stroke="var(--gold)" strokeWidth={2} strokeDasharray="5 5" dot={false} />
                  )}
                  {selectedScenarioIds.length === 0 && (
                    <Line type="monotone" dataKey="annualSpend" name="Annual Spend" stroke="var(--negative)" strokeWidth={1} strokeDasharray="5 5" dot={false} />
                  )}
                  {result.fireDates.filter(fd => fd.age !== null).map(fd => (
                    <ReferenceLine key={fd.withdrawalRate} x={fd.age!} stroke="var(--gold-dim)" strokeDasharray="3 3" label={{ value: `FIRE @${fd.withdrawalRate}%`, position: 'top', fontSize: 10, fill: 'var(--gold)' }} />
                  ))}
                  {config.targetRetirementAge && (
                    <ReferenceLine x={config.targetRetirementAge} stroke="var(--gold-bright)" strokeWidth={2} label={{ value: 'Target', position: 'top', fontSize: 10, fill: 'var(--gold-bright)' }} />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </>
          )}

          {activeTab === 'Cash Flow' && (
            <>
              <h3 className="font-display text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Retirement Cash Flow</h3>
              <CashFlowChart
                projections={result.projections}
                retirementStartAge={config.targetRetirementAge ?? earliestFireAge ?? config.pensionAccessAge}
              />
            </>
          )}

          {activeTab === 'Accounts' && (
            <>
              <h3 className="font-display text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Account Balances</h3>
              <WrapperDrawdownChart
                projections={result.projections}
                pensionAccessAge={config.pensionAccessAge}
              />
              <div className="mt-6">
                <h3 className="font-display text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Asset Allocation Over Time</h3>
                <AssetAllocationChart projections={result.projections} />
              </div>
            </>
          )}

          {activeTab === 'Stress Test' && (
            stressTestResult ? (
              <StressTestPanel
                stressResult={stressTestResult}
                scenarios={stressScenarios}
                onScenariosChange={setStressScenarios}
              />
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Set a target retirement age or wait for FIRE age calculation to run stress tests.
              </p>
            )
          )}

          {activeTab === 'Analysis' && (
            <>
              <h3 className="font-display text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Year-by-Year Projection</h3>
              <ProjectionTable
                projections={result.projections}
                fireAge={earliestFireAge}
                currentAge={currentAge}
              />

              <div className="mt-8" />
              <h3 className="font-display text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>FIRE Dates by Withdrawal Rate</h3>
              <table className="table-dark mb-6">
                <thead>
                  <tr>
                    <th>Withdrawal Rate</th>
                    <th>FIRE Age</th>
                    <th>FIRE Year</th>
                  </tr>
                </thead>
                <tbody>
                  {result.fireDates.map(fd => (
                    <tr key={fd.withdrawalRate}>
                      <td className="td-mono">{fd.withdrawalRate}%</td>
                      <td className="td-primary">{fd.age !== null ? fd.age : 'Not achievable'}</td>
                      <td>{fd.year !== null ? fd.year : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h3 className="font-display text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>Implied Withdrawal Rate</h3>
              <WithdrawalRateChart projections={result.projections} />
            </>
          )}
        </div>
      )}

      {/* Collapsible Configuration */}
      <div className="space-y-2">
        <h2 className="font-display text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Configuration</h2>

        {/* Basic Settings */}
        <ConfigSection title="Basic Settings" isOpen={openSections.has('Basic Settings')} onToggle={() => toggleSection('Basic Settings')}>
          <Field label="Date of Birth">
            <input type="date" value={config.dateOfBirth} onChange={e => updateConfig({ dateOfBirth: e.target.value })} className="input-dark" />
          </Field>

          <Field label="Target Annual Spend (£)">
            <input type="number" value={config.targetAnnualSpend} onChange={e => updateConfig({ targetAnnualSpend: Number(e.target.value) })} className="input-dark font-mono" />
          </Field>

          <Field label="Inflation Rate (%)">
            <input type="number" step="0.1" value={config.inflationRate} onChange={e => updateConfig({ inflationRate: Number(e.target.value) })} className="input-dark font-mono" />
          </Field>

          <div className="space-y-2">
            <label className="block text-[0.65rem] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Growth Rates (%)</label>
            {(['equities', 'bonds', 'cash', 'property'] as const).map(key => (
              <div key={key} className="flex items-center gap-2">
                <span className="w-16 text-[0.7rem] capitalize" style={{ color: 'var(--text-muted)' }}>{key}</span>
                <input type="number" step="0.1" value={config.growthRates[key]} onChange={e => updateGrowthRate(key, Number(e.target.value))} className="input-dark flex-1 font-mono" />
              </div>
            ))}
          </div>

          <Field label="Withdrawal Rates (%, comma separated)">
            <input
              type="text"
              value={config.withdrawalRates.join(', ')}
              onChange={e => updateConfig({
                withdrawalRates: e.target.value.split(',').map(s => parseFloat(s.trim())).filter(n => !isNaN(n)),
              })}
              className="input-dark font-mono"
            />
          </Field>

          <Field label="Life Expectancy">
            <input type="number" value={config.lifeExpectancy ?? 100} onChange={e => updateConfig({ lifeExpectancy: Number(e.target.value) })} className="input-dark font-mono" />
          </Field>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="showRealTerms"
              checked={config.showRealTerms ?? false}
              onChange={e => updateConfig({ showRealTerms: e.target.checked })}
            />
            <label htmlFor="showRealTerms" className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              Show values in today's money
            </label>
          </div>
        </ConfigSection>

        {/* Pension Settings */}
        <ConfigSection title="Pension Settings" isOpen={openSections.has('Pension Settings')} onToggle={() => toggleSection('Pension Settings')}>
          <Field label="Pension Access Age">
            <input type="number" value={config.pensionAccessAge} onChange={e => updateConfig({ pensionAccessAge: Number(e.target.value) })} className="input-dark font-mono" />
          </Field>

          <Field label="State Pension Age">
            <input type="number" value={config.statePensionAge} onChange={e => updateConfig({ statePensionAge: Number(e.target.value) })} className="input-dark font-mono" />
          </Field>

          <Field label="State Pension (£/year)">
            <input type="number" value={config.statePensionAmount} onChange={e => updateConfig({ statePensionAmount: Number(e.target.value) })} className="input-dark font-mono" />
          </Field>

          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="statePensionInflation"
              checked={config.statePensionInflationLinked ?? true}
              onChange={e => updateConfig({ statePensionInflationLinked: e.target.checked })}
            />
            <label htmlFor="statePensionInflation" className="text-xs" style={{ color: 'var(--text-secondary)' }}>
              State pension grows with inflation
            </label>
          </div>

          <Field label="Pension Lump Sum Allowance (£)">
            <input type="number" value={config.lumpSumAllowance ?? 268275} onChange={e => updateConfig({ lumpSumAllowance: Number(e.target.value) })} className="input-dark font-mono" />
          </Field>

          {/* Defined Benefit Pensions */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <label className="block text-[0.65rem] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Defined Benefit Pensions</label>
              <button
                onClick={() => updateConfig({
                  definedBenefitPensions: [...(config.definedBenefitPensions ?? []), { name: '', annualAmount: 0, startAge: 60 }],
                })}
                className="text-[0.65rem] font-medium" style={{ color: 'var(--gold)' }}
              >+ Add</button>
            </div>

            {(config.definedBenefitPensions ?? []).length === 0 && (
              <p className="text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>None configured.</p>
            )}

            {(config.definedBenefitPensions ?? []).map((dbp, i) => (
              <div key={i} className="rounded-lg p-3 space-y-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[0.65rem] font-medium" style={{ color: 'var(--text-muted)' }}>DB Pension {i + 1}</span>
                  <button
                    onClick={() => updateConfig({
                      definedBenefitPensions: (config.definedBenefitPensions ?? []).filter((_, j) => j !== i),
                    })}
                    className="btn-danger text-[0.65rem]"
                  >Remove</button>
                </div>
                <Field label="Name">
                  <input
                    type="text" value={dbp.name} placeholder="e.g. Teacher's Pension"
                    onChange={e => updateConfig({
                      definedBenefitPensions: (config.definedBenefitPensions ?? []).map((d, j) => j === i ? { ...d, name: e.target.value } : d),
                    })}
                    className="input-dark"
                  />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Annual amount (£)">
                    <input type="number" value={dbp.annualAmount} onChange={e => updateConfig({
                      definedBenefitPensions: (config.definedBenefitPensions ?? []).map((d, j) => j === i ? { ...d, annualAmount: Number(e.target.value) } : d),
                    })} className="input-dark font-mono" />
                  </Field>
                  <Field label="Start age">
                    <input type="number" value={dbp.startAge} onChange={e => updateConfig({
                      definedBenefitPensions: (config.definedBenefitPensions ?? []).map((d, j) => j === i ? { ...d, startAge: Number(e.target.value) } : d),
                    })} className="input-dark font-mono" />
                  </Field>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    id={`dbpInflation${i}`}
                    checked={dbp.inflationLinked ?? false}
                    onChange={e => updateConfig({
                      definedBenefitPensions: (config.definedBenefitPensions ?? []).map((d, j) => j === i ? { ...d, inflationLinked: e.target.checked } : d),
                    })}
                  />
                  <label htmlFor={`dbpInflation${i}`} className="text-[0.65rem]" style={{ color: 'var(--text-secondary)' }}>
                    Inflation linked
                  </label>
                  {dbp.inflationLinked && (
                    <div className="flex items-center gap-1 ml-2">
                      <label className="text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>Cap %</label>
                      <input
                        type="number" step="0.1" value={dbp.inflationCap ?? ''} placeholder="none"
                        onChange={e => updateConfig({
                          definedBenefitPensions: (config.definedBenefitPensions ?? []).map((d, j) =>
                            j === i ? { ...d, inflationCap: e.target.value ? Number(e.target.value) : undefined } : d
                          ),
                        })}
                        className="input-dark font-mono w-16"
                      />
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </ConfigSection>

        {/* Tax Configuration */}
        <ConfigSection title="Tax Configuration" isOpen={openSections.has('Tax Configuration')} onToggle={() => toggleSection('Tax Configuration')}>
          {([
            ['personalAllowance', 'Personal Allowance (£)', 12570],
            ['basicRateThreshold', 'Basic Rate Threshold (£)', 50270],
            ['higherRateThreshold', 'Higher Rate Threshold (£)', 125140],
            ['basicRate', 'Basic Rate (%)', 20],
            ['higherRate', 'Higher Rate (%)', 40],
            ['additionalRate', 'Additional Rate (%)', 45],
            ['cgtAnnualExempt', 'CGT Annual Exempt (£)', 3000],
            ['cgtBasicRate', 'CGT Basic Rate (%)', 10],
            ['cgtHigherRate', 'CGT Higher Rate (%)', 20],
          ] as [keyof TaxConfig, string, number][]).map(([key, label, defaultVal]) => (
            <Field key={key} label={label}>
              <input
                type="number"
                value={config.taxConfig?.[key] ?? defaultVal}
                onChange={e => updateConfig({
                  taxConfig: {
                    personalAllowance: 12570, basicRateThreshold: 50270, higherRateThreshold: 125140,
                    basicRate: 20, higherRate: 40, additionalRate: 45,
                    cgtAnnualExempt: 3000, cgtBasicRate: 10, cgtHigherRate: 20,
                    ...config.taxConfig,
                    [key]: Number(e.target.value),
                  },
                })}
                className="input-dark font-mono"
              />
            </Field>
          ))}
        </ConfigSection>

        {/* Drawdown Strategy */}
        <ConfigSection title="Drawdown Strategy" isOpen={openSections.has('Drawdown Strategy')} onToggle={() => toggleSection('Drawdown Strategy')}>
          <div className="space-y-3">
            <label className="block text-[0.65rem] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Drawdown Order</label>
            <p className="text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>Reorder which wrappers to draw from first.</p>
            {(config.drawdownOrder ?? ['gia', 'none', 'isa', 'lisa', 'sipp']).map((wrapper, i) => {
              const order = config.drawdownOrder ?? ['gia', 'none', 'isa', 'lisa', 'sipp'];
              return (
                <div key={wrapper} className="flex items-center gap-2">
                  <span className="text-[0.65rem] w-4 font-mono" style={{ color: 'var(--text-muted)' }}>{i + 1}.</span>
                  <span className="flex-1 text-xs font-medium uppercase" style={{ color: 'var(--text-secondary)' }}>{wrapper}</span>
                  <button
                    disabled={i === 0}
                    onClick={() => { const newOrder = [...order]; [newOrder[i - 1], newOrder[i]] = [newOrder[i], newOrder[i - 1]]; updateConfig({ drawdownOrder: newOrder }); }}
                    className="text-[0.65rem] disabled:opacity-20"
                    style={{ color: 'var(--text-muted)' }}
                  >Up</button>
                  <button
                    disabled={i === order.length - 1}
                    onClick={() => { const newOrder = [...order]; [newOrder[i], newOrder[i + 1]] = [newOrder[i + 1], newOrder[i]]; updateConfig({ drawdownOrder: newOrder }); }}
                    className="text-[0.65rem] disabled:opacity-20"
                    style={{ color: 'var(--text-muted)' }}
                  >Down</button>
                </div>
              );
            })}
          </div>

          {/* Lump Sums */}
          <div className="space-y-3 pt-3">
            <div className="flex items-center justify-between">
              <label className="block text-[0.65rem] font-medium uppercase tracking-wider" style={{ color: 'var(--text-tertiary)' }}>Lump Sums</label>
              <button onClick={addLumpSum} className="text-[0.65rem] font-medium" style={{ color: 'var(--gold)' }}>+ Add</button>
            </div>

            {lumpSums.length === 0 && (
              <p className="text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>No lump sums configured.</p>
            )}

            {lumpSums.map((ls, i) => (
              <div key={i} className="rounded-lg p-3 space-y-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-[0.65rem] font-medium" style={{ color: 'var(--text-muted)' }}>Lump Sum {i + 1}</span>
                  <button onClick={() => removeLumpSum(i)} className="btn-danger text-[0.65rem]">Remove</button>
                </div>
                <Field label="Description">
                  <input type="text" value={ls.description} onChange={e => updateLumpSum(i, { description: e.target.value })} placeholder="e.g. Inheritance" className="input-dark" />
                </Field>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Type">
                    <select value={ls.type} onChange={e => updateLumpSum(i, { type: e.target.value as LumpSum['type'] })} className="input-dark">
                      <option value="inflow">Inflow</option>
                      <option value="outflow">Outflow</option>
                    </select>
                  </Field>
                  <Field label="Age">
                    <input type="number" value={ls.age} onChange={e => updateLumpSum(i, { age: Number(e.target.value) })} className="input-dark font-mono" />
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Category">
                    <select value={ls.category} onChange={e => updateLumpSum(i, { category: e.target.value as LumpSum['category'] })} className="input-dark">
                      <option value="savings">Savings</option>
                      <option value="pension">Pension</option>
                    </select>
                  </Field>
                  <Field label="Asset class">
                    <select value={ls.subcategory} onChange={e => updateLumpSum(i, { subcategory: e.target.value as LumpSum['subcategory'] })} className="input-dark">
                      <option value="equities">Equities</option>
                      <option value="bonds">Bonds</option>
                      <option value="cash">Cash</option>
                      <option value="property">Property</option>
                    </select>
                  </Field>
                </div>
                <Field label="Amount (£)">
                  <input type="number" value={ls.amount} onChange={e => updateLumpSum(i, { amount: Number(e.target.value) })} className="input-dark font-mono" />
                </Field>
              </div>
            ))}
          </div>
        </ConfigSection>

        {/* Scenarios */}
        <ConfigSection title="Scenarios" isOpen={openSections.has('Scenarios')} onToggle={() => toggleSection('Scenarios')}>
          <div className="flex gap-2">
            <input
              type="text"
              value={scenarioName}
              onChange={e => setScenarioName(e.target.value)}
              placeholder="Scenario name"
              className="input-dark"
            />
            <button
              onClick={handleSaveAsScenario}
              disabled={savingScenario || !scenarioName.trim()}
              className="btn-gold whitespace-nowrap text-xs"
            >
              Save As
            </button>
          </div>

          {scenarios.length === 0 && (
            <p className="text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>No saved scenarios.</p>
          )}

          {scenarios.map((s, i) => (
            <div key={s.id} className="rounded-lg p-3 space-y-2" style={{ background: 'var(--surface-1)', border: '1px solid var(--border-subtle)' }}>
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: SCENARIO_COLORS[i % SCENARIO_COLORS.length] }} />
                <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{s.name}</span>
              </div>
              <div className="flex gap-1 flex-wrap">
                <button onClick={() => handleLoadScenario(s)} className="btn-ghost text-[0.65rem] py-0.5 px-2">Load</button>
                <button onClick={() => handleUpdateScenario(s)} className="btn-ghost text-[0.65rem] py-0.5 px-2">Overwrite</button>
                <button
                  onClick={() => toggleScenarioComparison(s.id)}
                  className="text-[0.65rem] py-0.5 px-2 rounded transition-colors"
                  style={{
                    background: selectedScenarioIds.includes(s.id) ? 'rgba(201, 162, 39, 0.15)' : 'var(--surface-3)',
                    color: selectedScenarioIds.includes(s.id) ? 'var(--gold-bright)' : 'var(--text-tertiary)',
                    border: `1px solid ${selectedScenarioIds.includes(s.id) ? 'var(--border-gold)' : 'var(--border-subtle)'}`,
                  }}
                >
                  {selectedScenarioIds.includes(s.id) ? 'Comparing' : 'Compare'}
                </button>
                <button onClick={() => handleDeleteScenario(s.id)} className="btn-danger text-[0.65rem]">Delete</button>
              </div>
            </div>
          ))}
        </ConfigSection>

        <button onClick={handleSaveConfig} disabled={saving} className="btn-gold w-full py-2.5">
          {saving ? 'Saving...' : 'Save Config'}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>{label}</label>
      {children}
    </div>
  );
}

function ConfigSection({ title, isOpen, onToggle, children }: { title: string; isOpen: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="card overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-4 text-left"
        style={{ color: 'var(--text-primary)' }}
      >
        <span className="font-display text-sm font-semibold">{title}</span>
        <span className="text-xs transition-transform" style={{ color: 'var(--text-muted)', transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}>
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="px-5 pb-5 space-y-3">
          {children}
        </div>
      )}
    </div>
  );
}
