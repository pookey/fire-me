// Teachers' Pension Scheme (England & Wales) actuarial factors.
// Source: GAD 2023 factor review set (in force from 2024, current as of the
// 2026-01 consolidated workbook) — https://gadfactorguidancehub.co.uk/guidance/tps_ew/
// Factors are revised at each scheme valuation; update this file when GAD reissues them.

export interface FactorRow { yearsEarly: number; factor: number }

export const ERF_NPA60: FactorRow[] = [
  { yearsEarly: 0, factor: 1.0 }, { yearsEarly: 1, factor: 0.962 },
  { yearsEarly: 2, factor: 0.925 }, { yearsEarly: 3, factor: 0.891 },
  { yearsEarly: 4, factor: 0.858 }, { yearsEarly: 5, factor: 0.827 },
];
// Approximate — the automatic lump sum reduces less steeply than the pension
export const ERF_NPA60_LUMPSUM: FactorRow[] = [
  { yearsEarly: 0, factor: 1.0 }, { yearsEarly: 1, factor: 0.979 },
  { yearsEarly: 2, factor: 0.958 }, { yearsEarly: 3, factor: 0.938 },
  { yearsEarly: 4, factor: 0.919 }, { yearsEarly: 5, factor: 0.900 },
];
export const ERF_NPA65_ER7: FactorRow[] = [
  { yearsEarly: 0, factor: 1.0 }, { yearsEarly: 1, factor: 0.953 },
  { yearsEarly: 2, factor: 0.909 }, { yearsEarly: 3, factor: 0.867 },
  { yearsEarly: 4, factor: 0.829 }, { yearsEarly: 5, factor: 0.793 },
  { yearsEarly: 7, factor: 0.729 }, { yearsEarly: 10, factor: 0.648 },
];
export const ERF_CARE_DEFERRED_ER8: FactorRow[] = [
  { yearsEarly: 0, factor: 1.0 }, { yearsEarly: 1, factor: 0.950 },
  { yearsEarly: 2, factor: 0.903 }, { yearsEarly: 3, factor: 0.859 },
  { yearsEarly: 4, factor: 0.819 }, { yearsEarly: 5, factor: 0.782 },
  { yearsEarly: 7, factor: 0.716 }, { yearsEarly: 10, factor: 0.632 },
  { yearsEarly: 13, factor: 0.564 },
];

export const CARE_ACTIVE_STANDARD_REDUCTION = 0.03; // per year, 65 -> NPA span, max 3
export const CARE_LATE_UPLIFT = 0.037; // per year past NPA (approximation of CLR1)
export const CARE_ACTIVE_REVALUATION_UPLIFT = 1.6; // % added to CPI while in service
export const COMMUTATION_RATE = 12; // £ lump sum per £1/yr pension given up
export const AP_MAX_ANNUAL = 8600; // £/yr, 2025/26, CPI-uprated annually
export const AP_BLOCK = 250;

// One-off cost of £250/yr of Additional Pension (personal-only), by age at
// election x scheme NPA. Interpolate by age, clamp outside.
export const AP_COST_PER_250: { age: number; byNpa: Record<65 | 66 | 67 | 68, number> }[] = [
  { age: 30, byNpa: { 65: 2960, 66: 2840, 67: 2720, 68: 2600 } },
  { age: 40, byNpa: { 65: 3430, 66: 3280, 67: 3140, 68: 3000 } },
  { age: 50, byNpa: { 65: 3960, 66: 3780, 67: 3610, 68: 3450 } },
  { age: 55, byNpa: { 65: 4250, 66: 4060, 67: 3870, 68: 3690 } },
  { age: 60, byNpa: { 65: 4580, 66: 4360, 67: 4150, 68: 3950 } },
  { age: 65, byNpa: { 65: 4880, 66: 4720, 67: 4490, 68: 4260 } },
];

// Extra contribution as % of pensionable salary for a faster-accrual election
export const FASTER_ACCRUAL_COST: Record<55 | 50 | 45, number> = { 55: 1.25, 50: 4.8, 45: 9.1 };

// Member contribution tiers 2025/26 (actual salary): [threshold £, rate %]
export const CONTRIBUTION_TIERS: [number, number][] = [
  [34873, 7.4], [46944, 8.9], [55661, 9.9], [73769, 10.5], [100591, 11.6], [Infinity, 12.0],
];

export const INDEX_LINKED_ANNUITY_COST_PER_POUND = 28; // £ per £1/yr at ~67, benchmark

export function lookupFactor(table: FactorRow[], yearsEarly: number): number {
  // Clamp and linear-interpolate between surrounding rows
  if (yearsEarly < 0) return 1.0;
  if (yearsEarly <= table[0].yearsEarly) return table[0].factor;
  if (yearsEarly >= table[table.length - 1].yearsEarly) return table[table.length - 1].factor;

  // Find the two surrounding rows
  for (let i = 0; i < table.length - 1; i++) {
    if (yearsEarly >= table[i].yearsEarly && yearsEarly <= table[i + 1].yearsEarly) {
      const row1 = table[i];
      const row2 = table[i + 1];
      const t = (yearsEarly - row1.yearsEarly) / (row2.yearsEarly - row1.yearsEarly);
      return row1.factor + t * (row2.factor - row1.factor);
    }
  }
  return table[table.length - 1].factor;
}

export function minPensionAge(dateOfBirth: string): number {
  // 55 today; normal minimum pension age rises to 57 on 6 April 2028.
  // Anyone born on/after 6 April 1973 reaches 55 after that date -> 57.
  return dateOfBirth >= '1973-04-06' ? 57 : 55;
}

export function memberContributionRate(salary: number): number {
  // first tier whose threshold exceeds salary
  for (const [threshold, rate] of CONTRIBUTION_TIERS) {
    if (threshold > salary) {
      return rate;
    }
  }
  return CONTRIBUTION_TIERS[CONTRIBUTION_TIERS.length - 1][1];
}
