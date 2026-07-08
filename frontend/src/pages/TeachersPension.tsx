import { useEffect, useState, useMemo } from 'react';
import { getFireConfig, updateFireConfig } from '../utils/api';
import { computeTpsBenefits } from '../utils/teachersPension';
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
} from '../utils/tpsFactors';
import { ConfigSection, Field } from '../components/ConfigSection';
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

          {/* Step 9 decision tools land here: claim-age sweep chart, McCloud
              final-salary vs career-average comparison card, Additional
              Pension / Faster Accrual value calculators, "when not to buy"
              guidance, and scenario export. */}
          <div className="card p-5" style={{ border: '1px dashed var(--border-subtle)' }}>
            <h3 className="font-display text-sm font-semibold mb-1" style={{ color: 'var(--text-tertiary)' }}>
              Decision tools &mdash; coming soon
            </h3>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              A claim-age sweep chart, McCloud final-salary vs career-average comparison, Additional Pension &amp; Faster
              Accrual value calculators, and purchase guidance will appear here.
            </p>
          </div>

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
