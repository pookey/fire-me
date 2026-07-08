export type TaxWrapper = 'isa' | 'lisa' | 'sipp' | 'gia' | 'none';

export interface Fund {
  id: string;
  name: string;
  description?: string;
  category: 'savings' | 'pension' | 'property';
  subcategory: 'equities' | 'bonds' | 'cash' | 'property';
  wrapper?: TaxWrapper;
  active: boolean;
  sortOrder: number;
  drawdownAge?: number;
  monthlyContribution?: number;
  contributionStartDate?: string; // 'YYYY-MM' — first month contributions are made; absent = start now
  contributionEndAge?: number;
  take25PctLumpSum?: boolean;
  lumpSums?: LumpSum[];
}

export interface Snapshot {
  fundId: string;
  date: string;
  value: number;
  fundName: string;
  category: string;
}

export interface LumpSum {
  type: 'inflow' | 'outflow';
  amount: number;
  date: string; // 'YYYY-MM'
  description: string;
  active?: boolean; // undefined = active (backwards-compatible)
}

export interface TaxConfig {
  personalAllowance: number; // default 12570 (£)
  basicRateThreshold: number; // default 50270
  higherRateThreshold: number; // default 125140
  basicRate: number; // default 20
  higherRate: number; // default 40
  additionalRate: number; // default 45
  cgtAnnualExempt: number; // default 3000 (£)
  cgtBasicRate: number; // default 10
  cgtHigherRate: number; // default 20
}

export interface DefinedBenefitPension {
  name: string;
  annualAmount: number;
  startAge: number;
  inflationLinked?: boolean;
  inflationCap?: number; // max annual increase %, e.g. 2.5 or 5
}

export type IncomeType = 'salary' | 'side_income' | 'rental' | 'other';

export interface Income {
  id: string;
  name: string;
  type: IncomeType;
  annualAmount: number;
  taxable: boolean;
  active: boolean;
}

export type ExpenseCategory = 'housing' | 'transport' | 'food' | 'utilities' | 'insurance' | 'entertainment' | 'subscriptions' | 'other';

export interface Expense {
  id: string;
  name: string;
  category: ExpenseCategory;
  monthlyAmount: number;
  essential: boolean;
  active: boolean;
}

export interface FireConfig {
  targetAnnualSpend: number;
  growthRates: { equities: number; bonds: number; cash: number; property: number };
  inflationRate: number;
  pensionAccessAge: number;
  statePensionAmount: number;
  statePensionAge: number;
  withdrawalRates: number[];
  dateOfBirth: string;
  lifeExpectancy?: number;
  showRealTerms?: boolean;
  drawdownOrder?: TaxWrapper[];
  taxConfig?: TaxConfig;
  definedBenefitPensions?: DefinedBenefitPension[];
  lumpSumAllowance?: number; // default 268275 (£) - 25% tax-free from SIPP
  statePensionInflationLinked?: boolean; // default true — grow with inflation
  targetRetirementAge?: number;
  /** Retirement age Coast FIRE aims at. Defaults to targetRetirementAge ?? pensionAccessAge. */
  coastTargetAge?: number;
}

export interface AssetBreakdown {
  equities: number;
  bonds: number;
  cash: number;
  property: number;
}

export interface FireProjection {
  age: number;
  year: number;
  accessible: number;
  locked: number;
  total: number;
  annualSpend: number;
  statePension: number;
  realTotal?: number;
  contributions?: number;
  isa?: number;
  lisa?: number;
  sipp?: number;
  gia?: number;
  taxPaid?: number;
  grossWithdrawal?: number;
  netIncome?: number;
  definedBenefitIncome?: number;
  drawdownIncome?: number;
  drawdownIsa?: number;
  drawdownLisa?: number;
  drawdownSipp?: number;
  drawdownGia?: number;
  guaranteedIncome?: number;
  guaranteedIncomeTax?: number; // income tax on statePension + definedBenefitIncome
  accessibleBreakdown?: AssetBreakdown;
  lockedBreakdown?: AssetBreakdown;
}

export interface FireResult {
  projections: FireProjection[];
  /** Coast FIRE: earliest age contributions could stop while still retiring at targetAge. */
  coastFire?: {
    coastAge: number | null;
    targetAge: number;
    alreadyCoasting: boolean;
  };
  /** grossAnnualSpend is the tax-inclusive net-of-guaranteed-income spend in the FIRE year (nominal £). */
  fireDates: { withdrawalRate: number; age: number | null; year: number | null; grossAnnualSpend?: number | null }[];
  /** Balance-weighted growth rate of accessible (non-SIPP, non-LISA) funds, decimal e.g. 0.056. Used for sub-year bridge-check interpolation. */
  weightedAccessibleGrowthRate: number;
  targetAnalysis?: {
    targetAge: number;
    isFeasible: boolean;
    shortfallPerYear: number;
    requiredPot: number;
    projectedPot: number;
  };
}

export interface FireScenario {
  id: string;
  name: string;
  config: FireConfig;
}

export type StressScenarioType = 'immediate_crash' | 'prolonged_stagnation' | 'high_inflation' | 'historical_2000s';

export interface StressScenarioConfig {
  type: StressScenarioType;
  label: string;
  enabled: boolean;
  crashPercent?: number;
  durationYears?: number;
  inflationOverride?: number;
}

export interface StressTestBridgeYear {
  age: number;
  year: number;
  balance: number;
  spending: number;
  growthApplied: number;
  effectiveGrowthRate: number;
  effectiveInflation: number;
}

export interface StressTestScenarioResult {
  config: StressScenarioConfig;
  bridgeYears: StressTestBridgeYear[];
  terminalBalance: number;
  survived: boolean;
  depletionAge: number | null;
}

export interface StressTestResult {
  retirementAge: number;
  pensionAccessAge: number;
  baseCase: StressTestScenarioResult;
  scenarios: StressTestScenarioResult[];
}
