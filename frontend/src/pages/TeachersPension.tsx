import { useEffect, useState, useMemo } from 'react';
import { getFireConfig, updateFireConfig, createFireScenario } from '../utils/api';
import {
  computeTpsBenefits,
  sweepClaimAges,
  additionalPensionValue,
  fasterAccrualValue,
  type ApValueResult,
  type FasterAccrualResult,
} from '../utils/teachersPension';
import {
  minPensionAge,
  memberContributionRate,
  lookupFactor,
  ERF_NPA60,
  ERF_NPA65_ER7,
  ERF_CARE_DEFERRED_ER8,
  CARE_ACTIVE_STANDARD_REDUCTION,
  CARE_LATE_UPLIFT,
  COMMUTATION_RATE,
  AP_BLOCK,
  AP_MAX_ANNUAL,
} from '../utils/tpsFactors';
import { ConfigSection, Field } from '../components/ConfigSection';
import ClaimAgeSweepChart, { type NpaMarker } from '../components/charts/ClaimAgeSweepChart';
import { formatPoundsShort } from '../utils/formatters';
import type { FireConfig, TeachersPensionConfig, TpsFsSection, TpsMcCloudChoice } from '../types';

const defaultConfig: FireConfig = {
  targetAnnualSpend: 30000,
  growthRates: { equities: 7, bonds: 3, cash: 1, property: 4 },
  inflationRate: 2.5,
  pensionAccessAge: 57,
  statePensionAmount: 11000,
  statePensionAge: 68,
  withdrawalRates: [3, 3.5, 4],
  dateOfBirth: '1990-01-01',
  lifeExpectancy: 100,
  showRealTerms: false,
};

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

const defaultTps = (): TeachersPensionConfig => ({
  enabled: false,
  statementDate: currentYearMonth(),
  stillInService: true,
  claimAge: 60,
});

const SECTION_GROUPS = [
  'Final Salary',
  'Career Average',
  'McCloud Remedy (2015–2022)',
  'Additional Pension',
  'Still Teaching?',
  'Claiming',
] as const;

/** Numeric input that tolerates an empty string while typing instead of
 * snapping back to a stale/zero value on every keystroke; reverts to the
 * last committed value on blur if left empty or unparsable. */
function NumberField({ value, onChange, className, step, placeholder }: {
  value: number;
  onChange: (v: number) => void;
  className?: string;
  step?: string;
  placeholder?: string;
}) {
  const [text, setText] = useState(String(value));

  useEffect(() => {
    setText(String(value));
  }, [value]);

  return (
    <input
      type="number"
      step={step}
      placeholder={placeholder}
      value={text}
      className={className}
      onChange={e => {
        const raw = e.target.value;
        setText(raw);
        if (raw === '') return;
        const n = Number(raw);
        if (!Number.isNaN(n)) onChange(n);
      }}
      onBlur={() => setText(String(value))}
    />
  );
}

// --- Display-only reduction% helpers -----------------------------------
// These mirror the claim-age adjustment in utils/teachersPension.ts purely
// to surface a "reduced N% for claiming early" badge per tranche; the
// authoritative pension amounts still come from computeTpsBenefits.

function fsReductionPct(section: TpsFsSection, claimAge: number): number {
  const npa = section === 'npa60' ? 60 : 65;
  if (claimAge > npa) {
    if (section === 'npa60') return 0; // no late uplift
    return -((((1 + CARE_LATE_UPLIFT) ** (claimAge - npa)) - 1) * 100);
  }
  const factor = lookupFactor(section === 'npa60' ? ERF_NPA60 : ERF_NPA65_ER7, npa - claimAge);
  return (1 - factor) * 100;
}

function careReductionPct(tps: TeachersPensionConfig, claimAge: number, careNpa: number): number {
  const inServiceToClaim = tps.stillInService && (tps.futureAccrual?.leavingAge ?? claimAge) >= claimAge;
  let factor: number;
  if (inServiceToClaim) {
    const standardReduction = 1 - CARE_ACTIVE_STANDARD_REDUCTION * Math.min(3, Math.max(0, careNpa - Math.max(65, claimAge)));
    factor = lookupFactor(ERF_NPA65_ER7, Math.max(0, 65 - claimAge)) * standardReduction;
  } else {
    factor = lookupFactor(ERF_CARE_DEFERRED_ER8, Math.max(0, careNpa - claimAge));
  }
  if (claimAge > careNpa) factor *= (1 + CARE_LATE_UPLIFT) ** (claimAge - careNpa);
  return (1 - factor) * 100;
}

function apReductionPct(claimAge: number, careNpa: number): number {
  let factor = lookupFactor(ERF_CARE_DEFERRED_ER8, Math.max(0, careNpa - claimAge));
  if (claimAge > careNpa) factor *= (1 + CARE_LATE_UPLIFT) ** (claimAge - careNpa);
  return (1 - factor) * 100;
}

const VERDICT_STYLE: Record<'strong' | 'good' | 'marginal' | 'poor', { background: string; border: string; color: string }> = {
  strong: { background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', color: '#10b981' },
  good: { background: 'rgba(45, 212, 191, 0.15)', border: '1px solid rgba(45, 212, 191, 0.3)', color: 'var(--teal-bright)' },
  marginal: { background: 'rgba(245, 158, 11, 0.15)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#f59e0b' },
  poor: { background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--negative)' },
};

function VerdictBadge({ verdict }: { verdict: 'strong' | 'good' | 'marginal' | 'poor' }) {
  const style = VERDICT_STYLE[verdict];
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[0.65rem] font-medium uppercase tracking-wider"
      style={{ background: style.background, border: style.border, color: style.color }}
    >
      {verdict}
    </span>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="font-mono text-right" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

const WHEN_NOT_TO_BUY = [
  'Claiming early crushes the value: actuarial reductions (ER8) of 30–45% on purchased pension are common if you claim more than 5–10 years before your Normal Pension Age.',
  'Additional Pension and faster accrual are not inheritable capital — the extra pension dies with you unless you separately pay for dependant cover.',
  'Leaving teaching soon erodes the value — you lose the salary link (final salary) or the CPI+1.6% in-service revaluation (career average) the moment you leave, and any AP bought stops accruing the same way.',
  'Large purchases can breach your £60,000 Annual Allowance in the year you buy them — the pension input is roughly 16× the increase in your annual pension, on top of your normal accrual.',
  'Buy Out (removing the 65→NPA reduction) is only electable within 6 months of first joining the career-average scheme — there is no ongoing window to purchase it later.',
  'The Prudential Teachers’ AVC has no employer match, so a low-cost SIPP or ISA usually wins on fees and flexibility for money you’d otherwise put there.',
];

export default function TeachersPension() {
  const [config, setConfig] = useState<FireConfig>(defaultConfig);
  const [local, setLocal] = useState<TeachersPensionConfig>(defaultTps());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(SECTION_GROUPS));

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const loadedConfig = await getFireConfig().catch(() => defaultConfig);
      setConfig(loadedConfig);
      setLocal(loadedConfig.teachersPension ?? defaultTps());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const updated = await updateFireConfig({ ...config, teachersPension: local });
      setConfig(updated);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save config');
    } finally {
      setSaving(false);
    }
  };

  const toggleSection = (section: string) => {
    setOpenSections(prev => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const isDirty = useMemo(
    () => JSON.stringify(local) !== JSON.stringify(config.teachersPension ?? defaultTps()),
    [local, config.teachersPension],
  );

  // Calendar-year age, same convention as Fire.tsx / fireCalculator.
  const currentAge = useMemo(() => {
    const birthDate = new Date(config.dateOfBirth);
    return new Date().getFullYear() - birthDate.getFullYear();
  }, [config.dateOfBirth]);

  const minAge = useMemo(() => minPensionAge(config.dateOfBirth), [config.dateOfBirth]);

  const computed = useMemo(() => {
    if (!local.enabled) return null;
    try {
      return computeTpsBenefits(local, {
        currentAge,
        inflationRate: config.inflationRate,
        lifeExpectancy: config.lifeExpectancy ?? 100,
        minPensionAge: minAge,
      });
    } catch {
      return null;
    }
  }, [local, currentAge, config.inflationRate, config.lifeExpectancy, minAge]);

  const cpi = config.inflationRate / 100;
  const nominalFactor = useMemo(() => (1 + cpi) ** (local.claimAge - currentAge), [cpi, local.claimAge, currentAge]);

  const trancheRows = useMemo(() => {
    if (!computed) return [];
    const careNpa = local.careerAverage?.normalPensionAge ?? 68;
    return computed.streams.map(s => {
      const real = nominalFactor !== 0 ? s.annualPensionAtClaim / nominalFactor : s.annualPensionAtClaim;
      let reductionPct = 0;
      let npa = careNpa;
      if (s.label === 'TPS final salary' && local.finalSalary) {
        npa = local.finalSalary.section === 'npa60' ? 60 : 65;
        reductionPct = fsReductionPct(local.finalSalary.section, local.claimAge);
      } else if (s.label === 'TPS career average') {
        reductionPct = careReductionPct(local, local.claimAge, careNpa);
      } else if (s.label === 'TPS additional pension') {
        reductionPct = apReductionPct(local.claimAge, careNpa);
      }
      const yearsEarly = Math.max(0, npa - local.claimAge);
      return { label: s.label, real, reductionPct, yearsEarly };
    });
  }, [computed, nominalFactor, local]);

  const lumpSumReal = computed ? (nominalFactor !== 0 ? computed.totalLumpSumAtClaim / nominalFactor : computed.totalLumpSumAtClaim) : 0;
  const totalPensionNominal = computed ? computed.streams.reduce((sum, s) => sum + s.annualPensionAtClaim, 0) : 0;

  // --- Step 9: decision tools ------------------------------------------

  const careNpaRaw = local.careerAverage?.normalPensionAge ?? 68;

  const npaMarkers = useMemo<NpaMarker[]>(() => {
    const markers: NpaMarker[] = [];
    if (local.finalSalary) {
      const fsNpa = local.finalSalary.section === 'npa60' ? 60 : 65;
      markers.push({ age: fsNpa, label: `FS NPA ${fsNpa}`, color: '#818cf8' });
    }
    if (local.careerAverage || local.mcCloud) {
      markers.push({ age: careNpaRaw, label: `CARE NPA ${careNpaRaw}`, color: '#f97316' });
    }
    return markers;
  }, [local.finalSalary, local.careerAverage, local.mcCloud, careNpaRaw]);

  const sweepRows = useMemo(() => {
    if (!local.enabled) return [];
    try {
      return sweepClaimAges(local, {
        currentAge,
        inflationRate: config.inflationRate,
        lifeExpectancy: config.lifeExpectancy ?? 100,
        minPensionAge: minAge,
      });
    } catch {
      return [];
    }
  }, [local, currentAge, config.inflationRate, config.lifeExpectancy, minAge]);

  // Additional Pension calculator ---------------------------------------
  const maxApBlocks = Math.floor(AP_MAX_ANNUAL / AP_BLOCK);
  const [apBlocks, setApBlocks] = useState(4); // £1,000/yr default
  const [marginalTaxRate, setMarginalTaxRate] = useState(40);

  // additionalPensionValue only accepts NPA 65-68; clamp the user's configured
  // CARE NPA into that range and surface a note when we had to.
  const apNpa = Math.min(68, Math.max(65, Math.round(careNpaRaw))) as 65 | 66 | 67 | 68;
  const apNpaClamped = apNpa !== careNpaRaw;
  const lowestWithdrawalRate = config.withdrawalRates.length > 0 ? Math.min(...config.withdrawalRates) : 4;

  const apResult = useMemo<ApValueResult | null>(() => {
    try {
      return additionalPensionValue({
        age: currentAge,
        npa: apNpa,
        annualPension: apBlocks * AP_BLOCK,
        marginalTaxRate,
        claimAge: local.claimAge,
        withdrawalRate: lowestWithdrawalRate,
      });
    } catch {
      // Transient invalid input (e.g. mid-drag slider state) — just hide the result.
      return null;
    }
  }, [currentAge, apNpa, apBlocks, marginalTaxRate, local.claimAge, lowestWithdrawalRate]);

  // Faster accrual calculator --------------------------------------------
  const [fasterDenom, setFasterDenom] = useState<55 | 50 | 45>(50);

  const fasterResult = useMemo<FasterAccrualResult | null>(() => {
    if (!(local.stillInService && local.futureAccrual)) return null;
    try {
      return fasterAccrualValue({
        salary: local.futureAccrual.currentSalary,
        denominator: fasterDenom,
        marginalTaxRate,
      });
    } catch {
      return null;
    }
  }, [local.stillInService, local.futureAccrual, fasterDenom, marginalTaxRate]);

  // Scenario export --------------------------------------------------------
  const [savingScenarios, setSavingScenarios] = useState(false);
  const [scenarioExportStatus, setScenarioExportStatus] = useState<'success' | 'error' | null>(null);

  const handleExportScenarios = async () => {
    if (!local.mcCloud) return;
    setSavingScenarios(true);
    setScenarioExportStatus(null);
    try {
      const mcCloud = local.mcCloud;
      const baseConfig: FireConfig = { ...config, teachersPension: local };
      await createFireScenario({
        name: 'TPS: final salary choice',
        config: { ...baseConfig, teachersPension: { ...local, mcCloud: { ...mcCloud, choice: 'finalSalary' } } },
      });
      await createFireScenario({
        name: 'TPS: career average choice',
        config: { ...baseConfig, teachersPension: { ...local, mcCloud: { ...mcCloud, choice: 'careerAverage' } } },
      });
      setScenarioExportStatus('success');
    } catch {
      setScenarioExportStatus('error');
    } finally {
      setSavingScenarios(false);
    }
  };

  if (loading) return (
    <div className="flex items-center gap-3" style={{ color: 'var(--text-tertiary)' }}>
      <div className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'var(--border-medium)', borderTopColor: 'var(--gold)' }} />
      Loading Teachers' Pension...
    </div>
  );
  if (error) return <div style={{ color: 'var(--negative)' }}>Error: {error}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold animate-in" style={{ color: 'var(--text-primary)' }}>
          Teachers' Pension
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="tpsEnabled"
            checked={local.enabled}
            onChange={e => setLocal(prev => ({ ...prev, enabled: e.target.checked }))}
          />
          <label htmlFor="tpsEnabled" className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            Enabled
          </label>
        </div>
      </div>

      {!local.enabled ? (
        <div className="card p-6">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
            Model your accrued UK Teachers' Pension Scheme benefits &mdash; final salary and/or career average &mdash;
            including the McCloud remedy dual figures from your Remediable Service Statement. Enable this to add your
            projected annual pension and tax-free lump sum to your FIRE plan.
          </p>
        </div>
      ) : (
        <>
          {/* Inputs */}
          <div className="space-y-2">
            <ConfigSection title="Final Salary" isOpen={openSections.has('Final Salary')} onToggle={() => toggleSection('Final Salary')}>
              <Field label="Section">
                <select
                  value={local.finalSalary?.section ?? 'none'}
                  onChange={e => {
                    const v = e.target.value;
                    if (v === 'none') {
                      setLocal(prev => ({ ...prev, finalSalary: undefined }));
                    } else {
                      const section = v as TpsFsSection;
                      setLocal(prev => ({
                        ...prev,
                        finalSalary: {
                          section,
                          accruedAnnualPension: prev.finalSalary?.accruedAnnualPension ?? 0,
                          automaticLumpSum: section === 'npa60' ? prev.finalSalary?.automaticLumpSum : undefined,
                        },
                      }));
                    }
                  }}
                  className="input-dark"
                >
                  <option value="none">None</option>
                  <option value="npa60">NPA60 &mdash; 1/80th + automatic lump sum</option>
                  <option value="npa65">NPA65 &mdash; 1/60th, no automatic lump sum</option>
                </select>
              </Field>

              {local.finalSalary && (
                <>
                  <Field label="Accrued Annual Pension (£)">
                    <NumberField
                      value={local.finalSalary.accruedAnnualPension}
                      onChange={v => setLocal(prev => (prev.finalSalary ? { ...prev, finalSalary: { ...prev.finalSalary, accruedAnnualPension: v } } : prev))}
                      className="input-dark font-mono"
                    />
                    <p className="text-[0.6rem] mt-1" style={{ color: 'var(--text-muted)' }}>Figure from your latest Benefit Statement.</p>
                  </Field>

                  {local.finalSalary.section === 'npa60' && (
                    <Field label="Automatic Lump Sum (£)">
                      <NumberField
                        value={local.finalSalary.automaticLumpSum ?? 0}
                        onChange={v => setLocal(prev => (prev.finalSalary ? { ...prev, finalSalary: { ...prev.finalSalary, automaticLumpSum: v } } : prev))}
                        className="input-dark font-mono"
                      />
                      <p className="text-[0.6rem] mt-1" style={{ color: 'var(--text-muted)' }}>&asymp;3&times; pension.</p>
                    </Field>
                  )}
                </>
              )}
            </ConfigSection>

            <ConfigSection title="Career Average" isOpen={openSections.has('Career Average')} onToggle={() => toggleSection('Career Average')}>
              <Field label="Accrued Annual Pension (£)">
                <NumberField
                  value={local.careerAverage?.accruedAnnualPension ?? 0}
                  onChange={v => setLocal(prev => ({
                    ...prev,
                    careerAverage: { accruedAnnualPension: v, normalPensionAge: prev.careerAverage?.normalPensionAge ?? 68 },
                  }))}
                  className="input-dark font-mono"
                />
                <p className="text-[0.6rem] mt-1" style={{ color: 'var(--text-muted)' }}>Figure from your latest Benefit Statement &mdash; already revalued.</p>
              </Field>
              <Field label="Normal Pension Age">
                <NumberField
                  value={local.careerAverage?.normalPensionAge ?? 68}
                  onChange={v => setLocal(prev => ({
                    ...prev,
                    careerAverage: { accruedAnnualPension: prev.careerAverage?.accruedAnnualPension ?? 0, normalPensionAge: v },
                  }))}
                  className="input-dark font-mono"
                />
                <p className="text-[0.6rem] mt-1" style={{ color: 'var(--text-muted)' }}>Later of 65 and your State Pension Age, e.g. 68.</p>
              </Field>
            </ConfigSection>

            <ConfigSection
              title="McCloud Remedy (2015–2022)"
              isOpen={openSections.has('McCloud Remedy (2015–2022)')}
              onToggle={() => toggleSection('McCloud Remedy (2015–2022)')}
            >
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="mcCloudEnabled"
                  checked={!!local.mcCloud}
                  onChange={e => setLocal(prev => ({
                    ...prev,
                    mcCloud: e.target.checked
                      ? (prev.mcCloud ?? { finalSalaryAnnualPension: 0, careAnnualPension: 0, choice: 'auto' as TpsMcCloudChoice })
                      : undefined,
                  }))}
                />
                <label htmlFor="mcCloudEnabled" className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  I have a Remediable Service Statement for 2015&ndash;2022 remedy service
                </label>
              </div>

              {local.mcCloud && (
                <>
                  <p className="text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>
                    These are the dual figures on your Remediable Service Statement.
                  </p>
                  <Field label="Final Salary Basis — Annual Pension (£)">
                    <NumberField
                      value={local.mcCloud.finalSalaryAnnualPension}
                      onChange={v => setLocal(prev => (prev.mcCloud ? { ...prev, mcCloud: { ...prev.mcCloud, finalSalaryAnnualPension: v } } : prev))}
                      className="input-dark font-mono"
                    />
                  </Field>
                  {local.finalSalary?.section === 'npa60' && (
                    <Field label="Final Salary Basis — Lump Sum (£)">
                      <NumberField
                        value={local.mcCloud.finalSalaryLumpSum ?? 0}
                        onChange={v => setLocal(prev => (prev.mcCloud ? { ...prev, mcCloud: { ...prev.mcCloud, finalSalaryLumpSum: v } } : prev))}
                        className="input-dark font-mono"
                      />
                    </Field>
                  )}
                  <Field label="Career Average Basis — Annual Pension (£)">
                    <NumberField
                      value={local.mcCloud.careAnnualPension}
                      onChange={v => setLocal(prev => (prev.mcCloud ? { ...prev, mcCloud: { ...prev.mcCloud, careAnnualPension: v } } : prev))}
                      className="input-dark font-mono"
                    />
                  </Field>
                  <Field label="Which basis at retirement?">
                    <div className="flex flex-col gap-1.5">
                      {(['auto', 'finalSalary', 'careerAverage'] as TpsMcCloudChoice[]).map(choice => (
                        <label key={choice} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                          <input
                            type="radio"
                            name="mcCloudChoice"
                            checked={local.mcCloud?.choice === choice}
                            onChange={() => setLocal(prev => (prev.mcCloud ? { ...prev, mcCloud: { ...prev.mcCloud, choice } } : prev))}
                          />
                          {choice === 'auto' ? 'Auto (recommend)' : choice === 'finalSalary' ? 'Final salary' : 'Career average'}
                        </label>
                      ))}
                    </div>
                  </Field>
                </>
              )}
            </ConfigSection>

            <ConfigSection title="Additional Pension" isOpen={openSections.has('Additional Pension')} onToggle={() => toggleSection('Additional Pension')}>
              <Field label="Additional Pension Already Held (£/yr)">
                <NumberField
                  value={local.additionalPensionAccrued ?? 0}
                  onChange={v => setLocal(prev => ({ ...prev, additionalPensionAccrued: v }))}
                  className="input-dark font-mono"
                />
                <p className="text-[0.6rem] mt-1" style={{ color: 'var(--text-muted)' }}>Any Additional Pension you've already purchased (CPI-only revaluation).</p>
              </Field>
            </ConfigSection>

            <ConfigSection title="Still Teaching?" isOpen={openSections.has('Still Teaching?')} onToggle={() => toggleSection('Still Teaching?')}>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="stillInService"
                  checked={local.stillInService}
                  onChange={e => setLocal(prev => ({
                    ...prev,
                    stillInService: e.target.checked,
                    futureAccrual: e.target.checked ? (prev.futureAccrual ?? { currentSalary: 0, leavingAge: prev.claimAge }) : prev.futureAccrual,
                  }))}
                />
                <label htmlFor="stillInService" className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  Still in pensionable service
                </label>
              </div>

              {local.stillInService && (
                <>
                  <Field label="Current Salary (£/yr, pensionable)">
                    <NumberField
                      value={local.futureAccrual?.currentSalary ?? 0}
                      onChange={v => setLocal(prev => ({
                        ...prev,
                        futureAccrual: {
                          currentSalary: v,
                          leavingAge: prev.futureAccrual?.leavingAge ?? prev.claimAge,
                          salaryGrowthRate: prev.futureAccrual?.salaryGrowthRate,
                          accrualDenominator: prev.futureAccrual?.accrualDenominator,
                        },
                      }))}
                      className="input-dark font-mono"
                    />
                    <p className="text-[0.6rem] mt-1" style={{ color: 'var(--text-muted)' }}>
                      Member contribution rate at this salary: {memberContributionRate(local.futureAccrual?.currentSalary ?? 0)}%
                    </p>
                  </Field>
                  <Field label="Expected Leaving Age">
                    <NumberField
                      value={local.futureAccrual?.leavingAge ?? local.claimAge}
                      onChange={v => setLocal(prev => ({
                        ...prev,
                        futureAccrual: {
                          currentSalary: prev.futureAccrual?.currentSalary ?? 0,
                          leavingAge: v,
                          salaryGrowthRate: prev.futureAccrual?.salaryGrowthRate,
                          accrualDenominator: prev.futureAccrual?.accrualDenominator,
                        },
                      }))}
                      className="input-dark font-mono"
                    />
                  </Field>
                  <Field label="Salary Growth (%/yr)">
                    <NumberField
                      value={local.futureAccrual?.salaryGrowthRate ?? config.inflationRate}
                      step="0.1"
                      onChange={v => setLocal(prev => ({
                        ...prev,
                        futureAccrual: {
                          currentSalary: prev.futureAccrual?.currentSalary ?? 0,
                          leavingAge: prev.futureAccrual?.leavingAge ?? prev.claimAge,
                          salaryGrowthRate: v,
                          accrualDenominator: prev.futureAccrual?.accrualDenominator,
                        },
                      }))}
                      className="input-dark font-mono"
                    />
                    <p className="text-[0.6rem] mt-1" style={{ color: 'var(--text-muted)' }}>Defaults to your inflation assumption ({config.inflationRate}%).</p>
                  </Field>
                  <Field label="Accrual Election">
                    <select
                      value={local.futureAccrual?.accrualDenominator ?? 57}
                      onChange={e => setLocal(prev => ({
                        ...prev,
                        futureAccrual: {
                          currentSalary: prev.futureAccrual?.currentSalary ?? 0,
                          leavingAge: prev.futureAccrual?.leavingAge ?? prev.claimAge,
                          salaryGrowthRate: prev.futureAccrual?.salaryGrowthRate,
                          accrualDenominator: Number(e.target.value) as 57 | 55 | 50 | 45,
                        },
                      }))}
                      className="input-dark"
                    >
                      <option value={57}>Standard (1/57th)</option>
                      <option value={55}>Faster accrual (1/55th)</option>
                      <option value={50}>Faster accrual (1/50th)</option>
                      <option value={45}>Faster accrual (1/45th)</option>
                    </select>
                  </Field>
                </>
              )}
            </ConfigSection>

            <ConfigSection title="Claiming" isOpen={openSections.has('Claiming')} onToggle={() => toggleSection('Claiming')}>
              <Field label="Claim Age">
                <NumberField
                  value={local.claimAge}
                  onChange={v => setLocal(prev => ({ ...prev, claimAge: v }))}
                  className="input-dark font-mono"
                />
                <p className="text-[0.6rem] mt-1" style={{ color: local.claimAge < minAge ? 'var(--negative)' : 'var(--text-muted)' }}>
                  Your minimum pension age is {minAge}.
                </p>
              </Field>
              <Field label="Commutation — Pension Given Up (£/yr)">
                <NumberField
                  value={local.commutedPension ?? 0}
                  onChange={v => setLocal(prev => ({ ...prev, commutedPension: v }))}
                  className="input-dark font-mono"
                />
                <p className="text-[0.6rem] mt-1" style={{ color: 'var(--text-muted)' }}>
                  = £{Math.round((local.commutedPension ?? 0) * COMMUTATION_RATE).toLocaleString()} added to lump sum at {COMMUTATION_RATE}:1.
                </p>
              </Field>
            </ConfigSection>
          </div>

          {/* Headline */}
          {computed && (
            <div className="card p-6 space-y-5 animate-in">
              <div>
                <p className="text-[0.65rem] font-medium uppercase tracking-wider mb-1" style={{ color: 'var(--text-tertiary)' }}>
                  Total Annual Pension at Claim (Age {local.claimAge})
                </p>
                <p className="font-display text-4xl font-bold" style={{ color: 'var(--gold-bright)' }}>
                  {formatPoundsShort(computed.totalAnnualPensionReal)}
                  <span className="text-base font-normal ml-1" style={{ color: 'var(--text-muted)' }}>/yr, today's money</span>
                </p>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {formatPoundsShort(totalPensionNominal)}/yr nominal in {new Date().getFullYear() + Math.max(0, local.claimAge - currentAge)}
                </p>
              </div>

              {trancheRows.length > 0 && (
                <div className="space-y-1.5">
                  {trancheRows.map(t => (
                    <div key={t.label} className="flex items-center justify-between text-xs gap-3">
                      <span style={{ color: 'var(--text-secondary)' }}>{t.label.replace('TPS ', '')}</span>
                      <span className="font-mono text-right" style={{ color: 'var(--text-primary)' }}>
                        {formatPoundsShort(t.real)}/yr
                        {t.reductionPct > 0.5 && (
                          <span className="ml-1.5" style={{ color: 'var(--negative)' }}>
                            (reduced {Math.round(t.reductionPct)}% for claiming {Math.round(t.yearsEarly)} yr early)
                          </span>
                        )}
                        {t.reductionPct < -0.5 && (
                          <span className="ml-1.5" style={{ color: 'var(--positive)' }}>
                            (boosted {Math.round(-t.reductionPct)}% for claiming after NPA)
                          </span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Tax-free lump sum</span>
                <span className="font-mono text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{formatPoundsShort(lumpSumReal)}</span>
              </div>

              {(local.commutedPension ?? 0) > 0 && (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Commuting {formatPoundsShort(local.commutedPension ?? 0)}/yr = £{Math.round((local.commutedPension ?? 0) * COMMUTATION_RATE).toLocaleString()} added to lump sum
                </p>
              )}

              {computed.warnings.length > 0 && (
                <div className="space-y-2 pt-1">
                  {computed.warnings.map((w, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-lg px-3 py-2 text-xs"
                      style={{ background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.3)', color: '#f59e0b' }}
                    >
                      <span>&#9888;</span>
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 1. Claim-age sweep */}
          <div className="card p-6 space-y-3 animate-in">
            <h3 className="font-display text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Claim-Age Sweep
            </h3>
            <p className="text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>
              How your total annual pension and lump sum change if you claim earlier or later, from your minimum pension
              age ({minAge}) to 70. Dashed lines mark each tranche&rsquo;s Normal Pension Age and your currently selected
              claim age.
            </p>
            <ClaimAgeSweepChart rows={sweepRows} selectedClaimAge={local.claimAge} npaMarkers={npaMarkers} />
          </div>

          {/* 2. McCloud comparison */}
          {computed?.mcCloudComparison && (
            <div className="card p-6 space-y-4 animate-in">
              <h3 className="font-display text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                McCloud Remedy &mdash; Final Salary vs Career Average
              </h3>
              <div className="grid grid-cols-2 gap-4 text-xs">
                <div className="space-y-1.5">
                  <p
                    className="font-medium uppercase tracking-wider text-[0.65rem]"
                    style={{ color: computed.mcCloudComparison.recommended === 'finalSalary' ? 'var(--gold-bright)' : 'var(--text-tertiary)' }}
                  >
                    Final salary{computed.mcCloudComparison.recommended === 'finalSalary' ? ' (recommended)' : ''}
                  </p>
                  <StatRow label="Annual pension" value={`${formatPoundsShort(computed.mcCloudComparison.finalSalary.annualPensionReal)}/yr`} />
                  <StatRow label="Lump sum" value={formatPoundsShort(computed.mcCloudComparison.finalSalary.lumpSumReal)} />
                  <StatRow label="Cumulative to life expectancy" value={formatPoundsShort(computed.mcCloudComparison.finalSalary.cumulativeRealToLifeExpectancy)} />
                </div>
                <div className="space-y-1.5">
                  <p
                    className="font-medium uppercase tracking-wider text-[0.65rem]"
                    style={{ color: computed.mcCloudComparison.recommended === 'careerAverage' ? 'var(--gold-bright)' : 'var(--text-tertiary)' }}
                  >
                    Career average{computed.mcCloudComparison.recommended === 'careerAverage' ? ' (recommended)' : ''}
                  </p>
                  <StatRow label="Annual pension" value={`${formatPoundsShort(computed.mcCloudComparison.careerAverage.annualPensionReal)}/yr`} />
                  <StatRow label="Lump sum" value={formatPoundsShort(computed.mcCloudComparison.careerAverage.lumpSumReal)} />
                  <StatRow label="Cumulative to life expectancy" value={formatPoundsShort(computed.mcCloudComparison.careerAverage.cumulativeRealToLifeExpectancy)} />
                </div>
              </div>

              {computed.mcCloudComparison.breakevenAge != null && (
                <p className="text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>
                  Breakeven age (where the two branches&rsquo; cumulative value crosses): {computed.mcCloudComparison.breakevenAge.toFixed(1)}
                </p>
              )}

              <div
                className="rounded-lg px-3 py-2 text-xs"
                style={{ background: 'rgba(201, 162, 39, 0.1)', border: '1px solid rgba(201, 162, 39, 0.3)', color: 'var(--gold-bright)' }}
              >
                {computed.mcCloudComparison.recommended === 'finalSalary' ? 'Final salary' : 'Career average'} looks better at your claim age of{' '}
                {local.claimAge} by{' '}
                {formatPoundsShort(
                  Math.abs(
                    computed.mcCloudComparison.finalSalary.cumulativeRealToLifeExpectancy -
                      computed.mcCloudComparison.careerAverage.cumulativeRealToLifeExpectancy,
                  ),
                )}{' '}
                over your plan to age {config.lifeExpectancy ?? 100}.
              </div>

              {computed.mcCloudComparison.reasons.length > 0 && (
                <ul className="space-y-1 text-[0.7rem] list-disc list-inside" style={{ color: 'var(--text-secondary)' }}>
                  {computed.mcCloudComparison.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              )}

              <p className="text-[0.6rem] pt-1" style={{ borderTop: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                The binding choice is made at retirement via your Remediable Service Statement &mdash; this models which
                way it&rsquo;s likely to go.
              </p>
            </div>
          )}

          {/* 3. Additional Pension calculator */}
          <div className="card p-6 space-y-4 animate-in">
            <h3 className="font-display text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Additional Pension Calculator
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label={`Extra Pension: ${formatPoundsShort(apBlocks * AP_BLOCK)}/yr`}>
                <input
                  type="range"
                  min={1}
                  max={maxApBlocks}
                  step={1}
                  value={apBlocks}
                  onChange={e => setApBlocks(Number(e.target.value))}
                  className="w-full"
                />
                <p className="text-[0.6rem] mt-1" style={{ color: 'var(--text-muted)' }}>
                  {apBlocks} &times; £{AP_BLOCK} blocks (max £{(maxApBlocks * AP_BLOCK).toLocaleString()}/yr).
                </p>
              </Field>
              <Field label="Marginal Tax Rate">
                <select value={marginalTaxRate} onChange={e => setMarginalTaxRate(Number(e.target.value))} className="input-dark">
                  <option value={20}>20%</option>
                  <option value={40}>40%</option>
                  <option value={45}>45%</option>
                </select>
              </Field>
            </div>

            {apNpaClamped && (
              <p className="text-[0.65rem]" style={{ color: '#f59e0b' }}>
                This calculator only supports NPA 65&ndash;68 &mdash; using {apNpa} in place of your configured career-average NPA
                of {careNpaRaw}.
              </p>
            )}

            {apResult ? (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                  <StatRow label="Gross cost" value={formatPoundsShort(apResult.grossCost)} />
                  <StatRow label="Net cost (after tax relief)" value={formatPoundsShort(apResult.netCost)} />
                  <StatRow label="Cost per £1/yr (net)" value={`£${apResult.costPerPoundNet.toFixed(2)}`} />
                  <StatRow label="Effective pension at claim" value={`${formatPoundsShort(apResult.effectivePensionAtClaim)}/yr`} />
                  <StatRow label="SIPP-equivalent capital" value={formatPoundsShort(apResult.sippEquivalentCapital)} />
                  <StatRow label="Open-market annuity cost" value={formatPoundsShort(apResult.annuityEquivalentCost)} />
                </div>
                <VerdictBadge verdict={apResult.verdict} />
                <ul className="space-y-1 text-[0.65rem] list-disc list-inside" style={{ color: 'var(--text-muted)' }}>
                  {apResult.caveats.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Enter a valid amount to see the value calculation.
              </p>
            )}
          </div>

          {/* 4. Faster Accrual calculator */}
          {local.stillInService && local.futureAccrual && (
            <div className="card p-6 space-y-4 animate-in">
              <h3 className="font-display text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Faster Accrual Calculator
              </h3>
              <Field label="Accrual Election for This Scheme Year">
                <select
                  value={fasterDenom}
                  onChange={e => setFasterDenom(Number(e.target.value) as 55 | 50 | 45)}
                  className="input-dark"
                >
                  <option value={55}>1/55th</option>
                  <option value={50}>1/50th</option>
                  <option value={45}>1/45th</option>
                </select>
                <p className="text-[0.6rem] mt-1" style={{ color: 'var(--text-muted)' }}>
                  Uses the marginal tax rate selected above ({marginalTaxRate}%).
                </p>
              </Field>

              {fasterResult ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                    <StatRow label="Extra contribution" value={`${fasterResult.extraContributionPct}% (${formatPoundsShort(fasterResult.extraContributionAnnual)}/yr)`} />
                    <StatRow label="Extra pension earned" value={`${formatPoundsShort(fasterResult.extraPensionEarned)}/yr`} />
                    <StatRow label="Cost per £1/yr (gross)" value={`£${fasterResult.costPerPoundGross.toFixed(2)}`} />
                    <StatRow label="Cost per £1/yr (net)" value={`£${fasterResult.costPerPoundNet.toFixed(2)}`} />
                  </div>
                  <VerdictBadge verdict={fasterResult.verdict} />
                  <ul className="space-y-1 text-[0.65rem] list-disc list-inside" style={{ color: 'var(--text-muted)' }}>
                    {fasterResult.caveats.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Enter your current salary above to see the value calculation.
                </p>
              )}
            </div>
          )}

          {/* 5. When not to buy */}
          <div className="card p-6 space-y-3 animate-in">
            <h3 className="font-display text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              When NOT to Buy TPS Extras
            </h3>
            <ul className="space-y-2 text-xs list-disc list-inside" style={{ color: 'var(--text-secondary)' }}>
              {WHEN_NOT_TO_BUY.map((item, i) => (
                <li key={i}>{item}</li>
              ))}
            </ul>
          </div>

          {/* 6. Scenario export */}
          {local.mcCloud && (
            <div className="card p-6 space-y-3 animate-in">
              <h3 className="font-display text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                Compare in Your FIRE Plan
              </h3>
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Save both McCloud branches as FIRE scenarios to compare their full projections side by side on the FIRE
                page.
              </p>
              <button onClick={handleExportScenarios} disabled={savingScenarios} className="btn-gold py-2 px-4 text-sm">
                {savingScenarios ? 'Saving...' : 'Save FS vs CARE as Scenarios'}
              </button>
              {scenarioExportStatus === 'success' && (
                <p className="text-xs" style={{ color: 'var(--positive)' }}>
                  Saved &mdash; view &ldquo;TPS: final salary choice&rdquo; and &ldquo;TPS: career average choice&rdquo; on the FIRE page.
                </p>
              )}
              {scenarioExportStatus === 'error' && (
                <p className="text-xs" style={{ color: 'var(--negative)' }}>
                  Failed to save one or both scenarios &mdash; please try again.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1">
            <button onClick={handleSave} disabled={saving} className="btn-gold w-full py-2.5">
              {saving ? 'Saving...' : 'Apply to FIRE Plan'}
            </button>
            <p className="text-center text-[0.65rem]" style={{ color: 'var(--text-muted)' }}>
              {isDirty ? 'Unsaved changes' : savedAt ? 'All changes saved' : ' '}
            </p>
          </div>
        </>
      )}
    </div>
  );
}
