# UK Teachers' Pension Scheme (TPS) support — detailed execution plan

This plan is written to be executed step-by-step by any model, including less capable ones. Each step is independently committable, states exactly which files to touch, includes the code/formulas to write, and ends with a **Done when** checklist. Do the steps IN ORDER. Do not skip the test sub-steps.

## Context

FinTrack (this repo) is a personal net-worth tracker with FIRE projections. All FIRE maths is **frontend-only** in `frontend/src/utils/fireCalculator.ts`; the backend only persists config blobs (`PUT /fire-config` in `backend/src/handlers/fireConfig.ts` spreads the body straight into DynamoDB, so **new FireConfig fields need ZERO backend or CDK changes**).

Goal: model the UK Teachers' Pension Scheme (England & Wales), including:
- Accrued final-salary and career-average benefits typed in from the member's annual Benefit Statement, plus optional projection of future accrual for a teacher still in service.
- The **McCloud remedy / Deferred Choice**: service from 1 Apr 2015 – 31 Mar 2022 ("remedy period") can pay out as EITHER final salary OR career average — the member chooses at retirement. The app models both branches and recommends one.
- Decision tools for the scheme's purchase options (Additional Pension, Faster Accrual, Buy Out, AVCs) including when NOT to buy.
- A prerequisite correctness fix: guaranteed income (DB + state pension) is currently never income-taxed by the simulator.

User-confirmed decisions:
- Fix the guaranteed-income tax gap unconditionally (existing projections will shift — expected).
- Include future-accrual projection for in-service teachers.
- Build a dedicated `/teachers-pension` page; the Fire page only shows a read-only summary.
- Single `teachersPension` config object (not an array).

## Ground rules for the implementer

1. **Never touch** `backend/` or `infrastructure/` — no changes are needed there.
2. All FireConfig monetary values are **pounds** (floats), NOT pence. (Only fund snapshots are pence, and you won't touch those.)
3. After every step: `cd frontend && npm test` must pass and `npx tsc -b --noEmit` (or `npm run build`) must compile. Fix what you broke before moving on.
4. Follow existing code style: no semicolon/style changes to untouched lines, match existing comment density (sparse; comments only for non-obvious constraints).
5. Existing tests use Vitest with fake timers pinned to `2026-01-01` and helpers `makeFund` / `makeSnapshot` / `makeConfig` — copy those patterns (see `frontend/src/utils/fireCalculator.test.ts` top of file and the `describe('defined benefit pensions')` block around line 1031).
6. Percentages in config are whole numbers (e.g. `inflationRate: 2.5` means 2.5%). Factors in the new `tpsFactors.ts` are decimals (0.793 = ×0.793). Be careful at every boundary.
7. Commit at the end of each step with a short message; do not push or deploy.

---

## Domain reference (verified 2025/26, GAD 2023 factor set — treat as ground truth)

### Scheme structure
- **Final Salary (FS) arrangement** — legacy, closed to accrual 1 Apr 2022:
  - **NPA60 section** (joined before 2007): accrual 1/80th of final salary per year + **automatic lump sum of 3× the annual pension**. Payable unreduced from age 60.
  - **NPA65 section** (joined 2007–2012): accrual 1/60th, **no automatic lump sum**. Unreduced from 65.
  - While the member is still in pensionable service, FS benefits keep their **final-salary link**: they grow with the member's salary. Once the member leaves service (deferred), they grow with CPI only.
  - NPA60 benefits get **no late-retirement uplift** (claiming after 60 just forfeits years of payment).
- **Career Average (CARE) arrangement** — from 1 Apr 2015 (everyone from Apr 2022):
  - Accrual 1/57th of each year's pensionable earnings.
  - Revaluation each April: **CPI + 1.6%** while in service; **CPI only** once deferred. In payment: CPI.
  - **NPA = max(65, State Pension Age)** — typically 67 or 68. User enters this.
- **Commutation** (both arrangements): give up pension for lump sum at **£12 lump sum per £1/yr pension**. HMRC cap: lump sum L must satisfy `L ≤ 0.25 × (20 × residualPension + L)`.
- **Minimum pension age**: 55 now; **57 from 6 April 2028** (so anyone reaching 55 after ~Apr 2028, i.e. born after ~Apr 1973, has min age 57).

### McCloud remedy / Deferred Choice
- Eligible members (in service on/before 31 Mar 2012 AND during the remedy period, no >5yr break) get a Remediable Service Statement (RSS) showing remedy-period service on BOTH bases. At retirement they pick one.
- Choosing **FS**: remedy service joins the FS tranche — inherits its NPA (60 or 65), salary link, and (NPA60 only) 3× automatic lump sum.
- Choosing **CARE**: remedy service joins the CARE tranche — CPI+1.6% revaluation but SPA-linked NPA and harsher early-retirement reduction.
- Drivers: for early (FIRE) retirees the FS branch usually wins because it's unreduced from 60/65 while CARE is reduced back from 67/68. CARE wins for flat salary growth + claiming at/after SPA (1/57 > 1/80 or 1/60 headline accrual).

### Early/late retirement factors (multiply the annual pension). GAD 2023 review set.

`yearsEarly = NPA − claimAge` (0 if claiming at/after NPA). Linear-interpolate between rows; clamp outside the table.

| yearsEarly | FS NPA60 pension | FS NPA65 & CARE-active "ER7" | CARE-deferred "ER8" |
|---|---|---|---|
| 0 | 1.000 | 1.000 | 1.000 |
| 1 | 0.962 | 0.953 | 0.950 |
| 2 | 0.925 | 0.909 | 0.903 |
| 3 | 0.891 | 0.867 | 0.859 |
| 4 | 0.858 | 0.829 | 0.819 |
| 5 | 0.827 | 0.793 | 0.782 |
| 7 | — | 0.729 | 0.716 |
| 10 | — | 0.648 | 0.632 |
| 13 | — | — | 0.564 |

- NPA60 table stops at 5 years early (age 55 for NPA 60) — clamp there.
- **NPA60 automatic lump sum** has its own, milder reduction. Use this APPROXIMATE table (real one is in the GAD workbook; ±1-2% acceptable): yearsEarly 0→1.000, 1→0.979, 2→0.958, 3→0.938, 4→0.919, 5→0.900.
- **CARE while still in service at claim**: ER7 covers the span from claim age up to 65 only. The 65→NPA span uses the separate "standard reduction" of **3% per year** (0.25%/month). Combined multiplicatively:
  `factor = ER7(max(0, 65 − claimAge)) × (1 − 0.03 × min(3, max(0, NPA − max(65, claimAge))))`
  Wait — the standard reduction is capped at 3 years because NPA is at most 68. Example: NPA 68, claim 58 → ER7(7)=0.729 × (1 − 0.03×3 = 0.91) ≈ 0.663. NPA 68, claim 65 → 1.000 × 0.91 = 0.91.
- **CARE deferred** (left service before claiming, `leavingAge < claimAge` or not in service): single ER8 lookup on full `NPA − claimAge`; no separate standard reduction.
- **Additional Pension** always reduces on the ER8 basis.
- **Late retirement** (claimAge > NPA): CARE ×(1.037)^(yearsLate) approximation; FS NPA65 same approximation; FS NPA60 **no uplift** (factor stays 1.0).

### Purchase options (decision tools)
- **Additional Pension (AP)**: buy index-linked pension in **£250/yr blocks**, max total **£8,600/yr** (2025/26). Revalues **CPI-only** (no +1.6%) even in service; reduced via ER8 if claimed before NPA; dies with member (optional +50% dependant cover costs ~7.5% more). One-off cost per £250/yr of pension (personal-only, by age at election × scheme NPA):

| Age | NPA 65 | NPA 66 | NPA 67 | NPA 68 |
|---|---|---|---|---|
| 30 | £2,960 | £2,840 | £2,720 | £2,600 |
| 40 | £3,430 | £3,280 | £3,140 | £3,000 |
| 50 | £3,960 | £3,780 | £3,610 | £3,450 |
| 55 | £4,250 | £4,060 | £3,870 | £3,690 |
| 60 | £4,580 | £4,360 | £4,150 | £3,950 |
| 65 | £4,880 | £4,720 | £4,490 | £4,260 |

  Interpolate by age. Benchmark comparisons: open-market index-linked annuity ≈ **£28 per £1/yr** at 67; SIPP-equivalent capital = `1 / (withdrawalRate/100)` per £1/yr.
- **Faster Accrual**: elect 1/55, 1/50 or 1/45 instead of 1/57 for one scheme year at a time. Extra contribution ≈ **1.25% / 4.8% / 9.1% of pensionable salary** respectively. The extra pension earned gets full CPI+1.6% revaluation.
- **Buy Out**: removes the 3%/yr standard reduction on the 65→NPA span (max 3 yrs). Costs ~0.96% of salary per year bought out, for the whole career. **Only electable within 6 months of first joining CARE** → informational only in the UI, no calculator.
- **When NOT to buy TPS extras** (for the guidance panel): claiming very early → ER8 haircut 30-45% plus decades of waiting; AP/extra pension is not inheritable capital; early leavers lose the salary link/revaluation edge; large AP purchases count in FULL against the £60k Annual Allowance in the purchase year (DB input = 16× pension growth above CPI); the Prudential Teachers' AVC has no employer match so a low-cost SIPP usually beats it.

### Member contribution tiers 2025/26 (for the future-accrual display, actual salary not FTE)
7.4% ≤£34,873 | 8.9% to £46,944 | 9.9% to £55,661 | 10.5% to £73,769 | 11.6% to £100,591 | 12.0% above.

---

## Step 1 — Tax guaranteed income (standalone correctness fix)

**Problem**: in `frontend/src/utils/fireCalculator.ts`, `runSimulation` computes `guaranteedIncome = statePension + dbIncome` and `netSpend = annualSpend - guaranteedIncome` (~lines 529-530). DB/state pension income is treated as tax-free. A £20k teachers' pension + £11k state pension is really ~£27.3k net, not £31k.

**Changes** (all in `frontend/`):

1. `src/types/index.ts` — add to `FireProjection`:
   ```ts
   guaranteedIncomeTax?: number; // income tax on statePension + definedBenefitIncome
   ```
2. `src/utils/fireCalculator.ts`, inside `runSimulation` where `guaranteedIncome`/`netSpend` are computed:
   ```ts
   const guaranteedIncome = statePension + dbIncome;
   const guaranteedIncomeTax = calculateIncomeTax(guaranteedIncome, taxConfig);
   const netSpend = annualSpend - (guaranteedIncome - guaranteedIncomeTax);
   ```
   `calculateIncomeTax(income, taxConfig)` already exists (~line 121). Add `guaranteedIncomeTax` into the year's `yearTaxPaid` accumulation AND into the projection row output (`guaranteedIncomeTax` field). **Do not change** `otherTaxableIncome = guaranteedIncome` used for withdrawal gross-up (~line 549) — gross is correct there.
3. Find every OTHER place that recomputes "spend minus guaranteed income" from projection rows and subtract **net** instead of gross (use the new row field, `?? 0`):
   - `findSubYearFireFraction` in `fireCalculator.ts` (~lines 230-300): it interpolates between two rows; use `row.guaranteedIncome - (row.guaranteedIncomeTax ?? 0)`.
   - The target-analysis section (~lines 797-817) computing `requiredPot` from `netSpend`.
   - `src/utils/stressTestCalculator.ts` (~lines 143-144): nets `definedBenefitIncome`/`statePension` out of bridge spend — subtract the row's `guaranteedIncomeTax` too.
   - Search for other consumers: `grep -n "guaranteedIncome" frontend/src -r` and audit each hit.
4. Check `src/pages/Dashboard.tsx` (~lines 108, 350, 357) — it nets DB income out of a FIRE countdown. If it recomputes from config rather than projection rows, leave it (approximation), but add nothing new.

**Tests** (`src/utils/fireCalculator.test.ts`):
- In `describe('defined benefit pensions')` (~line 1031): add a test where config has a £30,000/yr DB pension from age 60 + default tax config → at age 60 the row's `guaranteedIncomeTax` ≈ tax on £30,000 (with default bands: personal allowance £12,570, 20% basic → (30000−12570)×0.20 = £3,486; use the repo's actual `TaxConfig` defaults — read them first). Drawdown from pots should increase correspondingly vs the pre-fix expectation.
- A DB pension of £10,000/yr with nothing else → `guaranteedIncomeTax` = 0 (inside personal allowance). The existing small-DB tests should still pass unchanged.
- Run the whole suite; some existing expectations with state pension + large DB may shift — update those expected numbers, and only those, verifying by hand that the new number = old number adjusted by the tax.

**Done when**: `npm test` passes; a projection with a large DB pension shows non-zero `guaranteedIncomeTax` from its start age; committed.

---

## Step 2 — Types

**File**: `frontend/src/types/index.ts`. Add below `DefinedBenefitPension` (~line 54):

```ts
export type TpsFsSection = 'npa60' | 'npa65';
export type TpsMcCloudChoice = 'finalSalary' | 'careerAverage' | 'auto';

/** UK Teachers' Pension Scheme. All amounts £/yr at the statement date unless noted. */
export interface TeachersPensionConfig {
  enabled: boolean;
  statementDate: string; // 'YYYY-MM' the benefit-statement figures are valid at

  finalSalary?: {
    section: TpsFsSection;
    accruedAnnualPension: number;
    automaticLumpSum?: number; // £, NPA60 only (~3x pension)
  };
  careerAverage?: {
    accruedAnnualPension: number; // already revalued to statement date
    normalPensionAge: number; // max(65, SPA) — user-entered, e.g. 68
  };
  /** Remediable Service Statement dual figures for 2015-2022 remedy service */
  mcCloud?: {
    finalSalaryAnnualPension: number;
    finalSalaryLumpSum?: number; // if legacy section is NPA60
    careAnnualPension: number;
    choice: TpsMcCloudChoice; // 'auto' = engine picks the better branch at claim age
  };
  additionalPensionAccrued?: number; // £/yr already purchased (CPI-only revaluation)

  stillInService: boolean;
  futureAccrual?: {
    currentSalary: number; // £/yr pensionable
    leavingAge: number; // age accrual stops
    salaryGrowthRate?: number; // %/yr, default config.inflationRate
    accrualDenominator?: 57 | 55 | 50 | 45; // faster-accrual election
  };

  claimAge: number;
  commutedPension?: number; // £/yr given up for lump sum at £12 per £1
}
```

Add to `FireConfig`:
```ts
teachersPension?: TeachersPensionConfig;
```

**Done when**: compiles; committed. (No behaviour change.)

---

## Step 3 — Factor data module

**New file**: `frontend/src/utils/tpsFactors.ts`. Pure data + one lookup helper. Header comment:

```ts
// Teachers' Pension Scheme (England & Wales) actuarial factors.
// Source: GAD 2023 factor review set (in force from 2024, current as of the
// 2026-01 consolidated workbook) — https://gadfactorguidancehub.co.uk/guidance/tps_ew/
// Factors are revised at each scheme valuation; update this file when GAD reissues them.
```

Contents (write exactly these values, from the Domain reference above):

```ts
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
  // clamp, then linear-interpolate between surrounding rows
}

export function minPensionAge(dateOfBirth: string): number {
  // 55 today; normal minimum pension age rises to 57 on 6 April 2028.
  // Anyone born on/after 6 April 1973 reaches 55 after that date -> 57.
  return dateOfBirth >= '1973-04-06' ? 57 : 55;
}

export function memberContributionRate(salary: number): number {
  // first tier whose threshold exceeds salary
}
```

Implement `lookupFactor` (clamp below first / above last row, else linear interpolation) and the two small helpers.

**Tests**: new `frontend/src/utils/tpsFactors.test.ts`:
- `lookupFactor(ERF_NPA65_ER7, 5)` = 0.793 (exact row); `lookupFactor(ERF_NPA65_ER7, 6)` = 0.761 (midpoint of 0.793 and 0.729); `lookupFactor(ERF_NPA60, 8)` = 0.827 (clamped); `lookupFactor(ERF_NPA60, 0)` = 1.0; negative yearsEarly → 1.0.
- `minPensionAge('1972-01-01')` = 55; `minPensionAge('1980-06-15')` = 57.
- `memberContributionRate(30000)` = 7.4; `(50000)` = 9.9; `(120000)` = 12.0.

**Done when**: tests pass; committed.

---

## Step 4 — Core TPS calculation module

**New file**: `frontend/src/utils/teachersPension.ts`. Pure functions, no imports from `fireCalculator.ts`. Import types from `../types` and factors from `./tpsFactors`.

```ts
export interface TpsStream {
  label: string;            // e.g. 'TPS final salary', 'TPS career average', 'TPS additional pension'
  startAge: number;         // = claimAge
  annualPensionAtClaim: number; // NOMINAL £/yr in the claim year (see nominal conversion below)
}
export interface TpsBranchOutcome {
  annualPensionReal: number;   // real (today's £) total annual pension for this branch
  lumpSumReal: number;
  cumulativeRealToLifeExpectancy: number; // lumpSum + pension x (lifeExpectancy - claimAge)
}
export interface TpsComputedBenefits {
  streams: TpsStream[];
  totalLumpSumAtClaim: number; // nominal £ at claim year (automatic + commuted), tax-free
  totalAnnualPensionReal: number; // real total across streams (for display)
  mcCloudComparison?: {
    finalSalary: TpsBranchOutcome;
    careerAverage: TpsBranchOutcome;
    recommended: 'finalSalary' | 'careerAverage';
    breakevenAge: number | null;
    reasons: string[];
  };
  warnings: string[];
}
export interface TpsContext {
  currentAge: number;
  inflationRate: number;   // %/yr, used as the CPI assumption
  lifeExpectancy: number;
}

export function computeTpsBenefits(tps: TeachersPensionConfig, ctx: TpsContext): TpsComputedBenefits
```

### Calculation spec (implement exactly; work in REAL today's-£ terms first, convert to nominal at the very end)

Let `cpi = ctx.inflationRate / 100`, `claimAge = tps.claimAge`, `now = ctx.currentAge`.
Years still in service: `serviceYears = tps.stillInService ? max(0, min(tps.futureAccrual?.leavingAge ?? claimAge, claimAge) - now) : 0`.
Years deferred before claim: `deferredYears = max(0, claimAge - now - serviceYears)`.
Salary growth `g = (tps.futureAccrual?.salaryGrowthRate ?? ctx.inflationRate) / 100`.

Work in real terms by using **excess-over-CPI** rates:
- CARE in-service revaluation excess: `careReval = (1 + cpi + 0.016) / (1 + cpi) - 1` (≈1.6% real).
- FS salary-link excess: `fsReval = (1 + g) / (1 + cpi) - 1`.
- Deferred years: 0 real growth (CPI only). AP: 0 real growth throughout.

**1. Revalue each accrued tranche from statement date to claim age** (real £):
- Ignore the gap between `statementDate` and today (≤1yr, immaterial) — treat statement figures as today's figures.
- `fsPension = finalSalary.accruedAnnualPension × (1 + fsReval)^serviceYears` (salary link only while in service; nothing extra when deferred).
- `fsLumpSum = finalSalary.automaticLumpSum × (1 + fsReval)^serviceYears` (NPA60 only).
- `carePension = careerAverage.accruedAnnualPension × (1 + careReval)^serviceYears`.
- `apPension = additionalPensionAccrued` (no real growth).

**2. Future CARE accrual** (only if `stillInService && futureAccrual`):
```
for t = 0 .. floor(serviceYears) - 1:   // each remaining service year
  yearEarned = salary_real × (1 + fsReval)^t / accrualDenominator   // salary grows at g real = fsReval
  revalue at careReval for the remaining in-service years: × (1 + careReval)^(serviceYears - 1 - t)
accumulate into carePension
```
(Handle fractional final service year by pro-rating the last term.)

**3. McCloud branches.** Build the benefit set twice:
- FS branch: `fsPension += mcCloud.finalSalaryAnnualPension × (1 + fsReval)^serviceYears`; if section npa60, `fsLumpSum += mcCloud.finalSalaryLumpSum × (1 + fsReval)^serviceYears`.
- CARE branch: `carePension += mcCloud.careAnnualPension × (1 + careReval)^serviceYears`.
Evaluate BOTH branches through steps 4-6 below; if `choice === 'auto'` use the recommended one for the returned streams; always return `mcCloudComparison` when `mcCloud` is present.

**4. Claim-age adjustment** (per tranche; `fsNpa = section === 'npa60' ? 60 : 65`; `careNpa = careerAverage.normalPensionAge` (default 68 if only mcCloud CARE figures exist)):
- FS pension: `× lookupFactor(section npa60 ? ERF_NPA60 : ERF_NPA65_ER7, max(0, fsNpa - claimAge))`. Late: npa65 `× (1 + CARE_LATE_UPLIFT)^(claimAge - 65)` if claiming after 65; npa60 NO uplift.
- FS lump sum (npa60): `× lookupFactor(ERF_NPA60_LUMPSUM, max(0, 60 - claimAge))`.
- CARE, if member is in service right up to claim (`stillInService && (futureAccrual?.leavingAge ?? claimAge) >= claimAge`):
  `× lookupFactor(ERF_NPA65_ER7, max(0, 65 - claimAge)) × (1 - CARE_ACTIVE_STANDARD_REDUCTION × min(3, max(0, careNpa - max(65, claimAge))))`
- CARE, deferred (left service before claim): `× lookupFactor(ERF_CARE_DEFERRED_ER8, max(0, careNpa - claimAge))`.
- CARE late (claimAge > careNpa): `× (1 + CARE_LATE_UPLIFT)^(claimAge - careNpa)`.
- AP: `× lookupFactor(ERF_CARE_DEFERRED_ER8, max(0, careNpa - claimAge))`, same late uplift as CARE.

**5. Commutation**: if `commutedPension > 0`: reduce total pension (take it from the largest tranche, or pro-rata — pro-rata is fine) by `commutedPension`; add `COMMUTATION_RATE × commutedPension` to the lump sum. HMRC cap: max lump sum `Lmax = 0.25 × 20 × P0 / (1 - 0.25 × (COMMUTATION_RATE - 20)/COMMUTATION_RATE)` — do NOT trust this closed form blindly; implement it as: solve `L ≤ 0.25 × (20 × (P0 - L/12) + L)` for L, i.e. `L ≤ 5×P0 / (1 + 5/12 - 0.25) ... ` — implement numerically instead: `maxCommutablePension = ` largest c in [0, totalPension] such that `existingLumpSum + 12c ≤ 0.25 × (20 × (totalPension - c) + existingLumpSum + 12c)`; simple linear solve: `existingLS + 12c ≤ 5(P - c) + 0.25·existingLS + 3c` → `14c + 0.75·existingLS ≤ 5P` → `c ≤ (5P - 0.75·existingLS)/14` (equivalently max lump sum ≈ 4.29× pension). Use that formula; if `commutedPension` exceeds it, clamp and push a warning `'Commutation clamped to HMRC 25% limit'`.

**6. McCloud comparison + recommendation**:
- For each branch: `TpsBranchOutcome` with real annual pension (post claim-age adjustment, post commutation of that branch — apply the same requested commutation to both), real lump sum, `cumulative = lumpSumReal + annualPensionReal × max(0, ctx.lifeExpectancy - claimAge)`.
- `recommended` = higher cumulative. `breakevenAge`: if one branch has a higher lump sum but lower pension, the age where cumulative totals cross: `claimAge + (lumpSumA - lumpSumB) / (pensionB - pensionA)` when that is > claimAge, else null.
- `reasons[]`, human-readable, generated from the actual numbers, e.g.:
  - `'Final salary benefits are unreduced from age 60; career average is reduced N% at your claim age of X'`
  - `'Final salary choice adds £Y automatic lump sum'`
  - `'Career average accrual (1/57) outweighs final salary (1/80) when claiming at NPA'`
  - `'Salary growth assumption (g%) vs CPI+1.6% revaluation favours <branch>'`

**7. Warnings**: claimAge < minPensionAge(dateOfBirth is not in ctx — pass `minPensionAge` result via ctx or add dateOfBirth to ctx; add `minPensionAge: number` to `TpsContext`); claimAge < 55 hard-invalid; commutation clamped; NPA60 claiming after 60 (`'NPA60 benefits get no late-retirement uplift — deferring past 60 forfeits payments'`).

**8. Nominal conversion + streams**: the FIRE engine's DB-pension path compounds inflation from `startAge`, so hand it NOMINAL-at-claim-year amounts:
`nominal = real × (1 + cpi)^(claimAge - now)`. Emit one `TpsStream` per non-zero tranche (FS, CARE, AP) with `startAge: claimAge`, plus `totalLumpSumAtClaim` nominal.

**Tests**: new `frontend/src/utils/teachersPension.test.ts`. Use a fixed ctx `{ currentAge: 45, inflationRate: 2.5, lifeExpectancy: 90, minPensionAge: 57 }` unless a case needs otherwise. Cases (compute expected values by hand in the test comments):
1. CARE-only, deferred, claim at NPA 68: no reduction, real pension = accrued (careReval^0 — not in service) → exact passthrough.
2. CARE-only, still in service to claim at 68, 10 more service years on £50k, denominator 57: future accrual sums correctly (assert within £1).
3. CARE claim at 58, NPA 68, deferred: factor = ER8(10) = 0.632.
4. CARE claim at 58, NPA 68, in service to 58: factor = ER7(7) × (1 − 0.09) = 0.729 × 0.91 = 0.66339.
5. NPA60 FS £8,000 + £24,000 lump sum, claim at 57: pension ×ERF_NPA60(3)=0.891 → £7,128; lump sum ×0.938 → £22,512.
6. NPA60 claim at 63: pension unchanged (no late uplift) + warning emitted.
7. Commutation: total pension £10,000, no existing lump sum, commute £1,000 → lump sum £12,000, pension £9,000; cap formula: max c = 5×10000/14 ≈ £3,571.43 — request £6,000 → clamped + warning.
8. McCloud, early claim: NPA60 section, remedy FS £3,500 + LS £10,500 vs CARE £4,200, claim 60, NPA 68, deferred → FS branch unreduced at 60 vs CARE ×ER8(8)=0.688 (interpolated between 0.716@7 and 0.632@10) → FS recommended; reasons non-empty.
9. McCloud, claim at 68 with flat salary growth (g = cpi): CARE £4,200 unreduced beats FS £3,500 (+LS in cumulative terms — construct so CARE cumulative wins, e.g. lifeExpectancy 90 → CARE 4200×22=92,400 vs FS 3500×22+10500=87,500) → CARE recommended; breakevenAge non-null and > 68... (FS has bigger lump sum, smaller pension → breakeven where CARE catches up; verify sign conventions).
10. Nominal conversion: claim 15 years out, real £10,000, cpi 2.5% → stream `annualPensionAtClaim` = 10000×1.025^15.

**Done when**: all new tests pass with hand-computed expectations; committed.

---

## Step 5 — Decision-support helpers

**Same file** `frontend/src/utils/teachersPension.ts` (or a sibling `teachersPensionAdvice.ts` if the file exceeds ~500 lines).

```ts
export interface ClaimAgeSweepRow {
  claimAge: number;
  annualPensionReal: number;  // total, post-reduction
  lumpSumReal: number;
  cumulativeRealToLifeExpectancy: number;
}
export function sweepClaimAges(tps: TeachersPensionConfig, ctx: TpsContext): ClaimAgeSweepRow[]
// from ctx.minPensionAge to 70 inclusive, integer ages: run computeTpsBenefits with claimAge overridden.

export interface ApValueResult {
  blocks: number; annualPension: number;        // £/yr bought (blocks x 250)
  grossCost: number; netCost: number;           // net of tax relief at marginalRate
  costPerPoundGross: number; costPerPoundNet: number; // per £1/yr AFTER any early reduction
  effectivePensionAtClaim: number;              // after ER8 if claimAge < npa
  sippEquivalentCapital: number;                // per the user's withdrawal rate
  annuityEquivalentCost: number;                // INDEX_LINKED_ANNUITY_COST_PER_POUND x annualPension
  verdict: 'strong' | 'good' | 'marginal' | 'poor';
  caveats: string[];
}
export function additionalPensionValue(opts: {
  age: number; npa: 65 | 66 | 67 | 68; annualPension: number; // desired £/yr in £250 blocks
  marginalTaxRate: number; claimAge: number; withdrawalRate: number;
}): ApValueResult
```
- Cost: interpolate `AP_COST_PER_250` by age, × blocks. Net cost = gross × (1 − marginalTaxRate/100).
- Effective pension at claim: apply ER8 on `npa − claimAge` years early.
- `costPerPoundNet = netCost / effectivePensionAtClaim`.
- Verdict thresholds: `costPerPoundNet ≤ 14` → 'strong'; `≤ 20` → 'good'; `≤ 26` → 'marginal'; else 'poor' (annuity benchmark £28).
- Caveats always include: dies with member (no dependant cover modelled), counts ~16× against the £60k Annual Allowance in the purchase year, and — when `claimAge < npa − 5` — a warning that early claiming erodes the value badly.

```ts
export interface FasterAccrualResult {
  extraContributionPct: number; extraContributionAnnual: number; // £ this year
  extraPensionEarned: number;   // £/yr: salary x (1/denom - 1/57)
  costPerPoundGross: number; costPerPoundNet: number;
  verdict: 'strong' | 'good' | 'marginal' | 'poor'; caveats: string[];
}
export function fasterAccrualValue(opts: { salary: number; denominator: 55 | 50 | 45; marginalTaxRate: number }): FasterAccrualResult
```
- `extraPensionEarned = salary × (1/denominator − 1/57)`; cost from `FASTER_ACCRUAL_COST`; same verdict thresholds.

**Tests** (same test file): AP at age 50, NPA 67, £1,000/yr (4 blocks), 40% relief, claim at NPA: gross £14,440, net £8,664, costPerPoundNet ≈ 8.66 → 'strong'. Same but claim at 58 (9 yrs early, ER8 ≈ interp(0.716@7, 0.632@10 → 9→0.660)): effective pension £660, costPerPoundNet ≈ 13.1 → still 'strong' but early-claim caveat present. Faster accrual 1/50 on £50,000: cost £2,400/yr gross, extra pension 50000×(1/50−1/57)=£122.8/yr → costPerPound ≈ 19.5 gross → net at 20% relief ≈ 15.6 → 'good'.

**Done when**: tests pass; committed.

---

## Step 6 — FIRE engine integration

**File**: `frontend/src/utils/fireCalculator.ts`, in `calculateFireProjections` (~line 330), BEFORE `runSimulation` is set up (where `definedBenefitPensions` and the fund balances are prepared, ~line 343):

```ts
const definedBenefitPensions = [...(config.definedBenefitPensions ?? [])];
const tps = config.teachersPension;
if (tps?.enabled) {
  const tpsBenefits = computeTpsBenefits(tps, {
    currentAge, inflationRate: config.inflationRate,
    lifeExpectancy: config.lifeExpectancy ?? 100,
    minPensionAge: minPensionAge(config.dateOfBirth),
  });
  for (const s of tpsBenefits.streams) {
    definedBenefitPensions.push({ name: s.label, annualAmount: s.annualPensionAtClaim, startAge: s.startAge, inflationLinked: true });
  }
  // lump sum handled below via a synthetic fund
}
```

Lump sum: alongside where fund balances are built, if `tps?.enabled && totalLumpSumAtClaim > 0`, push a synthetic balance (copy the shape used by `__lumpsum_gia_cash` at ~line 464):
```ts
{
  fundId: '__tps_lumpsum', wrapper: 'gia', subcategory: 'cash',
  drawdownAge: currentAge, monthlyContribution: 0,
  contributionStartAge: currentAge, contributionEndAge: endAge,
  take25PctLumpSum: false, balance: 0,
  lumpSums: [{ id: '__tps_ls', type: 'inflow', amount: totalLumpSumAtClaim,
               date: `${currentYear + Math.ceil(tps.claimAge - currentAge)}-04`,
               description: 'TPS lump sum', active: true }],
}
```
Check the actual `LumpSum` type fields in `types/index.ts` and the balance-record shape used inside `runSimulation` (~lines 390-410) and match them EXACTLY, including how `contributionStartAge` is derived. The existing per-fund lump-sum loop (~lines 434-451) then applies it in the claim year — no engine loop changes.

IMPORTANT: this must go wherever fund balances are **initialised per simulation probe** (the engine re-runs simulations for FIRE-date/Coast probes with fresh copies, ~line 390). If balances are deep-copied from a template array, add the synthetic fund to the TEMPLATE, not inside `runSimulation`.

**Tests** (`fireCalculator.test.ts`, new `describe('teachers pension')`):
- Config with `teachersPension` (CARE £10,000, NPA 68, claim 68, not in service, no lump sum) → `projections` show `definedBenefitIncome` ≈ nominal £10,000×1.025^(68−currentAge) from age 68, zero before; taxed per Step 1.
- With NPA60 FS incl. £24,000 lump sum, claim 60 → accessible total jumps by ≈ nominal lump sum in the claim year.
- FIRE date with TPS enabled is ≤ FIRE date without (guaranteed income only helps).
- `mcCloud.choice: 'finalSalary'` vs `'careerAverage'` produce different `definedBenefitIncome`.

**Done when**: tests pass, including the full pre-existing suite; committed.

---

## Step 7 — Extract shared form components

`frontend/src/pages/Fire.tsx` defines small presentational helpers (`ConfigSection`, `Field`, ~lines 936-965 — verify by reading the end of the file). Move them verbatim to a new `frontend/src/components/ConfigSection.tsx`, export both, and import them back into `Fire.tsx`. NO visual/behavioural change.

**Done when**: `npm test` + `npm run build` pass; the Fire page renders identically (spot-check in dev server); committed.

---

## Step 8 — Teachers' Pension page: inputs + headline

**New file**: `frontend/src/pages/TeachersPension.tsx`. Wire-up:
- `frontend/src/App.tsx`: add `<Route path="/teachers-pension" element={<TeachersPension />} />` inside the protected layout routes (copy the `/fire` line).
- `frontend/src/components/Layout.tsx`: add nav entry `Teachers' Pension` after FIRE (copy an existing item; use the `AcademicCapIcon` heroicon if the repo uses heroicons — check existing imports; otherwise match whatever icon system is used).

Page skeleton (follow `Fire.tsx`'s data-loading pattern — it fetches config via `getFireConfig()` from `frontend/src/utils/api.ts` and saves with `updateFireConfig`):
- Local state: `TeachersPensionConfig` initialised from `config.teachersPension` or a sensible default (`enabled: false, statementDate: <current YYYY-MM>, stillInService: true, claimAge: 60`).
- **Enable toggle** at top. When disabled, show a short explainer of what the page does.
- **Inputs card** (use `ConfigSection`/`Field` from Step 7), grouped:
  1. *Final salary section*: section select (NPA60 1/80th + lump sum / NPA65 1/60th / none), accrued annual pension £, automatic lump sum £ (NPA60 only, hint "≈3× pension").
  2. *Career average*: accrued annual pension £ (hint: "figure from your latest Benefit Statement — already revalued"), NPA (number input, hint "later of 65 and your State Pension Age, e.g. 68").
  3. *McCloud remedy (2015–2022)*: enable checkbox → FS-basis annual pension £, FS-basis lump sum £ (shown only if section is NPA60), CARE-basis annual pension £, choice radio: Final salary / Career average / **Auto (recommend)**. Hint: "These are the dual figures on your Remediable Service Statement."
  4. *Additional Pension already held*: £/yr.
  5. *Still teaching?* toggle → current salary £, expected leaving age, salary growth %/yr (default = inflation), accrual election select (Standard 1/57, 1/55, 1/50, 1/45). Show the member contribution rate for the salary (via `memberContributionRate`) as an informational line.
  6. *Claiming*: claim age (validate ≥ `minPensionAge(config.dateOfBirth)`, show warning otherwise), commutation input £/yr given up with live text "= £{12×value} added to lump sum" and a clamp warning when over the HMRC cap (surface `warnings` from `computeTpsBenefits`).
- **Headline card**: from `computeTpsBenefits` — total annual pension at claim age (real, with nominal in secondary text), per-tranche breakdown lines (FS / CARE / AP with the reduction % applied to each, e.g. "CARE: £6,200/yr (reduced 34% for claiming 10 years early)"), total tax-free lump sum, and all `warnings` as amber notices.
- **Save**: "Apply to FIRE plan" button → `updateFireConfig({ ...config, teachersPension: local })`, with saved/dirty indicator matching Fire.tsx's pattern.

**Done when**: page renders, inputs round-trip through save/reload, headline numbers match a hand-checked `computeTpsBenefits` call, build+tests pass; committed.

---

## Step 9 — Decision tools on the page

Read the `dataviz` skill BEFORE writing any chart code. Charts use Recharts (see `frontend/src/components/charts/` for conventions).

1. **Claim-age sweep** (`sweepClaimAges`): ComposedChart — X = claim age (minPensionAge→70), left Y line = annual real pension, right Y bars = lump sum; `ReferenceLine` at each tranche NPA (60/65 and CARE NPA). Below it a compact table: claim age | annual pension | lump sum | cumulative by life expectancy — highlight the row for the currently selected claim age.
2. **McCloud comparison card** (only when mcCloud enabled): two columns (Final salary / Career average) × rows (annual pension at claim age, lump sum, cumulative real value to life expectancy, breakeven age). Recommendation banner ("Career average looks better at your claim age by £X over your plan") + `reasons[]` bullets + a fixed note: "The binding choice is made at retirement via your Remediable Service Statement — this models which way it's likely to go."
3. **Additional Pension calculator**: inputs — desired extra pension (slider/stepper in £250 blocks up to £8,600), marginal tax rate select (20/40/45%), uses the page's claim age + CARE NPA + user's lowest withdrawal rate from config. Output card from `additionalPensionValue`: gross/net cost, cost per £1/yr net, vs SIPP-equivalent capital, vs annuity benchmark, verdict badge (colour by verdict), caveats list.
4. **Faster Accrual calculator** (only when still teaching): denominator select → `fasterAccrualValue` output card, same shape.
5. **"When NOT to buy" static panel** (plain content, no calculator): early claimants face 30–45% actuarial reductions on purchased pension; AP is not inheritable capital; leaving teaching soon erodes the value; large AP purchases can breach the £60k Annual Allowance in the purchase year; Buy Out is only electable within 6 months of joining the career-average scheme; the Prudential AVC has no employer match — a low-cost SIPP or ISA usually wins on fees and flexibility.
6. **Scenario export**: button "Save FS vs CARE as scenarios" (only when mcCloud enabled) → two `createFireScenario` calls (see `frontend/src/utils/api.ts` for the signature and `Fire.tsx` scenarios section for usage): current config with `mcCloud.choice` forced to `'finalSalary'` / `'careerAverage'`, named "TPS: final salary choice" / "TPS: career average choice".

**Done when**: all panels render with plausible numbers for the Step 11 verification persona; chart follows dataviz-skill palette rules; tests+build pass; committed.

---

## Step 10 — Fire page summary + docs

1. `frontend/src/pages/Fire.tsx`, Pension Settings section (the DB-pension editor, ~lines 737-814): when `config.teachersPension?.enabled`, render ABOVE the generic DB list a compact read-only card: "Teachers' Pension — £X/yr from age Y + £Z lump sum" (from `computeTpsBenefits`) with a react-router `Link` to `/teachers-pension`. When not enabled, a one-line hint linking to the page. Do NOT duplicate any editor inputs here.
2. `.claude/skills/fire-advisor/SKILL.md`: add `teachersPension` to the documented FireConfig fields (copy the TypeScript shape), note that guaranteed income is now income-taxed in the simulator, and mention the `/teachers-pension` page tools (McCloud comparison, claim-age sweep, AP/faster-accrual value).
3. `TODO.md`: remove/annotate anything this work completes; add a line noting GAD factors in `tpsFactors.ts` are the 2023 set and need refreshing when GAD reissues.

**Done when**: build+tests pass; committed.

---

## Step 11 — End-to-end verification (do not skip)

1. `cd frontend && npm test` — full suite green.
2. `cd frontend && npm run build` — clean compile.
3. `npm run dev` and drive the app in a browser (use the `verify` skill / browser tools):
   - **Persona**: born 1978 (min pension age 55→ actually `1978 >= 1973-04-06` → 57 — the UI should warn if claim age 55 is entered), NPA60 FS £8,000/yr + £24,000 automatic lump sum, CARE £6,500/yr with NPA 68, McCloud dual figures FS £3,500 (+£10,500 LS) vs CARE £4,200, still teaching on £50,000 to age 58, claim age 60.
   - Check: headline shows FS essentially unreduced at 60, CARE reduced ~35-40%; McCloud recommends final salary at claim age 60 and flips to career average if claim age is set to 68 (verify the card updates).
   - Commute £1,000/yr → lump sum rises £12,000, pension falls £1,000; push commutation absurdly high → clamp warning.
   - "Apply to FIRE plan", go to the FIRE page: Cash Flow tab shows the TPS bar from age 60, ProjectionTable shows `guaranteedIncomeTax` reflected in tax, accessible assets jump by the lump sum in the claim year; FIRE date earlier than with TPS disabled.
   - "Save FS vs CARE as scenarios" → both appear in the Fire page Scenarios section and produce different projections.
   - AP calculator at age 48, NPA 68, £1,000/yr, 40% relief → verdict 'strong', cost per £1 net ≈ £7–9; set claim age 57 → early-claim caveat appears and cost per £1 rises.
4. Regression: with `teachersPension` absent/disabled, projections are IDENTICAL to pre-change output except for the Step 1 tax fix (state-pension-only configs within personal allowance unchanged).
5. Do NOT deploy. Leave that to the user (`./deploy.sh` requires the frontend tests they'll re-run).
