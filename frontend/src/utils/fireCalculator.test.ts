import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { calculateFireProjections, calculateIncomeTax, calculateCGT, findSubYearFireFraction, earliestFireAge, accessibleGrowthRateFromRow, DEFAULT_DRAWDOWN_ORDER, normaliseDrawdownOrder } from './fireCalculator';
import type { Fund, Snapshot, FireConfig, TaxConfig, FireProjection, TeachersPensionConfig } from '../types';

// --- Test helpers ---

function makeFund(overrides: Partial<Fund> = {}): Fund {
  return {
    id: 'fund-1',
    name: 'Test Fund',
    category: 'savings',
    subcategory: 'equities',
    active: true,
    sortOrder: 0,
    ...overrides,
  };
}

function makeSnapshot(overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    fundId: 'fund-1',
    date: '2026-01-01',
    value: 100000,
    fundName: 'Test Fund',
    category: 'savings',
    ...overrides,
  };
}

function makeConfig(overrides: Partial<FireConfig> = {}): FireConfig {
  return {
    targetAnnualSpend: 30000,
    growthRates: { equities: 7, bonds: 3, cash: 1, property: 4 },
    inflationRate: 0, // zero inflation by default for simpler test assertions
    pensionAccessAge: 57,
    statePensionAmount: 11000,
    statePensionAge: 68,
    withdrawalRates: [4],
    dateOfBirth: '1990-01-01',
    ...overrides,
  };
}

// Fix time so age calculations are deterministic
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01'));
});

afterEach(() => {
  vi.useRealTimers();
});

// --- Tests ---

describe('fireCalculator', () => {
  describe('categorizeFundValues (tested indirectly)', () => {
    it('puts savings funds into accessible bucket', () => {
      const funds = [makeFund({ category: 'savings', subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 50000 })];
      const result = calculateFireProjections(funds, snapshots, makeConfig());

      const first = result.projections[0];
      expect(first.accessible).toBe(50000);
      expect(first.locked).toBe(0);
    });

    it('puts pension funds into locked bucket', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 80000 })];
      const result = calculateFireProjections(funds, snapshots, makeConfig());

      const first = result.projections[0];
      expect(first.accessible).toBe(0);
      expect(first.locked).toBe(80000);
    });

    it('puts property category funds into accessible bucket', () => {
      const funds = [makeFund({ category: 'property', subcategory: 'property' })];
      const snapshots = [makeSnapshot({ value: 200000 })];
      const result = calculateFireProjections(funds, snapshots, makeConfig());

      const first = result.projections[0];
      expect(first.accessible).toBe(200000);
      expect(first.locked).toBe(0);
    });

    it('maps subcategories correctly across multiple funds', () => {
      const funds = [
        makeFund({ id: 'eq', category: 'savings', subcategory: 'equities' }),
        makeFund({ id: 'bo', category: 'savings', subcategory: 'bonds' }),
        makeFund({ id: 'ca', category: 'savings', subcategory: 'cash' }),
        makeFund({ id: 'pr', category: 'property', subcategory: 'property' }),
        makeFund({ id: 'pe', category: 'pension', subcategory: 'equities' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'eq', value: 10000 }),
        makeSnapshot({ fundId: 'bo', value: 20000 }),
        makeSnapshot({ fundId: 'ca', value: 30000 }),
        makeSnapshot({ fundId: 'pr', value: 40000 }),
        makeSnapshot({ fundId: 'pe', value: 50000 }),
      ];
      const result = calculateFireProjections(funds, snapshots, makeConfig());

      const first = result.projections[0];
      expect(first.accessible).toBe(100000);
      expect(first.locked).toBe(50000);
    });
  });

  describe('growth rate application', () => {
    it('grows equities at the equities growth rate after 1 year', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 10, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].accessible).toBe(100000);
      expect(result.projections[1].accessible).toBe(110000);
    });

    it('grows bonds at the bonds growth rate', () => {
      const funds = [makeFund({ subcategory: 'bonds' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 5, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].accessible).toBe(100000);
      expect(result.projections[1].accessible).toBe(105000);
    });

    it('grows cash at the cash growth rate', () => {
      const funds = [makeFund({ subcategory: 'cash' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 2, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].accessible).toBe(100000);
      expect(result.projections[1].accessible).toBe(102000);
    });

    it('uses per-asset-class growth rates in subsequent years (not just year 1)', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 10, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[2].accessible).toBe(Math.round(100000 * 1.1 * 1.1));
    });
  });

  describe('property growth rate independence', () => {
    it('grows property at property rate, not equities rate', () => {
      const funds = [
        makeFund({ id: 'eq', subcategory: 'equities' }),
        makeFund({ id: 'pr', category: 'property', subcategory: 'property' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'eq', value: 100000 }),
        makeSnapshot({ fundId: 'pr', value: 100000 }),
      ];
      const config = makeConfig({
        growthRates: { equities: 10, bonds: 0, cash: 0, property: 4 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[1].accessible).toBe(214000);
    });

    it('property does not use equities rate even in subsequent years', () => {
      const funds = [makeFund({ category: 'property', subcategory: 'property' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 10, bonds: 0, cash: 0, property: 4 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[1].accessible).toBe(104000);
      expect(result.projections[2].accessible).toBe(Math.round(100000 * 1.04 * 1.04));
    });
  });

  describe('pension unlocking', () => {
    it('moves locked funds to accessible at pensionAccessAge', () => {
      const funds = [
        makeFund({ id: 'sav', category: 'savings', subcategory: 'cash' }),
        makeFund({ id: 'pen', category: 'pension', subcategory: 'equities' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'sav', value: 10000 }),
        makeSnapshot({ fundId: 'pen', value: 50000 }),
      ];
      const config = makeConfig({
        pensionAccessAge: 40,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const age39 = result.projections.find(p => p.age === 39)!;
      expect(age39.locked).toBe(50000);
      expect(age39.accessible).toBe(10000);

      const age40 = result.projections.find(p => p.age === 40)!;
      expect(age40.locked).toBe(0);
      expect(age40.accessible).toBe(60000);
    });

    it('locked funds are 0 after pension access age', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        pensionAccessAge: 40,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const age45 = result.projections.find(p => p.age === 45)!;
      expect(age45.locked).toBe(0);
      expect(age45.accessible).toBe(100000);
    });
  });

  describe('state pension', () => {
    it('state pension is 0 before statePensionAge', () => {
      const funds = [makeFund()];
      const snapshots = [makeSnapshot()];
      const config = makeConfig({ statePensionAge: 68, statePensionAmount: 11000 });
      const result = calculateFireProjections(funds, snapshots, config);

      const age50 = result.projections.find(p => p.age === 50)!;
      expect(age50.statePension).toBe(0);
    });

    it('state pension equals configured amount at statePensionAge', () => {
      const funds = [makeFund()];
      const snapshots = [makeSnapshot()];
      const config = makeConfig({ statePensionAge: 68, statePensionAmount: 11000 });
      const result = calculateFireProjections(funds, snapshots, config);

      const age68 = result.projections.find(p => p.age === 68)!;
      expect(age68.statePension).toBe(11000);
    });

    it('state pension persists after statePensionAge', () => {
      const funds = [makeFund()];
      const snapshots = [makeSnapshot()];
      const config = makeConfig({ statePensionAge: 68, statePensionAmount: 11000 });
      const result = calculateFireProjections(funds, snapshots, config);

      const age75 = result.projections.find(p => p.age === 75)!;
      expect(age75.statePension).toBe(11000);
    });
  });

  describe('drawdown modelling', () => {
    it('subtracts annualSpend minus statePension from accessible once FIRE is reached', () => {
      const funds = [makeFund({ subcategory: 'equities', wrapper: 'isa' })];
      const snapshots = [makeSnapshot({ value: 1000000 })];
      const config = makeConfig({
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAge: 68,
        statePensionAmount: 0,
        withdrawalRates: [4],
        pensionAccessAge: 57,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.fireDates[0].age).toBe(36);
      expect(result.projections[0].accessible).toBe(1000000);
      expect(result.projections[1].accessible).toBe(970000);
      expect(result.projections[2].accessible).toBe(940000);
    });

    it('accounts for state pension in drawdown calculation', () => {
      const funds = [makeFund({ subcategory: 'equities', wrapper: 'isa' })];
      const snapshots = [makeSnapshot({ value: 1000000 })];
      const config = makeConfig({
        dateOfBirth: '1958-01-01',
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAge: 68,
        statePensionAmount: 10000,
        withdrawalRates: [4],
        pensionAccessAge: 57,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].accessible).toBe(1000000);
      expect(result.projections[1].accessible).toBe(980000);
    });
  });

  describe('FIRE date calculation', () => {
    it('finds the correct FIRE age for a given withdrawal rate', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        targetAnnualSpend: 20000,
        growthRates: { equities: 10, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        withdrawalRates: [4],
        pensionAccessAge: 57,
        statePensionAmount: 0,
        statePensionAge: 68,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const fireDate = result.fireDates[0];
      expect(fireDate.withdrawalRate).toBe(4);
      expect(fireDate.age).toBeGreaterThanOrEqual(52);
      expect(fireDate.age).toBeLessThanOrEqual(54);
      expect(fireDate.year).not.toBeNull();
    });

    it('returns null when FIRE is not achievable by end age', () => {
      const funds = [makeFund({ subcategory: 'cash' })];
      const snapshots = [makeSnapshot({ value: 1000 })];
      const config = makeConfig({
        targetAnnualSpend: 100000,
        growthRates: { equities: 0, bonds: 0, cash: 1, property: 0 },
        inflationRate: 5,
        withdrawalRates: [4],
        statePensionAmount: 0,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.fireDates[0].age).toBeNull();
      expect(result.fireDates[0].year).toBeNull();
    });

    it('calculates FIRE dates for multiple withdrawal rates', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 500000 })];
      const config = makeConfig({
        targetAnnualSpend: 20000,
        growthRates: { equities: 5, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        withdrawalRates: [3, 4, 5],
        statePensionAmount: 0,
        statePensionAge: 68,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.fireDates).toHaveLength(3);
      const ages = result.fireDates.map(d => d.age);
      expect(ages[2]).toBeLessThanOrEqual(ages[1]!);
      expect(ages[1]).toBeLessThanOrEqual(ages[0]!);
    });

    it('earliest FIRE age accounts for ISA bridging to pension access', () => {
      // Scenario: ISA can bridge spending to pension access age, SIPP is locked.
      // Target analysis at age 50 says "On Track", so fireDates must agree.
      // DOB 1981 → age 45 in 2026. Pension access at 57 (12 years from now).
      const funds = [
        makeFund({ id: 'isa-1', category: 'savings', subcategory: 'equities', wrapper: 'isa' }),
        makeFund({ id: 'sipp-1', category: 'pension', subcategory: 'equities', wrapper: 'sipp' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'isa-1', value: 150000 }),
        makeSnapshot({ fundId: 'sipp-1', value: 450000 }),
      ];
      const config = makeConfig({
        dateOfBirth: '1981-01-01',
        targetAnnualSpend: 30000,
        growthRates: { equities: 7, bonds: 3, cash: 1, property: 4 },
        inflationRate: 2,
        pensionAccessAge: 57,
        statePensionAmount: 11000,
        statePensionAge: 68,
        withdrawalRates: [4],
        targetRetirementAge: 50,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Target analysis says feasible at 50
      expect(result.targetAnalysis).toBeDefined();
      expect(result.targetAnalysis!.isFeasible).toBe(true);

      // Earliest FIRE age must be consistent — no later than 50
      expect(result.fireDates[0].age).not.toBeNull();
      expect(result.fireDates[0].age).toBeLessThanOrEqual(50);
    });
  });

  describe('inflation', () => {
    it('increases annualSpend by inflation rate each year', () => {
      const funds = [makeFund()];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        targetAnnualSpend: 30000,
        inflationRate: 3,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].annualSpend).toBe(30000);
      expect(result.projections[1].annualSpend).toBe(30900);
      expect(result.projections[2].annualSpend).toBe(Math.round(30000 * 1.03 * 1.03));
    });

    it('annualSpend stays constant with zero inflation', () => {
      const funds = [makeFund()];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        targetAnnualSpend: 25000,
        inflationRate: 0,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].annualSpend).toBe(25000);
      expect(result.projections[10].annualSpend).toBe(25000);
      expect(result.projections[30].annualSpend).toBe(25000);
    });
  });

  describe('projections structure', () => {
    it('projects from current age to 100 by default', () => {
      const funds = [makeFund()];
      const snapshots = [makeSnapshot()];
      const config = makeConfig();
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].age).toBe(36);
      expect(result.projections[result.projections.length - 1].age).toBe(100);
      expect(result.projections).toHaveLength(65);
    });

    it('total equals accessible plus locked', () => {
      const funds = [
        makeFund({ id: 'sav', category: 'savings', subcategory: 'equities' }),
        makeFund({ id: 'pen', category: 'pension', subcategory: 'bonds' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'sav', value: 100000 }),
        makeSnapshot({ fundId: 'pen', value: 50000 }),
      ];
      const config = makeConfig();
      const result = calculateFireProjections(funds, snapshots, config);

      for (const projection of result.projections) {
        expect(Math.abs(projection.total - (projection.accessible + projection.locked))).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('per-fund contributions', () => {
    it('adds per-fund monthly contributions each year', () => {
      const funds = [makeFund({ subcategory: 'equities', monthlyContribution: 1000 })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Year 0: 100000 + 12000 = 112000
      expect(result.projections[0].accessible).toBe(112000);
      // Year 1: 112000 + 12000 = 124000
      expect(result.projections[1].accessible).toBe(124000);
    });

    it('adds pension fund contributions to the locked bucket', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities', monthlyContribution: 500 })];
      const snapshots = [makeSnapshot({ value: 50000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Year 0: 50000 + 6000 = 56000
      expect(result.projections[0].locked).toBe(56000);
      expect(result.projections[0].accessible).toBe(0);
    });

    it('respects contributionEndAge', () => {
      const funds = [makeFund({ subcategory: 'equities', monthlyContribution: 1000, contributionEndAge: 37 })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Age 36 (contribution): 100000 + 12000 = 112000
      expect(result.projections[0].accessible).toBe(112000);
      // Age 37 (last year of contribution): 112000 + 12000 = 124000
      expect(result.projections[1].accessible).toBe(124000);
      // Age 38 (contribution ended): 124000
      expect(result.projections[2].accessible).toBe(124000);
    });

    it('tracks contribution amounts in projection', () => {
      const funds = [makeFund({ subcategory: 'equities', monthlyContribution: 1000 })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].contributions).toBe(12000);
      expect(result.projections[1].contributions).toBe(12000);
    });

    it('contributions compound with growth', () => {
      const funds = [makeFund({ subcategory: 'equities', monthlyContribution: 1000 })];
      const snapshots = [makeSnapshot({ value: 0 })];
      const config = makeConfig({
        growthRates: { equities: 10, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Year 0: 0 + 12000 = 12000
      expect(result.projections[0].accessible).toBe(12000);
      // Year 1: contributions are spread through the year, so they only earn
      // half a year's growth: 12000 * 1.10^0.5 + 12000 ≈ 24586
      expect(result.projections[1].accessible).toBe(24586);
    });

    it('mixed: some funds with contributions, some without', () => {
      const funds = [
        makeFund({ id: 'f1', subcategory: 'equities', monthlyContribution: 500 }),
        makeFund({ id: 'f2', subcategory: 'bonds' }), // no contribution
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'f1', value: 50000 }),
        makeSnapshot({ fundId: 'f2', value: 50000 }),
      ];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Year 0: 50000 + 6000 (f1) + 50000 (f2) = 106000
      expect(result.projections[0].accessible).toBe(106000);
      expect(result.projections[0].contributions).toBe(6000);
    });

    // System time is 2026-01-01, DOB 1990-01-01 → currentAge 36, currentYear 2026.
    it('prorates the first year when contributionStartDate is mid-year', () => {
      const funds = [makeFund({
        subcategory: 'equities',
        monthlyContribution: 1000,
        contributionStartDate: '2026-07', // 6 months in
      })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Year 0: 6 months × £1000 = £6000
      expect(result.projections[0].contributions).toBe(6000);
      expect(result.projections[0].accessible).toBe(106000);
      // Year 1: full 12 months
      expect(result.projections[1].contributions).toBe(12000);
      expect(result.projections[1].accessible).toBe(118000);
    });

    it('treats a past contributionStartDate the same as no start date', () => {
      const funds = [makeFund({
        subcategory: 'equities',
        monthlyContribution: 1000,
        contributionStartDate: '2025-01', // before currentYear
      })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].contributions).toBe(12000);
      expect(result.projections[0].accessible).toBe(112000);
    });

    it('contributes zero when contributionStartDate is after contributionEndAge', () => {
      const funds = [makeFund({
        subcategory: 'equities',
        monthlyContribution: 1000,
        contributionStartDate: '2031-01', // age 41
        contributionEndAge: 38,
      })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const totalContributions = result.projections.reduce((s, p) => s + (p.contributions ?? 0), 0);
      expect(totalContributions).toBe(0);
    });

    it('contributes zero when contributionStartDate is after targetRetirementAge', () => {
      const funds = [makeFund({
        subcategory: 'equities',
        monthlyContribution: 1000,
        contributionStartDate: '2031-01', // age 41
      })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      config.targetRetirementAge = 38;
      const result = calculateFireProjections(funds, snapshots, config);

      const totalContributions = result.projections.reduce((s, p) => s + (p.contributions ?? 0), 0);
      expect(totalContributions).toBe(0);
    });
  });

  describe('per-fund drawdown age', () => {
    it('locks fund until specified drawdown age regardless of wrapper', () => {
      // A GIA fund with custom drawdown age should be locked until that age
      const funds = [makeFund({ subcategory: 'equities', wrapper: 'gia', drawdownAge: 50 })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Before drawdown age
      const age36 = result.projections[0];
      expect(age36.accessible).toBe(0);
      expect(age36.locked).toBe(100000);

      // At drawdown age
      const age50 = result.projections.find(p => p.age === 50)!;
      expect(age50.accessible).toBe(100000);
      expect(age50.locked).toBe(0);
    });

    it('SIPP fund with custom drawdown age different from pensionAccessAge', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities', drawdownAge: 60 })];
      const snapshots = [makeSnapshot({ value: 200000 })];
      const config = makeConfig({
        pensionAccessAge: 57,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // At age 57 (default pensionAccessAge) — still locked because fund's drawdownAge is 60
      const age57 = result.projections.find(p => p.age === 57)!;
      expect(age57.locked).toBe(200000);
      expect(age57.accessible).toBe(0);

      // At age 60 — now accessible
      const age60 = result.projections.find(p => p.age === 60)!;
      expect(age60.locked).toBe(0);
      expect(age60.accessible).toBe(200000);
    });

    it('defaults SIPP to pensionAccessAge when no drawdownAge set', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        pensionAccessAge: 57,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const age56 = result.projections.find(p => p.age === 56)!;
      expect(age56.locked).toBe(100000);

      const age57 = result.projections.find(p => p.age === 57)!;
      expect(age57.accessible).toBe(100000);
    });

    it('defaults non-SIPP to current age (immediately accessible)', () => {
      const funds = [makeFund({ subcategory: 'equities', wrapper: 'isa' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].accessible).toBe(100000);
      expect(result.projections[0].locked).toBe(0);
    });
  });

  describe('lump sums', () => {
    it('grows a lump sum only from its month within the year', () => {
      const makeCase = (date: string) => {
        const funds = [makeFund({
          subcategory: 'equities',
          lumpSums: [{ type: 'inflow', amount: 12000, date, description: 'Bonus' }],
        })];
        const snapshots = [makeSnapshot({ value: 0 })];
        const config = makeConfig({
          growthRates: { equities: 10, bonds: 0, cash: 0, property: 0 },
        });
        return calculateFireProjections(funds, snapshots, config);
      };

      // Mid-month convention: January lump has 11.5/12 of the year to grow
      // (12000 × 1.1^(11.5/12) ≈ 13148); December has only 0.5/12 (≈ 12048).
      expect(makeCase('2026-01').projections[1].accessible).toBe(13148);
      expect(makeCase('2026-12').projections[1].accessible).toBe(12048);
    });

    it('applies an inflow lump sum in the year of the specified date', () => {
      const funds = [makeFund({
        subcategory: 'equities',
        lumpSums: [{ type: 'inflow', amount: 50000, date: '2028-06', description: 'Inheritance' }],
      })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].accessible).toBe(100000);
      expect(result.projections[1].accessible).toBe(100000);
      expect(result.projections[2].accessible).toBe(150000);
      expect(result.projections[3].accessible).toBe(150000);
    });

    it('applies an outflow lump sum in the year of the specified date', () => {
      const funds = [makeFund({
        subcategory: 'equities',
        lumpSums: [{ type: 'outflow', amount: 30000, date: '2027-03', description: 'Car purchase' }],
      })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].accessible).toBe(100000);
      expect(result.projections[1].accessible).toBe(70000);
    });

    it('applies lump sum to pension (locked) bucket', () => {
      const funds = [makeFund({
        category: 'pension',
        subcategory: 'equities',
        lumpSums: [{ type: 'inflow', amount: 20000, date: '2026-01', description: 'Pension transfer' }],
      })];
      const snapshots = [makeSnapshot({ value: 50000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].locked).toBe(70000);
      expect(result.projections[0].accessible).toBe(0);
    });

    it('only affects the fund the lump sum is attached to', () => {
      const funds = [
        makeFund({
          id: 'a',
          subcategory: 'equities',
          lumpSums: [{ type: 'inflow', amount: 40000, date: '2027-01', description: 'Targeted inflow' }],
        }),
        makeFund({ id: 'b', subcategory: 'equities' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'a', value: 100000 }),
        makeSnapshot({ fundId: 'b', value: 100000 }),
      ];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Year 0 (2026): both at £100k → total £200k
      expect(result.projections[0].accessible).toBe(200000);
      // Year 1 (2027): only fund A gets +£40k → total £240k (NOT £220k that a 50/50 split would give)
      expect(result.projections[1].accessible).toBe(240000);
    });
  });

  describe('custom life expectancy', () => {
    it('projects to custom life expectancy instead of 100', () => {
      const funds = [makeFund()];
      const snapshots = [makeSnapshot()];
      const config = makeConfig({ lifeExpectancy: 90 });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].age).toBe(36);
      expect(result.projections[result.projections.length - 1].age).toBe(90);
      expect(result.projections).toHaveLength(55);
    });

    it('projects to 100 when lifeExpectancy is not set', () => {
      const funds = [makeFund()];
      const snapshots = [makeSnapshot()];
      const config = makeConfig();
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[result.projections.length - 1].age).toBe(100);
    });
  });

  describe('real terms (inflation-adjusted)', () => {
    it('includes realTotal when showRealTerms is true', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        inflationRate: 3,
        growthRates: { equities: 7, bonds: 0, cash: 0, property: 0 },
        showRealTerms: true,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].realTotal).toBe(result.projections[0].total);

      const p10 = result.projections[10];
      const inflationMultiplier = Math.pow(1.03, 10);
      expect(Math.abs(p10.realTotal! - Math.round(p10.total / inflationMultiplier))).toBeLessThanOrEqual(1);
    });

    it('does not include realTotal when showRealTerms is false', () => {
      const funds = [makeFund()];
      const snapshots = [makeSnapshot()];
      const config = makeConfig({ showRealTerms: false });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].realTotal).toBeUndefined();
    });

    it('does not include realTotal when showRealTerms is not set', () => {
      const funds = [makeFund()];
      const snapshots = [makeSnapshot()];
      const config = makeConfig();
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].realTotal).toBeUndefined();
    });
  });

  describe('per-wrapper buckets', () => {
    it('categorizes funds by wrapper field when present', () => {
      const funds = [
        makeFund({ id: 'isa1', category: 'savings', subcategory: 'equities', wrapper: 'isa' }),
        makeFund({ id: 'sipp1', category: 'pension', subcategory: 'equities', wrapper: 'sipp' }),
        makeFund({ id: 'gia1', category: 'savings', subcategory: 'bonds', wrapper: 'gia' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'isa1', value: 100000 }),
        makeSnapshot({ fundId: 'sipp1', value: 200000 }),
        makeSnapshot({ fundId: 'gia1', value: 50000 }),
      ];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);
      const first = result.projections[0];

      expect(first.isa).toBe(100000);
      expect(first.sipp).toBe(200000);
      expect(first.gia).toBe(50000);
      expect(first.accessible).toBe(150000);
      expect(first.locked).toBe(200000);
    });

    it('defaults pension funds without wrapper to sipp', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 80000 })];
      const config = makeConfig({ growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 } });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].sipp).toBe(80000);
      expect(result.projections[0].locked).toBe(80000);
    });

    it('defaults savings/property funds without wrapper to gia', () => {
      const funds = [
        makeFund({ id: 's', category: 'savings', subcategory: 'equities' }),
        makeFund({ id: 'p', category: 'property', subcategory: 'property' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 's', value: 60000 }),
        makeSnapshot({ fundId: 'p', value: 40000 }),
      ];
      const config = makeConfig({ growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 } });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].gia).toBe(100000);
      expect(result.projections[0].accessible).toBe(100000);
    });
  });

  describe('income tax calculation', () => {
    const taxConfig: TaxConfig = {
      personalAllowance: 12570,
      basicRateThreshold: 50270,
      higherRateThreshold: 125140,
      basicRate: 20,
      higherRate: 40,
      additionalRate: 45,
      cgtAnnualExempt: 3000,
      cgtBasicRate: 10,
      cgtHigherRate: 20,
    };

    it('returns 0 for income within personal allowance', () => {
      expect(calculateIncomeTax(12570, taxConfig)).toBe(0);
      expect(calculateIncomeTax(10000, taxConfig)).toBe(0);
    });

    it('calculates basic rate tax correctly', () => {
      // 20000 income: (20000 - 12570) * 0.2 = 1486
      const tax = calculateIncomeTax(20000, taxConfig);
      expect(tax).toBe(7430 * 0.2);
    });

    it('calculates higher rate tax correctly', () => {
      // 60000 income: basic = (50270 - 12570) * 0.2 = 7540, higher = (60000 - 50270) * 0.4 = 3892
      const tax = calculateIncomeTax(60000, taxConfig);
      expect(tax).toBe(7540 + 3892);
    });

    it('calculates additional rate tax correctly', () => {
      // 150000 income: PA tapered to 0 (income > 125140)
      // basic = 50270 * 0.2 = 10054, higher = (125140 - 50270) * 0.4 = 29948, additional = (150000 - 125140) * 0.45 = 11187
      const tax = calculateIncomeTax(150000, taxConfig);
      expect(tax).toBe(10054 + 29948 + 11187);
    });

    it('tapers personal allowance above £100k', () => {
      // At 110000: PA reduced by (110000 - 100000) / 2 = 5000, effective PA = 7570
      const tax = calculateIncomeTax(110000, taxConfig);
      const effectivePA = 12570 - 5000;
      const basic = (50270 - effectivePA) * 0.2;
      const higher = (110000 - 50270) * 0.4;
      expect(tax).toBe(basic + higher);
    });

    it('returns 0 for zero or negative income', () => {
      expect(calculateIncomeTax(0, taxConfig)).toBe(0);
      expect(calculateIncomeTax(-1000, taxConfig)).toBe(0);
    });
  });

  describe('capital gains tax calculation', () => {
    const taxConfig: TaxConfig = {
      personalAllowance: 12570,
      basicRateThreshold: 50270,
      higherRateThreshold: 125140,
      basicRate: 20,
      higherRate: 40,
      additionalRate: 45,
      cgtAnnualExempt: 3000,
      cgtBasicRate: 10,
      cgtHigherRate: 20,
    };

    it('returns 0 when gains are within annual exempt amount', () => {
      expect(calculateCGT(6000, taxConfig)).toBe(0); // gains = 3000, exempt = 3000
    });

    it('returns 0 for zero withdrawal', () => {
      expect(calculateCGT(0, taxConfig)).toBe(0);
    });

    it('calculates CGT at basic rate when basic band available', () => {
      // withdrawal 10000, gains = 5000, taxable = 2000, all at basic rate (10%) = 200
      expect(calculateCGT(10000, taxConfig)).toBe(200);
    });

    it('calculates CGT at higher rate when basic band used by other income', () => {
      // withdrawal 10000, gains = 5000, taxable = 2000, other income uses full basic band
      expect(calculateCGT(10000, taxConfig, 60000)).toBe(400); // all at 20%
    });
  });

  describe('drawdown ordering', () => {
    it('draws from GIA first by default, then ISA, then SIPP', () => {
      const funds = [
        makeFund({ id: 'isa1', category: 'savings', subcategory: 'equities', wrapper: 'isa' }),
        makeFund({ id: 'gia1', category: 'savings', subcategory: 'equities', wrapper: 'gia' }),
        makeFund({ id: 'sipp1', category: 'pension', subcategory: 'equities', wrapper: 'sipp' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'isa1', value: 500000 }),
        makeSnapshot({ fundId: 'gia1', value: 500000 }),
        makeSnapshot({ fundId: 'sipp1', value: 500000 }),
      ];
      const config = makeConfig({
        dateOfBirth: '1958-01-01',
        pensionAccessAge: 57,
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const p1 = result.projections[1];
      expect(p1.gia!).toBeLessThan(500000);
      expect(p1.isa!).toBe(500000);
    });

    it('respects custom drawdown order', () => {
      const funds = [
        makeFund({ id: 'isa1', category: 'savings', subcategory: 'equities', wrapper: 'isa' }),
        makeFund({ id: 'gia1', category: 'savings', subcategory: 'equities', wrapper: 'gia' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'isa1', value: 500000 }),
        makeSnapshot({ fundId: 'gia1', value: 500000 }),
      ];
      const config = makeConfig({
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        drawdownOrder: ['isa', 'gia', 'sipp', 'none'],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const p1 = result.projections[1];
      expect(p1.isa!).toBe(470000);
      expect(p1.gia!).toBe(500000);
    });
  });

  describe('defined benefit pensions', () => {
    it('provides income from defined benefit pension at specified age', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        definedBenefitPensions: [
          { name: 'Teacher Pension', annualAmount: 20000, startAge: 60 },
        ],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const age50 = result.projections.find(p => p.age === 50)!;
      expect(age50.definedBenefitIncome).toBe(0);

      const age60 = result.projections.find(p => p.age === 60)!;
      expect(age60.definedBenefitIncome).toBe(20000);

      const age65 = result.projections.find(p => p.age === 65)!;
      expect(age65.definedBenefitIncome).toBe(20000);
    });

    it('sums multiple defined benefit pensions', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        definedBenefitPensions: [
          { name: 'DB1', annualAmount: 10000, startAge: 60 },
          { name: 'DB2', annualAmount: 15000, startAge: 65 },
        ],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const age62 = result.projections.find(p => p.age === 62)!;
      expect(age62.definedBenefitIncome).toBe(10000);

      const age67 = result.projections.find(p => p.age === 67)!;
      expect(age67.definedBenefitIncome).toBe(25000);
    });

    it('reduces drawdown amount when DB pension covers part of spend', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 1000000 })];
      const config = makeConfig({
        dateOfBirth: '1966-01-01',
        pensionAccessAge: 57,
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 68,
        withdrawalRates: [4],
        definedBenefitPensions: [
          { name: 'DB Pension', annualAmount: 10000, startAge: 60 },
        ],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const p0 = result.projections[0];
      const p1 = result.projections[1];
      const decrease = p0.accessible - p1.accessible;
      expect(decrease).toBeGreaterThanOrEqual(20000);
      expect(decrease).toBeLessThan(30000);
    });

    it('taxes guaranteed income once it exceeds the personal allowance', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 1000000 })];
      const config = makeConfig({
        dateOfBirth: '1966-01-01', // age 60
        pensionAccessAge: 57,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        definedBenefitPensions: [
          { name: 'Teacher Pension', annualAmount: 30000, startAge: 60 },
        ],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Default tax config: personalAllowance 12570, basicRate 20%.
      // (30000 - 12570) * 0.20 = 3486
      const age60 = result.projections.find(p => p.age === 60)!;
      expect(age60.guaranteedIncomeTax).toBe(3486);
    });

    it('does not tax guaranteed income within the personal allowance', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        dateOfBirth: '1966-01-01', // age 60
        pensionAccessAge: 57,
        statePensionAmount: 0,
        statePensionAge: 99,
        definedBenefitPensions: [
          { name: 'Small DB', annualAmount: 10000, startAge: 60 },
        ],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // 10,000 is entirely within the £12,570 personal allowance.
      const age60 = result.projections.find(p => p.age === 60)!;
      expect(age60.guaranteedIncomeTax).toBe(0);
    });

    it('grosses up drawdown by the tax on guaranteed income', () => {
      const funds = [makeFund({ subcategory: 'equities', wrapper: 'isa' })];
      const snapshots = [makeSnapshot({ value: 1000000 })];
      const config = makeConfig({
        dateOfBirth: '1966-01-01', // age 60
        pensionAccessAge: 57,
        targetAnnualSpend: 40000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        definedBenefitPensions: [
          { name: 'Teacher Pension', annualAmount: 30000, startAge: 60 },
        ],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // guaranteedIncomeTax = (30000 - 12570) * 0.20 = 3486
      // netSpend = 40000 - (30000 - 3486) = 13486 (pre-fix this was 10000)
      // ISA withdrawal is tax-free, so accessible falls by exactly netSpend.
      const p0 = result.projections[0];
      const p1 = result.projections[1];
      expect(p0.guaranteedIncomeTax).toBe(3486);
      expect(p0.accessible - p1.accessible).toBe(13486);
    });

    it('does not double-count guaranteed income tax in the FIRE date pot requirement', () => {
      const funds = [makeFund({ subcategory: 'equities', wrapper: 'isa' })];
      const snapshots = [makeSnapshot({ value: 350000 })];
      const config = makeConfig({
        dateOfBirth: '1966-01-01', // age 60
        pensionAccessAge: 57,
        targetAnnualSpend: 40000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        definedBenefitPensions: [
          { name: 'Teacher Pension', annualAmount: 30000, startAge: 60 },
        ],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // netSpend = 13486 (see above); ISA drawdown is tax-free so the pot's
      // requirement at 4% is 13486 / 0.04 = 337,150. Double-counting the
      // £3,486 guaranteed-income tax would demand 424,300 and defer FIRE.
      expect(result.fireDates[0].age).toBe(60);
      expect(result.fireDates[0].grossAnnualSpend).toBe(13486);
    });
  });

  describe('teachers pension', () => {
    it('provides CARE income from claim age, nominal-converted and taxed', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 50000 })];
      const config = makeConfig({
        dateOfBirth: '1990-01-01', // currentAge = 2026 - 1990 = 36
        inflationRate: 2.5,
        statePensionAmount: 0,
        statePensionAge: 99,
        teachersPension: {
          enabled: true,
          statementDate: '2026-01',
          careerAverage: { accruedAnnualPension: 10000, normalPensionAge: 68 },
          stillInService: false,
          claimAge: 68,
        },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const age67 = result.projections.find(p => p.age === 67)!;
      expect(age67.definedBenefitIncome).toBe(0);

      // Deferred CARE, claiming exactly at its NPA (68): no ER8 reduction, so
      // the real £10,000 passes straight through, converted to nominal at the
      // claim year: 10000 x 1.025^(68-36) = 10000 x 1.025^32 ~= 22,037.57.
      const age68 = result.projections.find(p => p.age === 68)!;
      const expectedNominal = Math.round(10000 * Math.pow(1.025, 68 - 36));
      expect(age68.definedBenefitIncome).toBe(expectedNominal);

      // ~£22,038 comfortably exceeds the £12,570 personal allowance.
      expect(age68.guaranteedIncomeTax).toBeGreaterThan(0);
    });

    it('adds an NPA60 automatic lump sum to accessible assets in the claim year', () => {
      const funds = [makeFund({ subcategory: 'cash' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        dateOfBirth: '1990-01-01', // currentAge = 36
        targetAnnualSpend: 0, // isolate the lump-sum jump from drawdown noise
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        teachersPension: {
          enabled: true,
          statementDate: '2026-01',
          finalSalary: { section: 'npa60', accruedAnnualPension: 8000, automaticLumpSum: 24000 },
          stillInService: false,
          claimAge: 60,
        },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // NPA60 claimed exactly at 60: no reduction (factor 1.0), 0% inflation
      // so nominal = real = £24,000. With 0% growth and 0 spend the main fund
      // is flat, so the whole jump is the synthetic lump-sum fund landing.
      const age59 = result.projections.find(p => p.age === 59)!;
      const age60 = result.projections.find(p => p.age === 60)!;
      expect(age60.accessible - age59.accessible).toBe(24000);
    });

    it('brings FIRE age forward (or leaves it unchanged) versus TPS disabled', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 400000 })];
      const shared: Partial<FireConfig> = {
        dateOfBirth: '1990-01-01', // currentAge = 36
        targetAnnualSpend: 30000,
        growthRates: { equities: 5, bonds: 5, cash: 5, property: 5 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
      };

      const withoutTps = makeConfig(shared);
      const withTps = makeConfig({
        ...shared,
        teachersPension: {
          enabled: true,
          statementDate: '2026-01',
          careerAverage: { accruedAnnualPension: 15000, normalPensionAge: 68 },
          stillInService: false,
          claimAge: 45,
        },
      });

      const resultWithout = calculateFireProjections(funds, snapshots, withoutTps);
      const resultWith = calculateFireProjections(funds, snapshots, withTps);

      const ageWithout = resultWithout.fireDates[0].age;
      const ageWith = resultWith.fireDates[0].age;
      expect(ageWithout).not.toBeNull();
      expect(ageWith).not.toBeNull();
      expect(ageWith as number).toBeLessThanOrEqual(ageWithout as number);
    });

    it('McCloud finalSalary vs careerAverage choice produce different DB income at claim age', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 50000 })];
      const baseTps: TeachersPensionConfig = {
        enabled: true,
        statementDate: '2026-01',
        finalSalary: { section: 'npa60', accruedAnnualPension: 0 },
        careerAverage: { accruedAnnualPension: 0, normalPensionAge: 68 },
        mcCloud: {
          finalSalaryAnnualPension: 3500,
          finalSalaryLumpSum: 10500,
          careAnnualPension: 4200,
          choice: 'finalSalary',
        },
        stillInService: false,
        claimAge: 60,
      };
      const commonOverrides: Partial<FireConfig> = {
        dateOfBirth: '1990-01-01', // currentAge = 36
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
      };

      const configFs = makeConfig({ ...commonOverrides, teachersPension: baseTps });
      const configCare = makeConfig({
        ...commonOverrides,
        teachersPension: { ...baseTps, mcCloud: { ...baseTps.mcCloud!, choice: 'careerAverage' } },
      });

      const resultFs = calculateFireProjections(funds, snapshots, configFs);
      const resultCare = calculateFireProjections(funds, snapshots, configCare);

      const age60Fs = resultFs.projections.find(p => p.age === 60)!;
      const age60Care = resultCare.projections.find(p => p.age === 60)!;

      expect(age60Fs.definedBenefitIncome).not.toBe(age60Care.definedBenefitIncome);

      // Final salary (NPA60), claimed exactly at 60: unreduced -> £3,500.
      expect(age60Fs.definedBenefitIncome).toBe(3500);
      // Career average, deferred, NPA 68 claimed at 60 (8 years early):
      // ER8(8) interpolates between 7->0.716 and 10->0.632:
      // 0.716 + (8-7)/(10-7) * (0.632-0.716) = 0.716 - 0.028 = 0.688
      // 4200 x 0.688 = 2,889.6 -> rounds to 2,890.
      expect(age60Care.definedBenefitIncome).toBe(2890);
    });

    it('disabled teachersPension leaves projections identical to no field at all', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 200000 })];
      const configA = makeConfig({ dateOfBirth: '1990-01-01' });
      const configB = makeConfig({
        dateOfBirth: '1990-01-01',
        teachersPension: {
          enabled: false,
          statementDate: '2026-01',
          careerAverage: { accruedAnnualPension: 10000, normalPensionAge: 68 },
          stillInService: false,
          claimAge: 60,
        },
      });

      const resultA = calculateFireProjections(funds, snapshots, configA);
      const resultB = calculateFireProjections(funds, snapshots, configB);

      expect(resultB.projections.slice(0, 10)).toEqual(resultA.projections.slice(0, 10));
      expect(resultB.fireDates).toEqual(resultA.fireDates);
    });
  });

  describe('pension 25% tax-free lump sum (per-fund)', () => {
    it('takes 25% tax-free lump sum from SIPP fund at its drawdown age when take25PctLumpSum is true', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities', take25PctLumpSum: true })];
      const snapshots = [makeSnapshot({ value: 400000 })];
      const config = makeConfig({
        pensionAccessAge: 40,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const age40 = result.projections.find(p => p.age === 40)!;
      expect(age40.sipp).toBe(300000);
      expect(age40.gia).toBe(100000);
      expect(age40.accessible).toBe(400000);
      expect(age40.locked).toBe(0);
    });

    it('does NOT take lump sum when take25PctLumpSum is false', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities', take25PctLumpSum: false })];
      const snapshots = [makeSnapshot({ value: 400000 })];
      const config = makeConfig({
        pensionAccessAge: 40,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const age40 = result.projections.find(p => p.age === 40)!;
      expect(age40.sipp).toBe(400000);
      expect(age40.gia).toBe(0);
    });

    it('does NOT take lump sum when take25PctLumpSum is undefined', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 400000 })];
      const config = makeConfig({
        pensionAccessAge: 40,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const age40 = result.projections.find(p => p.age === 40)!;
      expect(age40.sipp).toBe(400000);
      expect(age40.gia).toBe(0);
    });

    it('respects lump sum allowance cap', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities', take25PctLumpSum: true })];
      const snapshots = [makeSnapshot({ value: 200000000 })];
      const config = makeConfig({
        pensionAccessAge: 40,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        lumpSumAllowance: 26827500,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const age40 = result.projections.find(p => p.age === 40)!;
      expect(age40.gia).toBe(26827500);
      expect(age40.sipp).toBe(200000000 - 26827500);
    });

    it('respects cumulative lump sum allowance across multiple SIPP funds', () => {
      const funds = [
        makeFund({ id: 'sipp1', category: 'pension', subcategory: 'equities', take25PctLumpSum: true, drawdownAge: 57 }),
        makeFund({ id: 'sipp2', category: 'pension', subcategory: 'bonds', take25PctLumpSum: true, drawdownAge: 60 }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'sipp1', value: 800000 }),
        makeSnapshot({ fundId: 'sipp2', value: 800000 }),
      ];
      const config = makeConfig({
        pensionAccessAge: 57,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        lumpSumAllowance: 268275,
        // High spend so FIRE is never reached — isolates lump sum logic from drawdown
        targetAnnualSpend: 10000000,
        statePensionAmount: 0,
        statePensionAge: 99,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // At age 57: sipp1 takes min(800000 * 0.25, 268275) = 200000
      const age57 = result.projections.find(p => p.age === 57)!;
      expect(age57.gia).toBe(200000);

      // At age 60: sipp2 takes min(800000 * 0.25, 268275 - 200000) = 68275
      const age60 = result.projections.find(p => p.age === 60)!;
      expect(age60.gia).toBe(268275); // cumulative total = allowance
    });

    it('takes lump sum at per-fund drawdown age, not global pensionAccessAge', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities', take25PctLumpSum: true, drawdownAge: 60 })];
      const snapshots = [makeSnapshot({ value: 400000 })];
      const config = makeConfig({
        pensionAccessAge: 57,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // At age 57: no lump sum (fund's drawdownAge is 60)
      const age57 = result.projections.find(p => p.age === 57)!;
      expect(age57.sipp).toBe(400000);
      expect(age57.gia).toBe(0);

      // At age 60: lump sum taken
      const age60 = result.projections.find(p => p.age === 60)!;
      expect(age60.sipp).toBe(300000);
      expect(age60.gia).toBe(100000);
    });

    it('drawdown from the lump-sum GIA incurs CGT', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities', take25PctLumpSum: true })];
      const snapshots = [makeSnapshot({ value: 400000 })];
      const config = makeConfig({
        pensionAccessAge: 40,
        targetRetirementAge: 40,
        targetAnnualSpend: 20000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        statePensionAmount: 0,
        statePensionAge: 99,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // £20k net from the £100k lump-sum GIA: gains 10k − 3k exempt = 7k @ 10%
      const age40 = result.projections.find(p => p.age === 40)!;
      expect(age40.drawdownGia).toBe(20000);
      expect(age40.taxPaid).toBe(700);
    });
  });

  describe('tax on drawdown', () => {
    it('ISA withdrawals are tax-free', () => {
      const funds = [makeFund({ category: 'savings', subcategory: 'equities', wrapper: 'isa' })];
      const snapshots = [makeSnapshot({ value: 1000000 })];
      const config = makeConfig({
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        drawdownOrder: ['isa', 'gia', 'sipp', 'none'],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].taxPaid).toBe(0);
      expect(result.projections[1].accessible).toBe(970000);
    });

    it('SIPP withdrawals incur income tax', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities', wrapper: 'sipp' })];
      const snapshots = [makeSnapshot({ value: 100000000 })];
      const config = makeConfig({
        dateOfBirth: '1958-01-01',
        pensionAccessAge: 57,
        // Force drawdown from the current age: the tax-aware FIRE criterion
        // (correctly) never fires here, since the pot can't cover the
        // grossed-up spend at a 4% withdrawal rate.
        targetRetirementAge: 68,
        targetAnnualSpend: 3000000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        drawdownOrder: ['sipp', 'gia', 'isa', 'none'],
        lumpSumAllowance: 0,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].taxPaid).toBeGreaterThan(0);
    });

    it('GIA withdrawals incur CGT', () => {
      const funds = [makeFund({ category: 'savings', subcategory: 'equities', wrapper: 'gia' })];
      const snapshots = [makeSnapshot({ value: 100000000 })];
      const config = makeConfig({
        targetAnnualSpend: 3000000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        drawdownOrder: ['gia', 'isa', 'sipp', 'none'],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].taxPaid).toBeGreaterThan(0);
    });

    it('reports taxPaid as 0 when no drawdown occurs', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 1000 })];
      const config = makeConfig({
        targetAnnualSpend: 3000000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        withdrawalRates: [4],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].taxPaid).toBe(0);
    });
  });

  describe('drawdown income tracking', () => {
    it('populates drawdownIncome when FIRE\'d and drawing down', () => {
      const funds = [makeFund({ category: 'savings', subcategory: 'equities', wrapper: 'isa' })];
      const snapshots = [makeSnapshot({ value: 1000000 })];
      const config = makeConfig({
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        drawdownOrder: ['isa', 'gia', 'sipp', 'none'],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // With 1M ISA, 30k spend, 4% withdrawal rate: FIRE'd immediately
      // drawdownIncome should equal the spend (30k) since no guaranteed income
      expect(result.projections[0].drawdownIncome).toBe(30000);
    });

    it('drawdownIncome is 0 pre-FIRE when pot is insufficient', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 1000 })];
      const config = makeConfig({
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.projections[0].drawdownIncome).toBe(0);
    });

    it('tracks guaranteedIncome correctly', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig({
        statePensionAmount: 11000,
        statePensionAge: 68,
        definedBenefitPensions: [
          { name: 'DB1', annualAmount: 5000, startAge: 60 },
        ],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      // Before age 60: no guaranteed income
      const age50 = result.projections.find(p => p.age === 50)!;
      expect(age50.guaranteedIncome).toBe(0);

      // Age 60-67: DB pension only
      const age62 = result.projections.find(p => p.age === 62)!;
      expect(age62.guaranteedIncome).toBe(5000);

      // Age 68+: state pension + DB
      const age70 = result.projections.find(p => p.age === 70)!;
      expect(age70.guaranteedIncome).toBe(16000);
    });
  });

  describe('target retirement age analysis', () => {
    it('returns targetAnalysis.isFeasible = true when pot exceeds required', () => {
      const funds = [makeFund({ category: 'savings', subcategory: 'equities', wrapper: 'isa' })];
      // £2M with 0% growth and £30k/yr spend lasts 66 years (age 40→106, past life expectancy 100)
      const snapshots = [makeSnapshot({ value: 2000000 })];
      const config = makeConfig({
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        targetRetirementAge: 40,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.targetAnalysis).toBeDefined();
      expect(result.targetAnalysis!.targetAge).toBe(40);
      expect(result.targetAnalysis!.isFeasible).toBe(true);
      expect(result.targetAnalysis!.shortfallPerYear).toBe(0);
    });

    it('returns targetAnalysis.isFeasible = false with shortfall calculated', () => {
      const funds = [makeFund({ category: 'savings', subcategory: 'equities', wrapper: 'isa' })];
      const snapshots = [makeSnapshot({ value: 10000 })];
      const config = makeConfig({
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        targetRetirementAge: 40,
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.targetAnalysis).toBeDefined();
      expect(result.targetAnalysis!.isFeasible).toBe(false);
      expect(result.targetAnalysis!.shortfallPerYear).toBeGreaterThan(0);
      expect(result.targetAnalysis!.requiredPot).toBe(750000); // 30000 / 0.04
      expect(result.targetAnalysis!.projectedPot).toBe(10000);
    });

    it('targetAnalysis is undefined when targetRetirementAge not set', () => {
      const funds = [makeFund({ subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const config = makeConfig();
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.targetAnalysis).toBeUndefined();
    });
  });

  describe('findSubYearFireFraction', () => {
    const makeRow = (overrides: Partial<FireProjection>): FireProjection => ({
      age: 40,
      year: 2030,
      accessible: 0,
      locked: 0,
      total: 0,
      annualSpend: 30000,
      statePension: 0,
      definedBenefitIncome: 0,
      ...overrides,
    });

    it('returns fraction=0 when prevRow already satisfies FIRE', () => {
      const prevRow = makeRow({ age: 49, accessible: 2_000_000, total: 2_000_000 });
      const fireRow = makeRow({ age: 50, accessible: 2_100_000, total: 2_100_000 });
      const result = findSubYearFireFraction({
        prevRow,
        fireRow,
        withdrawalRate: 4,
        pensionAccessAge: 57,
        inflationRate: 0,
        weightedAccessibleGrowthRate: 0.05,
      });
      expect(result.fraction).toBe(0);
    });

    it('returns a sub-year fraction for bridge-check-bound scenarios', () => {
      // Raw pot threshold met at both rows, but accessible-only bridge doesn't
      // survive until fireRow. Previously Dashboard would have collapsed this
      // to fractionalYears = fireIndex (whole integer) and hidden all sub-year
      // precision — this test locks in that we recover it.
      const prevRow = makeRow({ age: 49, accessible: 140_000, total: 800_000, annualSpend: 30000 });
      const fireRow = makeRow({ age: 50, accessible: 250_000, total: 900_000, annualSpend: 30000 });
      const result = findSubYearFireFraction({
        prevRow,
        fireRow,
        withdrawalRate: 4,
        pensionAccessAge: 57,
        inflationRate: 0,
        weightedAccessibleGrowthRate: 0.05,
      });
      expect(result.fraction).toBeGreaterThan(0);
      expect(result.fraction).toBeLessThan(1);
      expect(result.bindingConstraint).toBe('bridge-check');
    });

    it('moves the fraction earlier when accessible funds grow', () => {
      const base = {
        withdrawalRate: 4,
        pensionAccessAge: 57,
        inflationRate: 0,
        weightedAccessibleGrowthRate: 0.05,
      };
      const prevRowSmall = makeRow({ age: 49, accessible: 140_000, total: 800_000 });
      const fireRowSmall = makeRow({ age: 50, accessible: 250_000, total: 900_000 });
      const resultSmall = findSubYearFireFraction({ prevRow: prevRowSmall, fireRow: fireRowSmall, ...base });

      // Add 20k to accessible at both rows — simulating an extra ISA contribution
      const prevRowLarger = makeRow({ age: 49, accessible: 160_000, total: 820_000 });
      const fireRowLarger = makeRow({ age: 50, accessible: 270_000, total: 920_000 });
      const resultLarger = findSubYearFireFraction({ prevRow: prevRowLarger, fireRow: fireRowLarger, ...base });

      expect(resultLarger.fraction).toBeLessThan(resultSmall.fraction);
    });

    it('reports pot-threshold when total is below required at prevRow', () => {
      const prevRow = makeRow({ age: 49, accessible: 500_000, total: 500_000, annualSpend: 30000 });
      const fireRow = makeRow({ age: 50, accessible: 900_000, total: 900_000, annualSpend: 30000 });
      const result = findSubYearFireFraction({
        prevRow,
        fireRow,
        withdrawalRate: 4,
        pensionAccessAge: 40, // already past pension access — no bridge needed
        inflationRate: 0,
        weightedAccessibleGrowthRate: 0.05,
      });
      expect(result.bindingConstraint).toBe('pot-threshold');
      expect(result.fraction).toBeGreaterThan(0);
    });
  });

  describe('tax-aware FIRE dates', () => {
    const sippConfig = (overrides: Partial<FireConfig> = {}) =>
      makeConfig({
        dateOfBirth: '1966-01-01', // age 60, past pension access
        pensionAccessAge: 57,
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        ...overrides,
      });

    it('requires the pot to cover the grossed-up (tax-inclusive) spend for SIPP drawdown', () => {
      const funds = [makeFund({ category: 'pension', subcategory: 'equities', wrapper: 'sipp' })];

      // Net £30k from a SIPP needs £34,357.50 gross (20% tax above the
      // £12,570 personal allowance), so the 4% rule needs £858,937.50 —
      // not the £750,000 a net-spend check would demand.
      const tooSmall = calculateFireProjections(funds, [makeSnapshot({ value: 800000 })], sippConfig());
      expect(tooSmall.fireDates[0].age).toBeNull();

      const bigEnough = calculateFireProjections(funds, [makeSnapshot({ value: 900000 })], sippConfig());
      expect(bigEnough.fireDates[0].age).toBe(60);
      expect(bigEnough.fireDates[0].grossAnnualSpend).toBe(34357); // 34357.5 less solver convergence
    });

    it('fails the bridge when tax pushes cumulative withdrawals past accessible funds', () => {
      // Age 50, 7 bridge years to SIPP access at 57. Net spend £30k costs
      // £31,200 gross from a GIA (CGT: 50% gains, £3k exempt, 10% basic).
      // £214k of GIA covers 7 net years (£210k) but not 7 gross years
      // (£218.4k), so tax-aware FIRE slips one year to 51.
      const funds = [
        makeFund({ id: 'gia', category: 'savings', subcategory: 'equities', wrapper: 'gia' }),
        makeFund({ id: 'sipp', category: 'pension', subcategory: 'equities', wrapper: 'sipp' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'gia', value: 214000 }),
        makeSnapshot({ fundId: 'sipp', value: 2000000 }),
      ];
      const config = sippConfig({ dateOfBirth: '1976-01-01' }); // age 50
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.fireDates[0].age).toBe(51);
    });

    it('grossUpFactor moves the sub-year FIRE fraction later', () => {
      const row = (age: number, accessible: number): FireProjection => ({
        age,
        year: 2026 + (age - 60),
        accessible,
        locked: 0,
        total: accessible,
        annualSpend: 30000,
        statePension: 0,
        contributions: 0,
      });
      const base = {
        prevRow: row(60, 700000),
        fireRow: row(61, 800000),
        withdrawalRate: 4,
        pensionAccessAge: 57, // past access: no bridge, pure threshold
        inflationRate: 0,
        weightedAccessibleGrowthRate: 0,
      };

      // Net threshold £750k is crossed halfway through the year…
      const untaxed = findSubYearFireFraction(base);
      expect(untaxed.fraction).toBeCloseTo(0.5, 3);

      // …but a 5% tax gross-up needs £787.5k, reached at 0.875.
      const taxed = findSubYearFireFraction({ ...base, grossUpFactor: 1.05 });
      expect(taxed.fraction).toBeCloseTo(0.875, 3);
    });
  });

  describe('coast FIRE', () => {
    const coastConfig = (overrides: Partial<FireConfig> = {}) =>
      makeConfig({
        // age 36; coast target defaults to pensionAccessAge 57
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        ...overrides,
      });

    it('reports alreadyCoasting when the pot needs no further contributions', () => {
      const funds = [makeFund({ wrapper: 'isa', subcategory: 'equities' })];
      const result = calculateFireProjections(funds, [makeSnapshot({ value: 800000 })], coastConfig());

      expect(result.coastFire).toEqual({ coastAge: 36, targetAge: 57, alreadyCoasting: true });
    });

    it('finds the earliest age contributions can stop', () => {
      // £600k ISA + £12k/yr contributions, £750k needed at 57 (zero growth):
      // 13 years of contributions (ages 36-48) reach £756k, 12 fall short.
      const funds = [makeFund({ wrapper: 'isa', subcategory: 'equities', monthlyContribution: 1000 })];
      const result = calculateFireProjections(funds, [makeSnapshot({ value: 600000 })], coastConfig());

      expect(result.coastFire).toEqual({ coastAge: 49, targetAge: 57, alreadyCoasting: false });
    });

    it('returns null coastAge when coasting is unreachable', () => {
      const funds = [makeFund({ wrapper: 'isa', subcategory: 'equities' })];
      const result = calculateFireProjections(funds, [makeSnapshot({ value: 1000 })], coastConfig());

      expect(result.coastFire).toEqual({ coastAge: null, targetAge: 57, alreadyCoasting: false });
    });

    it('tolerates a fractional targetRetirementAge', () => {
      const funds = [makeFund({ wrapper: 'isa', subcategory: 'equities' })];
      const result = calculateFireProjections(
        funds,
        [makeSnapshot({ value: 800000 })],
        coastConfig({ targetRetirementAge: 48.1 })
      );

      expect(result.coastFire?.targetAge).toBe(48);
      expect(result.coastFire?.alreadyCoasting).toBe(true);
    });

    it('honours coastTargetAge and skipCoast', () => {
      const funds = [makeFund({ wrapper: 'isa', subcategory: 'equities' })];
      const snapshots = [makeSnapshot({ value: 800000 })];

      const custom = calculateFireProjections(funds, snapshots, coastConfig({ coastTargetAge: 50 }));
      expect(custom.coastFire?.targetAge).toBe(50);

      const skipped = calculateFireProjections(funds, snapshots, coastConfig(), { skipCoast: true });
      expect(skipped.coastFire).toBeUndefined();
    });
  });

  describe('accessibleGrowthRateFromRow', () => {
    const growthRates = { equities: 7, bonds: 3, cash: 1, property: 4 };

    it('weights growth by the row accessible mix', () => {
      const row = {
        age: 50, year: 2040, accessible: 100000, locked: 0, total: 100000,
        annualSpend: 30000, statePension: 0, contributions: 0,
        accessibleBreakdown: { equities: 75000, bonds: 0, cash: 25000, property: 0 },
      } as FireProjection;
      // 75% at 7% + 25% at 1% = 5.5%
      expect(accessibleGrowthRateFromRow(row, growthRates)).toBeCloseTo(0.055, 6);
    });

    it('returns 0 with no breakdown or empty balances', () => {
      const bare = {
        age: 50, year: 2040, accessible: 0, locked: 0, total: 0,
        annualSpend: 30000, statePension: 0, contributions: 0,
      } as FireProjection;
      expect(accessibleGrowthRateFromRow(bare, growthRates)).toBe(0);
      expect(accessibleGrowthRateFromRow({
        ...bare,
        accessibleBreakdown: { equities: 0, bonds: 0, cash: 0, property: 0 },
      }, growthRates)).toBe(0);
    });
  });

  describe('earliestFireAge', () => {
    it('returns the earliest age across withdrawal rates', () => {
      expect(earliestFireAge([
        { withdrawalRate: 3, age: 58, year: 2048 },
        { withdrawalRate: 3.5, age: 55, year: 2045 },
        { withdrawalRate: 4, age: 52, year: 2042 },
      ])).toBe(52);
    });

    it('skips unachievable rates and returns null when none are achievable', () => {
      expect(earliestFireAge([
        { withdrawalRate: 3, age: null, year: null },
        { withdrawalRate: 4, age: 60, year: 2050 },
      ])).toBe(60);
      expect(earliestFireAge([{ withdrawalRate: 3, age: null, year: null }])).toBeNull();
      expect(earliestFireAge([])).toBeNull();
    });
  });

  describe('cash savings wrapper', () => {
    const noDrawdownConfig = () => makeConfig({
      targetAnnualSpend: 3000000,
      statePensionAmount: 0,
      statePensionAge: 99,
    });

    it('is included and accessible from the current age', () => {
      const funds = [makeFund({ subcategory: 'cash', wrapper: 'cash_savings' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const result = calculateFireProjections(funds, snapshots, noDrawdownConfig());

      const first = result.projections[0];
      expect(first.accessible).toBe(100000);
      expect(first.locked).toBe(0);
      expect(first.cashSavings).toBe(100000);
      expect(first.gia).toBe(0);
    });

    it('respects an explicit drawdownAge', () => {
      const funds = [makeFund({ subcategory: 'cash', wrapper: 'cash_savings', drawdownAge: 40 })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const result = calculateFireProjections(funds, snapshots, noDrawdownConfig());

      expect(result.projections[0].locked).toBe(100000);
      expect(result.projections[0].accessible).toBe(0);
      const at40 = result.projections.find(p => p.age === 40)!;
      expect(at40.locked).toBe(0);
      expect(at40.accessible).toBe(at40.total);
    });

    it('grows at the cash growth rate', () => {
      const funds = [makeFund({ subcategory: 'cash', wrapper: 'cash_savings' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const result = calculateFireProjections(funds, snapshots, noDrawdownConfig());

      expect(result.projections[1].total).toBe(101000);
      expect(result.projections[1].cashSavings).toBe(101000);
    });

    it('withdrawals are tax-free, unlike the same fund held as a GIA', () => {
      const config = makeConfig({
        targetAnnualSpend: 3000000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
      });
      const snapshots = [makeSnapshot({ value: 100000000 })];
      const cash = calculateFireProjections([makeFund({ subcategory: 'cash', wrapper: 'cash_savings' })], snapshots, config);
      const gia = calculateFireProjections([makeFund({ subcategory: 'cash', wrapper: 'gia' })], snapshots, config);

      expect(cash.projections[0].drawdownIncome).toBe(3000000);
      expect(cash.projections[0].taxPaid).toBe(0);
      expect(cash.projections[0].grossWithdrawal).toBe(3000000);
      expect(cash.projections[1].accessible).toBe(97000000);
      expect(gia.projections[0].taxPaid).toBeGreaterThan(0);
      expect(gia.projections[1].accessible).toBeLessThan(97000000);
    });

    it('is drawn before GIA and ISA by default and reported in drawdownCashSavings', () => {
      const funds = [
        makeFund({ id: 'cash1', category: 'savings', subcategory: 'cash', wrapper: 'cash_savings' }),
        makeFund({ id: 'gia1', category: 'savings', subcategory: 'equities', wrapper: 'gia' }),
        makeFund({ id: 'isa1', category: 'savings', subcategory: 'equities', wrapper: 'isa' }),
      ];
      const snapshots = [
        makeSnapshot({ fundId: 'cash1', value: 500000 }),
        makeSnapshot({ fundId: 'gia1', value: 500000 }),
        makeSnapshot({ fundId: 'isa1', value: 500000 }),
      ];
      const config = makeConfig({
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      const p0 = result.projections[0];
      expect(p0.drawdownCashSavings).toBe(30000);
      expect(p0.drawdownGia).toBe(0);
      expect(p0.drawdownIsa).toBe(0);
      const p1 = result.projections[1];
      expect(p1.cashSavings).toBe(470000);
      expect(p1.gia).toBe(500000);
      expect(p1.isa).toBe(500000);
    });

    it('is drawn even when a stored drawdown order predates the wrapper', () => {
      const funds = [makeFund({ subcategory: 'cash', wrapper: 'cash_savings' })];
      const snapshots = [makeSnapshot({ value: 1000000 })];
      const config = makeConfig({
        targetAnnualSpend: 30000,
        growthRates: { equities: 0, bonds: 0, cash: 0, property: 0 },
        inflationRate: 0,
        statePensionAmount: 0,
        statePensionAge: 99,
        withdrawalRates: [4],
        drawdownOrder: ['gia', 'none', 'isa', 'lisa', 'sipp'],
      });
      const result = calculateFireProjections(funds, snapshots, config);

      expect(result.fireDates[0].age).toBe(36);
      expect(result.projections[0].drawdownCashSavings).toBe(30000);
      expect(result.projections[1].cashSavings).toBe(970000);
    });

    it("still excludes 'none' funds from the projection", () => {
      const funds = [makeFund({ subcategory: 'cash', wrapper: 'none' })];
      const snapshots = [makeSnapshot({ value: 100000 })];
      const result = calculateFireProjections(funds, snapshots, noDrawdownConfig());

      expect(result.projections[0].total).toBe(0);
      expect(result.projections[0].cashSavings).toBe(0);
    });
  });

  describe('normaliseDrawdownOrder', () => {
    it('returns the default order when undefined', () => {
      expect(normaliseDrawdownOrder(undefined)).toEqual(['cash_savings', 'gia', 'isa', 'lisa', 'sipp']);
      expect(normaliseDrawdownOrder()).toEqual(DEFAULT_DRAWDOWN_ORDER);
      expect(normaliseDrawdownOrder()).not.toBe(DEFAULT_DRAWDOWN_ORDER);
    });

    it("strips 'none' and prepends cash_savings to a legacy order", () => {
      expect(normaliseDrawdownOrder(['gia', 'none', 'isa', 'lisa', 'sipp'])).toEqual(['cash_savings', 'gia', 'isa', 'lisa', 'sipp']);
    });

    it("leaves an order containing cash_savings as-is apart from stripping 'none'", () => {
      expect(normaliseDrawdownOrder(['isa', 'cash_savings', 'gia', 'none', 'sipp'])).toEqual(['isa', 'cash_savings', 'gia', 'sipp']);
      expect(normaliseDrawdownOrder(['sipp', 'cash_savings'])).toEqual(['sipp', 'cash_savings']);
    });
  });
});
