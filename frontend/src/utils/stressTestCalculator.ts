import type { Fund, Snapshot, FireConfig, FireResult, StressScenarioConfig, StressTestBridgeYear, StressTestScenarioResult, StressTestResult } from '../types';

export const DEFAULT_STRESS_SCENARIOS: StressScenarioConfig[] = [
  { type: 'immediate_crash', label: 'Market Crash (40%)', enabled: true, crashPercent: 40, durationYears: 3 },
  { type: 'prolonged_stagnation', label: 'Prolonged Stagnation', enabled: true, durationYears: 5 },
  { type: 'high_inflation', label: 'High Inflation (8%)', enabled: true, inflationOverride: 8, durationYears: 5 },
  { type: 'historical_2000s', label: '2000s Lost Decade', enabled: true },
];

const HISTORICAL_2000S_RETURNS = [-8, -14, -23, 16, 8, 18, 11, 4, -31];

function getWeightedAccessibleGrowthRate(funds: Fund[], snapshots: Snapshot[], config: FireConfig): number {
  const fundMap = new Map(funds.map(f => [f.id, f]));
  let totalBal = 0;
  let weightedRate = 0;

  for (const snapshot of snapshots) {
    const fund = fundMap.get(snapshot.fundId);
    if (!fund) continue;
    const wrapper = fund.wrapper ?? (fund.category === 'pension' ? 'sipp' : 'gia');
    if (wrapper === 'sipp' || wrapper === 'lisa' || wrapper === 'none') continue;
    totalBal += snapshot.value;
    weightedRate += (config.growthRates[fund.subcategory] / 100) * snapshot.value;
  }

  return totalBal > 0 ? weightedRate / totalBal : 0;
}

function simulateBridge(
  startingPot: number,
  startingSpend: number,
  bridgeYears: number,
  baseGrowthRate: number,
  baseInflation: number,
  currentYear: number,
  retirementAge: number,
  scenarioConfig: StressScenarioConfig,
): { years: StressTestBridgeYear[]; terminalBalance: number; survived: boolean; depletionAge: number | null } {
  const years: StressTestBridgeYear[] = [];
  let pot = startingPot;
  let spend = startingSpend;
  let depletionAge: number | null = null;

  if (bridgeYears <= 0) {
    years.push({
      age: retirementAge,
      year: currentYear,
      balance: pot,
      spending: 0,
      growthApplied: 0,
      effectiveGrowthRate: baseGrowthRate,
      effectiveInflation: baseInflation,
    });
    return { years, terminalBalance: pot, survived: true, depletionAge: null };
  }

  for (let y = 0; y < bridgeYears; y++) {
    const age = retirementAge + y;
    const year = currentYear + y;

    let effectiveGrowthRate = baseGrowthRate;
    let effectiveInflation = baseInflation;

    const crashPercent = scenarioConfig.crashPercent ?? 40;
    const duration = scenarioConfig.durationYears ?? 3;

    switch (scenarioConfig.type) {
      case 'immediate_crash':
        if (y === 0) {
          effectiveGrowthRate = -(crashPercent / 100);
        } else if (y <= duration) {
          effectiveGrowthRate = baseGrowthRate / 2;
        }
        break;
      case 'prolonged_stagnation':
        if (y < duration) {
          effectiveGrowthRate = baseInflation;
        }
        break;
      case 'high_inflation':
        if (y < duration) {
          effectiveInflation = (scenarioConfig.inflationOverride ?? 8) / 100;
        }
        break;
      case 'historical_2000s':
        if (y < HISTORICAL_2000S_RETURNS.length) {
          effectiveGrowthRate = HISTORICAL_2000S_RETURNS[y] / 100;
        }
        break;
    }

    pot -= spend;

    const yearEntry: StressTestBridgeYear = {
      age,
      year,
      balance: pot,
      spending: spend,
      growthApplied: 0,
      effectiveGrowthRate,
      effectiveInflation,
    };

    if (pot <= 0) {
      yearEntry.balance = 0;
      years.push(yearEntry);
      depletionAge = age;
      break;
    }

    const growth = pot * effectiveGrowthRate;
    pot += growth;
    yearEntry.growthApplied = growth;
    yearEntry.balance = pot;

    years.push(yearEntry);

    spend *= (1 + effectiveInflation);
  }

  return {
    years,
    terminalBalance: Math.max(0, pot),
    survived: depletionAge === null,
    depletionAge,
  };
}

export function runStressTest(
  result: FireResult,
  config: FireConfig,
  funds: Fund[],
  snapshots: Snapshot[],
  scenarioConfigs: StressScenarioConfig[],
  retirementAge: number,
): StressTestResult {
  const pensionAccessAge = config.pensionAccessAge;
  const bridgeYears = Math.max(0, pensionAccessAge - retirementAge);

  const projection = result.projections.find(p => p.age === retirementAge);
  const startingPot = projection?.accessible ?? 0;

  const guaranteedIncome = (projection?.statePension ?? 0) + (projection?.definedBenefitIncome ?? 0);
  const startingSpend = Math.max(0, (projection?.annualSpend ?? 0) - guaranteedIncome);

  const baseGrowthRate = getWeightedAccessibleGrowthRate(funds, snapshots, config);
  const baseInflation = config.inflationRate / 100;

  const currentYear = new Date().getFullYear() + (retirementAge - (new Date().getFullYear() - new Date(config.dateOfBirth).getFullYear()));

  // Base case: no modifiers
  const baseCaseConfig: StressScenarioConfig = { type: 'immediate_crash', label: 'Base Case', enabled: true };
  const baseYears: StressTestBridgeYear[] = [];
  {
    let pot = startingPot;
    let spend = startingSpend;

    if (bridgeYears <= 0) {
      baseYears.push({
        age: retirementAge,
        year: currentYear,
        balance: pot,
        spending: 0,
        growthApplied: 0,
        effectiveGrowthRate: baseGrowthRate,
        effectiveInflation: baseInflation,
      });
    } else {
      for (let y = 0; y < bridgeYears; y++) {
        pot -= spend;
        const entry: StressTestBridgeYear = {
          age: retirementAge + y,
          year: currentYear + y,
          balance: pot,
          spending: spend,
          growthApplied: 0,
          effectiveGrowthRate: baseGrowthRate,
          effectiveInflation: baseInflation,
        };
        if (pot <= 0) {
          entry.balance = 0;
          baseYears.push(entry);
          break;
        }
        const growth = pot * baseGrowthRate;
        pot += growth;
        entry.growthApplied = growth;
        entry.balance = pot;
        baseYears.push(entry);
        spend *= (1 + baseInflation);
      }
    }
  }

  const baseTerminal = baseYears.length > 0 ? baseYears[baseYears.length - 1].balance : startingPot;
  const baseDepletionAge = baseYears.find(y => y.balance <= 0)?.age ?? null;

  const baseCase: StressTestScenarioResult = {
    config: baseCaseConfig,
    bridgeYears: baseYears,
    terminalBalance: baseTerminal,
    survived: baseDepletionAge === null,
    depletionAge: baseDepletionAge,
  };

  const scenarios: StressTestScenarioResult[] = scenarioConfigs
    .filter(sc => sc.enabled)
    .map(sc => {
      const sim = simulateBridge(startingPot, startingSpend, bridgeYears, baseGrowthRate, baseInflation, currentYear, retirementAge, sc);
      return {
        config: sc,
        bridgeYears: sim.years,
        terminalBalance: sim.terminalBalance,
        survived: sim.survived,
        depletionAge: sim.depletionAge,
      };
    });

  return {
    retirementAge,
    pensionAccessAge,
    baseCase,
    scenarios,
  };
}
