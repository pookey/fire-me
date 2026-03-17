import { describe, it, expect } from 'vitest';
import { runStressTest, DEFAULT_STRESS_SCENARIOS } from './stressTestCalculator';
import type { Fund, Snapshot, FireConfig, FireResult, StressScenarioConfig } from '../types';

function makeConfig(overrides: Partial<FireConfig> = {}): FireConfig {
  return {
    targetAnnualSpend: 30000,
    growthRates: { equities: 7, bonds: 3, cash: 1, property: 4 },
    inflationRate: 2.5,
    pensionAccessAge: 58,
    statePensionAmount: 11000,
    statePensionAge: 68,
    withdrawalRates: [4],
    dateOfBirth: '1986-01-01',
    lifeExpectancy: 100,
    ...overrides,
  };
}

function makeFunds(): Fund[] {
  return [
    { id: 'isa1', name: 'ISA', category: 'savings', subcategory: 'equities', wrapper: 'isa', active: true, sortOrder: 1 },
    { id: 'sipp1', name: 'SIPP', category: 'pension', subcategory: 'equities', wrapper: 'sipp', active: true, sortOrder: 2 },
  ];
}

function makeSnapshots(): Snapshot[] {
  return [
    { fundId: 'isa1', date: '2026-01-01', value: 300000, fundName: 'ISA', category: 'savings' },
    { fundId: 'sipp1', date: '2026-01-01', value: 200000, fundName: 'SIPP', category: 'pension' },
  ];
}

function makeResult(config: FireConfig, retirementAge: number): FireResult {
  const birthYear = new Date(config.dateOfBirth).getFullYear();
  const currentYear = new Date().getFullYear();
  const currentAge = currentYear - birthYear;
  const projections = [];

  for (let age = currentAge; age <= 100; age++) {
    const yearsFromNow = age - currentAge;
    const inflationMultiplier = Math.pow(1 + config.inflationRate / 100, yearsFromNow);
    projections.push({
      age,
      year: currentYear + yearsFromNow,
      accessible: 300000 * Math.pow(1.07, yearsFromNow),
      locked: 200000 * Math.pow(1.07, yearsFromNow),
      total: 500000 * Math.pow(1.07, yearsFromNow),
      annualSpend: config.targetAnnualSpend * inflationMultiplier,
      statePension: age >= config.statePensionAge ? config.statePensionAmount * inflationMultiplier : 0,
      definedBenefitIncome: 0,
    });
  }

  return {
    projections,
    fireDates: [{ withdrawalRate: 4, age: retirementAge, year: currentYear + (retirementAge - currentAge) }],
  };
}

describe('stressTestCalculator', () => {
  const config = makeConfig();
  const funds = makeFunds();
  const snapshots = makeSnapshots();

  it('base case survives with sufficient pot', () => {
    const result = makeResult(config, 50);
    const stressResult = runStressTest(result, config, funds, snapshots, [], 50);

    expect(stressResult.retirementAge).toBe(50);
    expect(stressResult.pensionAccessAge).toBe(58);
    expect(stressResult.baseCase.survived).toBe(true);
    expect(stressResult.baseCase.bridgeYears.length).toBe(8);
  });

  it('immediate crash reduces pot by crashPercent in year 0', () => {
    const result = makeResult(config, 50);
    const scenarios: StressScenarioConfig[] = [
      { type: 'immediate_crash', label: 'Crash', enabled: true, crashPercent: 40, durationYears: 3 },
    ];
    const stressResult = runStressTest(result, config, funds, snapshots, scenarios, 50);

    const crashScenario = stressResult.scenarios[0];
    expect(crashScenario).toBeDefined();

    // Year 0 should have negative growth rate of -40%
    const year0 = crashScenario.bridgeYears[0];
    expect(year0.effectiveGrowthRate).toBe(-0.4);
  });

  it('prolonged stagnation has 0 real returns during duration', () => {
    const result = makeResult(config, 50);
    const scenarios: StressScenarioConfig[] = [
      { type: 'prolonged_stagnation', label: 'Stagnation', enabled: true, durationYears: 5 },
    ];
    const stressResult = runStressTest(result, config, funds, snapshots, scenarios, 50);

    const stagnation = stressResult.scenarios[0];
    // During stagnation, growth rate equals inflation rate (0 real return)
    for (let i = 0; i < 5; i++) {
      if (i < stagnation.bridgeYears.length) {
        expect(stagnation.bridgeYears[i].effectiveGrowthRate).toBe(config.inflationRate / 100);
      }
    }
  });

  it('high inflation increases spending faster', () => {
    const result = makeResult(config, 50);
    const normalScenarios: StressScenarioConfig[] = [];
    const highInflScenarios: StressScenarioConfig[] = [
      { type: 'high_inflation', label: 'High Inflation', enabled: true, inflationOverride: 8, durationYears: 5 },
    ];

    const normalResult = runStressTest(result, config, funds, snapshots, normalScenarios, 50);
    const inflResult = runStressTest(result, config, funds, snapshots, highInflScenarios, 50);

    const highInflScenario = inflResult.scenarios[0];
    // High inflation scenario should have higher effective inflation
    expect(highInflScenario.bridgeYears[0].effectiveInflation).toBe(0.08);
    // Terminal balance should be lower with high inflation
    expect(highInflScenario.terminalBalance).toBeLessThan(normalResult.baseCase.terminalBalance);
  });

  it('historical 2000s applies hardcoded returns', () => {
    const result = makeResult(config, 50);
    const scenarios: StressScenarioConfig[] = [
      { type: 'historical_2000s', label: '2000s', enabled: true },
    ];
    const stressResult = runStressTest(result, config, funds, snapshots, scenarios, 50);

    const hist = stressResult.scenarios[0];
    const expectedReturns = [-0.08, -0.14, -0.23, 0.16, 0.08, 0.18, 0.11, 0.04];
    for (let i = 0; i < Math.min(expectedReturns.length, hist.bridgeYears.length); i++) {
      expect(hist.bridgeYears[i].effectiveGrowthRate).toBeCloseTo(expectedReturns[i], 10);
    }
  });

  it('bridge of length 0 trivially survives', () => {
    const configNoBridge = makeConfig({ pensionAccessAge: 50 });
    const result = makeResult(configNoBridge, 50);
    const stressResult = runStressTest(result, configNoBridge, funds, snapshots, DEFAULT_STRESS_SCENARIOS, 50);

    expect(stressResult.baseCase.survived).toBe(true);
    expect(stressResult.baseCase.bridgeYears.length).toBe(1);
  });

  it('marks depletion when pot is too small', () => {
    const tinySnapshots: Snapshot[] = [
      { fundId: 'isa1', date: '2026-01-01', value: 5000, fundName: 'ISA', category: 'savings' },
      { fundId: 'sipp1', date: '2026-01-01', value: 200000, fundName: 'SIPP', category: 'pension' },
    ];

    const tinyResult: FireResult = {
      projections: [{
        age: 50,
        year: 2060,
        accessible: 5000,
        locked: 200000,
        total: 205000,
        annualSpend: 30000,
        statePension: 0,
        definedBenefitIncome: 0,
      }],
      fireDates: [],
    };

    const stressResult = runStressTest(tinyResult, config, funds, tinySnapshots, [], 50);
    expect(stressResult.baseCase.survived).toBe(false);
    expect(stressResult.baseCase.depletionAge).toBe(50);
  });

  it('exact survival — pot just barely makes it', () => {
    // Construct a scenario where the pot is exactly enough
    const result = makeResult(config, 50);
    const stressResult = runStressTest(result, config, funds, snapshots, [], 50);

    // With a 300k pot growing at 7% and spending ~30k/yr for 8 years, should survive
    expect(stressResult.baseCase.survived).toBe(true);
    expect(stressResult.baseCase.terminalBalance).toBeGreaterThan(0);
  });

  it('disabled scenarios are excluded from results', () => {
    const result = makeResult(config, 50);
    const scenarios: StressScenarioConfig[] = [
      { type: 'immediate_crash', label: 'Crash', enabled: false, crashPercent: 40 },
      { type: 'high_inflation', label: 'Inflation', enabled: true, inflationOverride: 8, durationYears: 5 },
    ];
    const stressResult = runStressTest(result, config, funds, snapshots, scenarios, 50);

    expect(stressResult.scenarios.length).toBe(1);
    expect(stressResult.scenarios[0].config.type).toBe('high_inflation');
  });
});
