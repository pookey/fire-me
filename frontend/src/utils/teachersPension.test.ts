import { describe, it, expect } from 'vitest';
import { computeTpsBenefits, type TpsContext } from './teachersPension';
import type { TeachersPensionConfig } from '../types';

const CTX: TpsContext = { currentAge: 45, inflationRate: 2.5, lifeExpectancy: 90, minPensionAge: 57 };

// careReval = (1 + 0.025 + 0.016) / 1.025 - 1 = 1.041/1.025 - 1 = 0.0156097560975...
// fsReval (g = cpi = 2.5%) = 1.025/1.025 - 1 = 0
const base = (over: Partial<TeachersPensionConfig>): TeachersPensionConfig => ({
  enabled: true,
  statementDate: '2026-01',
  stillInService: false,
  claimAge: 60,
  ...over,
});

describe('computeTpsBenefits', () => {
  // 1. CARE-only, deferred, claim at NPA 68 → no reduction, no revaluation
  //    (serviceYears = 0), real pension = accrued 10000 exactly.
  it('CARE-only deferred at NPA: exact passthrough', () => {
    const r = computeTpsBenefits(
      base({ claimAge: 68, careerAverage: { accruedAnnualPension: 10000, normalPensionAge: 68 } }),
      CTX,
    );
    expect(r.totalAnnualPensionReal).toBeCloseTo(10000, 6);
    // nominal at claim = 10000 × 1.025^(68-45) = 10000 × 1.025^23
    expect(r.streams[0].annualPensionAtClaim).toBeCloseTo(10000 * 1.025 ** 23, 4);
    expect(r.totalLumpSumAtClaim).toBe(0);
  });

  // 2. CARE, still in service to 55, 10 remaining years on £50k, denom 57, g = cpi.
  //    fsReval = 0, careReval = 0.01560975...; accrued = 0.
  //    carePension = Σ_{t=0..9} (50000/57) × (1+careReval)^(9-t) = 9414.467 (node-computed).
  //    leavingAge 55 < claim 68 → deferred at claim, ER8(0) = 1.0 (no reduction).
  it('future CARE accrual sums correctly', () => {
    const r = computeTpsBenefits(
      base({
        claimAge: 68,
        stillInService: true,
        careerAverage: { accruedAnnualPension: 0, normalPensionAge: 68 },
        futureAccrual: { currentSalary: 50000, leavingAge: 55, salaryGrowthRate: 2.5, accrualDenominator: 57 },
      }),
      CTX,
    );
    expect(r.totalAnnualPensionReal).toBeCloseTo(9414.467, 2);
  });

  // 3. CARE claim 58, NPA 68, deferred → ER8(10) = 0.632 → 10000 × 0.632 = 6320.
  it('CARE deferred, 10yr early: ER8(10) = 0.632', () => {
    const r = computeTpsBenefits(
      base({ claimAge: 58, careerAverage: { accruedAnnualPension: 10000, normalPensionAge: 68 } }),
      CTX,
    );
    expect(r.totalAnnualPensionReal).toBeCloseTo(6320, 6);
  });

  // 4. CARE claim 58, NPA 68, IN SERVICE to 58 (currentAge=58 so serviceYears=0).
  //    factor = ER7(7) × (1 − 0.03×min(3, 68−65)) = 0.729 × 0.91 = 0.66339.
  //    10000 × 0.66339 = 6633.9.
  it('CARE active reduction: ER7(7) × standard = 0.66339', () => {
    const r = computeTpsBenefits(
      base({
        claimAge: 58,
        stillInService: true,
        careerAverage: { accruedAnnualPension: 10000, normalPensionAge: 68 },
      }),
      { ...CTX, currentAge: 58 },
    );
    expect(r.totalAnnualPensionReal).toBeCloseTo(6633.9, 4);
  });

  // 5. NPA60 FS £8,000 + £24,000 lump sum, claim 57 (yearsEarly = 3), deferred.
  //    pension × ERF_NPA60(3)=0.891 → 7128; lump × ERF_NPA60_LUMPSUM(3)=0.938 → 22512.
  it('NPA60 FS early claim at 57: pension 7128, lump 22512', () => {
    const r = computeTpsBenefits(
      base({
        claimAge: 57,
        finalSalary: { section: 'npa60', accruedAnnualPension: 8000, automaticLumpSum: 24000 },
      }),
      CTX,
    );
    expect(r.totalAnnualPensionReal).toBeCloseTo(7128, 6);
    // nominal lump = 22512 × 1.025^(57-45) = 22512 × 1.025^12
    expect(r.totalLumpSumAtClaim).toBeCloseTo(22512 * 1.025 ** 12, 4);
    expect(r.warnings).toHaveLength(0);
  });

  // 6. NPA60 claim at 63: no late uplift (pension unchanged) + warning.
  it('NPA60 late claim: no uplift + warning', () => {
    const r = computeTpsBenefits(
      base({
        claimAge: 63,
        finalSalary: { section: 'npa60', accruedAnnualPension: 8000, automaticLumpSum: 24000 },
      }),
      CTX,
    );
    expect(r.totalAnnualPensionReal).toBeCloseTo(8000, 6);
    expect(r.warnings).toContain('NPA60 benefits get no late-retirement uplift — deferring past 60 forfeits payments.');
  });

  // 7a. Commutation £1,000 of £10,000 pension, no existing LS → pension 9000, lump 12000.
  it('commutation within cap: pension 9000, lump 12000', () => {
    const r = computeTpsBenefits(
      base({
        claimAge: 68,
        careerAverage: { accruedAnnualPension: 10000, normalPensionAge: 68 },
        commutedPension: 1000,
      }),
      CTX,
    );
    expect(r.totalAnnualPensionReal).toBeCloseTo(9000, 6);
    // lump real = 12 × 1000 = 12000; nominal = 12000 × 1.025^23
    expect(r.totalLumpSumAtClaim).toBeCloseTo(12000 * 1.025 ** 23, 2);
    expect(r.warnings).toHaveLength(0);
  });

  // 7b. Commute £6,000 → HMRC cap c ≤ (5×10000 − 0)/14 = 3571.43 → clamped + warning.
  //     pension = 10000 × (1 − 3571.43/10000) = 6428.57; lump = 12 × 3571.43 = 42857.14.
  it('commutation over HMRC cap: clamped to /14 with warning', () => {
    const r = computeTpsBenefits(
      base({
        claimAge: 68,
        careerAverage: { accruedAnnualPension: 10000, normalPensionAge: 68 },
        commutedPension: 6000,
      }),
      CTX,
    );
    expect(r.totalAnnualPensionReal).toBeCloseTo(10000 - 50000 / 14, 4); // 10000 − 3571.43 = 6428.571
    expect(r.warnings).toContain('Commutation clamped to HMRC 25% limit');
  });

  // 8. McCloud early claim (60), NPA60 remedy FS £3,500 + LS £10,500 vs CARE £4,200, NPA 68.
  //    FS branch: 3500 unreduced at 60 + 10500 LS → cumulative 10500 + 3500×30 = 115,500.
  //    CARE branch: 4200 × ER8(8)=0.688 = 2889.6 → cumulative 2889.6×30 = 86,688.
  //    → FS recommended.
  it('McCloud early: FS recommended', () => {
    const r = computeTpsBenefits(
      base({
        claimAge: 60,
        finalSalary: { section: 'npa60', accruedAnnualPension: 0 },
        careerAverage: { accruedAnnualPension: 0, normalPensionAge: 68 },
        mcCloud: { finalSalaryAnnualPension: 3500, finalSalaryLumpSum: 10500, careAnnualPension: 4200, choice: 'auto' },
      }),
      CTX,
    );
    expect(r.mcCloudComparison?.recommended).toBe('finalSalary');
    expect(r.mcCloudComparison?.finalSalary.annualPensionReal).toBeCloseTo(3500, 4);
    expect(r.mcCloudComparison?.finalSalary.lumpSumReal).toBeCloseTo(10500, 4);
    expect(r.mcCloudComparison?.careerAverage.annualPensionReal).toBeCloseTo(2889.6, 4);
    expect(r.mcCloudComparison?.reasons.length).toBeGreaterThan(0);
    // auto → FS chosen: an FS stream is emitted
    expect(r.streams.some((s) => s.label === 'TPS final salary')).toBe(true);
  });

  // 9. McCloud claim at 68 (both at/after NPA): FS £3,500 + £10,500 LS vs CARE £4,200.
  //    FS cumulative = 10500 + 3500×22 = 87,500; CARE = 4200×22 = 92,400 → CARE recommended.
  //    Breakeven: t = (10500 − 0)/(4200 − 3500) = 15 → age 83.
  it('McCloud at NPA: CARE recommended, breakeven 83', () => {
    const r = computeTpsBenefits(
      base({
        claimAge: 68,
        finalSalary: { section: 'npa60', accruedAnnualPension: 0 },
        careerAverage: { accruedAnnualPension: 0, normalPensionAge: 68 },
        mcCloud: { finalSalaryAnnualPension: 3500, finalSalaryLumpSum: 10500, careAnnualPension: 4200, choice: 'auto' },
      }),
      CTX,
    );
    expect(r.mcCloudComparison?.recommended).toBe('careerAverage');
    expect(r.mcCloudComparison?.careerAverage.annualPensionReal).toBeCloseTo(4200, 4);
    expect(r.mcCloudComparison?.breakevenAge).toBeCloseTo(83, 4);
  });

  // 10. Nominal conversion: claim 15 years out (currentAge 45, claim 60), real £10,000,
  //     CARE NPA 60 so no reduction. stream nominal = 10000 × 1.025^15 = 14482.98.
  it('nominal conversion at claim year', () => {
    const r = computeTpsBenefits(
      base({ claimAge: 60, careerAverage: { accruedAnnualPension: 10000, normalPensionAge: 60 } }),
      CTX,
    );
    expect(r.streams[0].startAge).toBe(60);
    expect(r.streams[0].annualPensionAtClaim).toBeCloseTo(10000 * 1.025 ** 15, 2);
  });
});

describe('computeTpsBenefits edge cases (no NaN / crash)', () => {
  const finite = (n: number | undefined) => typeof n === 'number' && Number.isFinite(n);

  it('no finalSalary block, mcCloud present with default careNpa 68', () => {
    const r = computeTpsBenefits(
      base({
        claimAge: 60,
        mcCloud: { finalSalaryAnnualPension: 3000, careAnnualPension: 3500, choice: 'auto' },
      }),
      CTX,
    );
    expect(finite(r.totalAnnualPensionReal)).toBe(true);
    expect(finite(r.mcCloudComparison?.finalSalary.annualPensionReal)).toBe(true);
    expect(finite(r.mcCloudComparison?.careerAverage.annualPensionReal)).toBe(true);
  });

  it('stillInService with no futureAccrual', () => {
    const r = computeTpsBenefits(
      base({ claimAge: 60, stillInService: true, careerAverage: { accruedAnnualPension: 8000, normalPensionAge: 68 } }),
      CTX,
    );
    expect(finite(r.totalAnnualPensionReal)).toBe(true);
  });

  it('claimAge equal to NPA and commutedPension undefined', () => {
    const r = computeTpsBenefits(
      base({ claimAge: 65, careerAverage: { accruedAnnualPension: 8000, normalPensionAge: 65 } }),
      CTX,
    );
    expect(r.totalAnnualPensionReal).toBeCloseTo(8000, 6);
    expect(r.totalLumpSumAtClaim).toBe(0);
  });

  it('fractional service years', () => {
    const r = computeTpsBenefits(
      base({
        claimAge: 60,
        stillInService: true,
        careerAverage: { accruedAnnualPension: 5000, normalPensionAge: 68 },
        futureAccrual: { currentSalary: 40000, leavingAge: 60, accrualDenominator: 57 },
      }),
      { ...CTX, currentAge: 52.5 }, // serviceYears = 7.5
    );
    expect(finite(r.totalAnnualPensionReal)).toBe(true);
    expect(r.totalAnnualPensionReal).toBeGreaterThan(0);
  });
});
