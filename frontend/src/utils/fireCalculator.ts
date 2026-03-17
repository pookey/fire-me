import type { Fund, Snapshot, FireConfig, FireProjection, FireResult, TaxConfig, TaxWrapper } from '../types';

type Bucket = { equities: number; bonds: number; cash: number; property: number };

interface FundBalance {
  fundId: string;
  wrapper: TaxWrapper;
  subcategory: keyof Bucket;
  drawdownAge: number;
  monthlyContribution: number;
  contributionEndAge: number;
  take25PctLumpSum: boolean;
  balance: number;
}

const DEFAULT_TAX_CONFIG: TaxConfig = {
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

const DEFAULT_DRAWDOWN_ORDER: TaxWrapper[] = ['gia', 'none', 'isa', 'lisa', 'sipp'];
const DEFAULT_LUMP_SUM_ALLOWANCE = 268275; // pounds

function resolveWrapper(fund: Fund): TaxWrapper {
  if (fund.wrapper) return fund.wrapper;
  if (fund.category === 'pension') return 'sipp';
  return 'gia';
}

function zeroBucket(): Bucket {
  return { equities: 0, bonds: 0, cash: 0, property: 0 };
}

function totalBucket(bucket: Bucket): number {
  return bucket.equities + bucket.bonds + bucket.cash + bucket.property;
}


/**
 * Calculate income tax on SIPP withdrawals using UK tax bands.
 * Includes personal allowance tapering: PA reduces by £1 for every £2 above £100k.
 */
export function calculateIncomeTax(income: number, taxConfig: TaxConfig): number {
  if (income <= 0) return 0;

  // Personal allowance tapering: reduces by £1 for every £2 above £100,000
  const taperThreshold = 100000;
  let effectivePA = taxConfig.personalAllowance;
  if (income > taperThreshold) {
    const reduction = Math.floor((income - taperThreshold) / 2);
    effectivePA = Math.max(0, effectivePA - reduction);
  }

  let tax = 0;
  let remaining = income;

  const personalAllowance = Math.min(remaining, effectivePA);
  remaining -= personalAllowance;

  const basicBand = taxConfig.basicRateThreshold - effectivePA;
  const basicAmount = Math.min(remaining, Math.max(0, basicBand));
  tax += basicAmount * (taxConfig.basicRate / 100);
  remaining -= basicAmount;

  const higherBand = taxConfig.higherRateThreshold - taxConfig.basicRateThreshold;
  const higherAmount = Math.min(remaining, higherBand);
  tax += higherAmount * (taxConfig.higherRate / 100);
  remaining -= higherAmount;

  tax += remaining * (taxConfig.additionalRate / 100);

  return tax;
}

/**
 * Calculate capital gains tax on GIA/none withdrawals.
 * Assumes 50% of withdrawals are gains.
 * Uses basic rate CGT band when other taxable income leaves room in the basic rate band.
 */
export function calculateCGT(withdrawal: number, taxConfig: TaxConfig, otherTaxableIncome: number = 0): number {
  if (withdrawal <= 0) return 0;

  const gains = withdrawal * 0.5;
  const taxableGains = Math.max(0, gains - taxConfig.cgtAnnualExempt);
  if (taxableGains <= 0) return 0;

  // Determine how much of the basic rate band is unused by other income
  const basicRateCeiling = taxConfig.basicRateThreshold;
  const unusedBasicBand = Math.max(0, basicRateCeiling - otherTaxableIncome);

  const gainsAtBasicRate = Math.min(taxableGains, unusedBasicBand);
  const gainsAtHigherRate = taxableGains - gainsAtBasicRate;

  return gainsAtBasicRate * (taxConfig.cgtBasicRate / 100) + gainsAtHigherRate * (taxConfig.cgtHigherRate / 100);
}

/**
 * Calculate gross withdrawal needed to achieve a net amount after tax, for a given wrapper.
 */
function grossWithdrawalForNet(
  netNeeded: number,
  wrapper: TaxWrapper,
  taxConfig: TaxConfig,
  otherTaxableIncome: number
): { gross: number; tax: number } {
  if (wrapper === 'isa' || wrapper === 'lisa') {
    return { gross: netNeeded, tax: 0 };
  }

  if (wrapper === 'sipp') {
    let gross = netNeeded;
    for (let i = 0; i < 10; i++) {
      const totalTax = calculateIncomeTax(otherTaxableIncome + gross, taxConfig);
      const baseTax = calculateIncomeTax(otherTaxableIncome, taxConfig);
      const marginalTax = totalTax - baseTax;
      gross = netNeeded + marginalTax;
    }
    const totalTax = calculateIncomeTax(otherTaxableIncome + gross, taxConfig);
    const baseTax = calculateIncomeTax(otherTaxableIncome, taxConfig);
    const tax = totalTax - baseTax;
    return { gross, tax };
  }

  // GIA or none: CGT on assumed 50% gains
  const tax = calculateCGT(netNeeded, taxConfig, otherTaxableIncome);
  return { gross: netNeeded + tax, tax };
}

/**
 * Aggregate fund balances into wrapper buckets for output.
 */
function aggregateByWrapper(fundBalances: FundBalance[]): Record<TaxWrapper, Bucket> {
  const result: Record<TaxWrapper, Bucket> = {
    isa: zeroBucket(),
    lisa: zeroBucket(),
    sipp: zeroBucket(),
    gia: zeroBucket(),
    none: zeroBucket(),
  };
  for (const fb of fundBalances) {
    result[fb.wrapper][fb.subcategory] += fb.balance;
  }
  return result;
}

export function calculateFireProjections(
  funds: Fund[],
  snapshots: Snapshot[],
  config: FireConfig
): FireResult {
  const birthDate = new Date(config.dateOfBirth);
  const currentYear = new Date().getFullYear();
  const currentAge = currentYear - birthDate.getFullYear();
  const endAge = config.lifeExpectancy ?? 100;
  const lumpSums = config.lumpSums ?? [];
  const showRealTerms = config.showRealTerms ?? false;
  const taxConfig = config.taxConfig ?? DEFAULT_TAX_CONFIG;
  const drawdownOrder = config.drawdownOrder ?? DEFAULT_DRAWDOWN_ORDER;
  const definedBenefitPensions = config.definedBenefitPensions ?? [];
  const lumpSumAllowance = config.lumpSumAllowance ?? DEFAULT_LUMP_SUM_ALLOWANCE;

  // Build fund map and initialize per-fund balances from latest snapshots
  const fundMap = new Map(funds.map(f => [f.id, f]));
  const fundBalances: FundBalance[] = [];

  for (const snapshot of snapshots) {
    const fund = fundMap.get(snapshot.fundId);
    if (!fund) continue;
    const wrapper = resolveWrapper(fund);
    // Exclude non-investable assets (e.g. property) from FIRE projections
    if (wrapper === 'none') continue;
    const isSipp = wrapper === 'sipp';
    const isLisa = wrapper === 'lisa';

    fundBalances.push({
      fundId: fund.id,
      wrapper,
      subcategory: fund.subcategory,
      drawdownAge: fund.drawdownAge ?? (isSipp ? config.pensionAccessAge : isLisa ? 60 : currentAge),
      monthlyContribution: fund.monthlyContribution ?? 0,
      contributionEndAge: fund.contributionEndAge ?? endAge,
      take25PctLumpSum: fund.take25PctLumpSum ?? false,
      balance: snapshot.value,
    });
  }

  // Compute weighted growth rate for accessible funds before the projection loop
  // modifies fundBalances (drawdown depletes balances over time).
  const weightedAccessibleGrowthRate = (() => {
    const accessibleFunds = fundBalances.filter(fb => fb.wrapper !== 'sipp' && fb.wrapper !== 'lisa');
    const totalBal = accessibleFunds.reduce((s, fb) => s + fb.balance, 0);
    if (totalBal <= 0) return 0;
    return accessibleFunds.reduce((s, fb) => s + (config.growthRates[fb.subcategory] / 100) * (fb.balance / totalBal), 0);
  })();

  const projections: FireProjection[] = [];
  let lumpSumTaken = 0;
  const lowestWithdrawalRate = Math.min(...config.withdrawalRates);

  for (let age = currentAge; age <= endAge; age++) {
    const year = currentYear + (age - currentAge);
    const yearsFromNow = age - currentAge;
    const inflationMultiplier = Math.pow(1 + config.inflationRate / 100, yearsFromNow);
    const annualSpend = config.targetAnnualSpend * inflationMultiplier;

    // Apply per-fund contributions (stop at targetRetirementAge if set)
    const contributionCutoffAge = config.targetRetirementAge
      ? Math.min(config.targetRetirementAge, endAge)
      : endAge;
    let yearContributions = 0;
    for (const fb of fundBalances) {
      if (fb.monthlyContribution > 0 && age <= fb.contributionEndAge && age < contributionCutoffAge) {
        const annualAmount = fb.monthlyContribution * 12;
        fb.balance += annualAmount;
        yearContributions += annualAmount;
      }
    }

    // Apply lump sums at the specified age (matched to funds by category+subcategory, proportionally)
    for (const lumpSum of lumpSums) {
      if (lumpSum.age !== age) continue;

      // Find matching funds by wrapper mapping: pension->sipp, savings->gia/isa/none
      const matchingFunds = fundBalances.filter(fb => {
        const wrapperMatchesPension = lumpSum.category === 'pension' && fb.wrapper === 'sipp';
        const wrapperMatchesSavings = lumpSum.category === 'savings' && fb.wrapper !== 'sipp';
        return (wrapperMatchesPension || wrapperMatchesSavings) && fb.subcategory === lumpSum.subcategory;
      });

      if (matchingFunds.length === 0) continue;

      if (lumpSum.type === 'inflow') {
        // Distribute proportionally, or equally if all zero
        const totalBalance = matchingFunds.reduce((sum, fb) => sum + fb.balance, 0);
        if (totalBalance > 0) {
          for (const fb of matchingFunds) {
            fb.balance += lumpSum.amount * (fb.balance / totalBalance);
          }
        } else {
          const share = lumpSum.amount / matchingFunds.length;
          for (const fb of matchingFunds) {
            fb.balance += share;
          }
        }
      } else {
        // Outflow: subtract proportionally
        const totalBalance = matchingFunds.reduce((sum, fb) => sum + fb.balance, 0);
        if (totalBalance > 0) {
          const subtract = Math.min(lumpSum.amount, totalBalance);
          for (const fb of matchingFunds) {
            fb.balance = Math.max(0, fb.balance - subtract * (fb.balance / totalBalance));
          }
        }
      }
    }

    // Per-fund pension 25% tax-free lump sum at each fund's drawdown age
    for (const fb of fundBalances) {
      if (fb.wrapper === 'sipp' && fb.take25PctLumpSum && age === fb.drawdownAge) {
        const maxLumpSum = fb.balance * 0.25;
        const availableLumpSum = Math.min(maxLumpSum, lumpSumAllowance - lumpSumTaken);
        if (availableLumpSum > 0) {
          fb.balance -= availableLumpSum;
          // Move to ISA cash — find or create a synthetic ISA cash fund balance
          let isaCash = fundBalances.find(f => f.wrapper === 'isa' && f.subcategory === 'cash' && f.fundId === '__lumpsum_isa_cash');
          if (!isaCash) {
            isaCash = {
              fundId: '__lumpsum_isa_cash',
              wrapper: 'isa',
              subcategory: 'cash',
              drawdownAge: currentAge,
              monthlyContribution: 0,
              contributionEndAge: endAge,
              take25PctLumpSum: false,
              balance: 0,
            };
            fundBalances.push(isaCash);
          }
          isaCash.balance += availableLumpSum;
          lumpSumTaken += availableLumpSum;
        }
      }
    }

    // Aggregate into wrapper buckets for output
    const wrapperBuckets = aggregateByWrapper(fundBalances);
    const isaTotal = totalBucket(wrapperBuckets.isa);
    const lisaTotal = totalBucket(wrapperBuckets.lisa);
    const sippTotal = totalBucket(wrapperBuckets.sipp);
    const giaTotal = totalBucket(wrapperBuckets.gia);

    // Accessibility: per-fund based on drawdownAge
    let accessibleTotal = 0;
    let lockedTotal = 0;
    const accessibleBucket = zeroBucket();
    const lockedBucket = zeroBucket();

    for (const fb of fundBalances) {
      if (age >= fb.drawdownAge) {
        accessibleTotal += fb.balance;
        accessibleBucket[fb.subcategory] += fb.balance;
      } else {
        lockedTotal += fb.balance;
        lockedBucket[fb.subcategory] += fb.balance;
      }
    }

    const total = accessibleTotal + lockedTotal;

    // State pension — optionally grows with inflation (default: true)
    const statePensionInflationLinked = config.statePensionInflationLinked ?? true;
    const statePensionMultiplier = statePensionInflationLinked ? inflationMultiplier : 1;
    const statePension = age >= config.statePensionAge ? config.statePensionAmount * statePensionMultiplier : 0;

    // DB pensions — optionally inflation-linked with optional cap
    let dbIncome = 0;
    for (const dbp of definedBenefitPensions) {
      if (age >= dbp.startAge) {
        if (dbp.inflationLinked) {
          const yearsFromStart = age - dbp.startAge;
          const capRate = dbp.inflationCap != null ? Math.min(config.inflationRate, dbp.inflationCap) : config.inflationRate;
          dbIncome += dbp.annualAmount * Math.pow(1 + capRate / 100, yearsFromStart);
        } else {
          dbIncome += dbp.annualAmount;
        }
      }
    }

    const projection: FireProjection = {
      age,
      year,
      accessible: Math.round(accessibleTotal),
      locked: Math.round(lockedTotal),
      total: Math.round(total),
      annualSpend: Math.round(annualSpend),
      statePension: Math.round(statePension),
      contributions: Math.round(yearContributions),
      isa: Math.round(isaTotal),
      lisa: Math.round(lisaTotal),
      sipp: Math.round(sippTotal),
      gia: Math.round(giaTotal),
      definedBenefitIncome: Math.round(dbIncome),
      accessibleBreakdown: {
        equities: Math.round(accessibleBucket.equities),
        bonds: Math.round(accessibleBucket.bonds),
        cash: Math.round(accessibleBucket.cash),
        property: Math.round(accessibleBucket.property),
      },
      lockedBreakdown: {
        equities: Math.round(lockedBucket.equities),
        bonds: Math.round(lockedBucket.bonds),
        cash: Math.round(lockedBucket.cash),
        property: Math.round(lockedBucket.property),
      },
    };

    if (showRealTerms) {
      projection.realTotal = Math.round(total / inflationMultiplier);
    }

    // Drawdown logic — group accessible funds by wrapper, withdraw in drawdownOrder
    const guaranteedIncome = statePension + dbIncome;
    const netSpend = annualSpend - guaranteedIncome;
    let yearTaxPaid = 0;
    let yearGrossWithdrawal = 0;
    const yearDrawdownByWrapper: Record<string, number> = { isa: 0, lisa: 0, sipp: 0, gia: 0, none: 0 };

    let isDrawingDown = false;
    if (netSpend > 0) {
      const requiredPot = netSpend / (lowestWithdrawalRate / 100);
      const potIsSufficient = accessibleTotal >= requiredPot;
      const forcedByTarget = config.targetRetirementAge != null && age >= config.targetRetirementAge;
      if (potIsSufficient || forcedByTarget) {
        isDrawingDown = true;
        let remaining = netSpend;
        let otherTaxableIncome = guaranteedIncome;

        for (const wrapper of drawdownOrder) {
          if (remaining <= 0) break;

          // Get accessible funds for this wrapper
          const accessibleFundsForWrapper = fundBalances.filter(
            fb => fb.wrapper === wrapper && age >= fb.drawdownAge && fb.balance > 0
          );
          const available = accessibleFundsForWrapper.reduce((sum, fb) => sum + fb.balance, 0);
          if (available <= 0) continue;

          const drawAmount = Math.min(remaining, available);
          const { gross, tax } = grossWithdrawalForNet(drawAmount, wrapper, taxConfig, otherTaxableIncome);

          const actualGross = Math.min(gross, available);
          let actualTax = tax;
          if (actualGross < gross) {
            if (wrapper === 'sipp') {
              const totalT = calculateIncomeTax(otherTaxableIncome + actualGross, taxConfig);
              const baseT = calculateIncomeTax(otherTaxableIncome, taxConfig);
              actualTax = totalT - baseT;
            } else if (wrapper === 'gia' || wrapper === 'none') {
              actualTax = calculateCGT(actualGross, taxConfig, otherTaxableIncome);
            }
          }

          // Subtract proportionally from accessible funds in this wrapper
          if (available > 0) {
            for (const fb of accessibleFundsForWrapper) {
              fb.balance = Math.max(0, fb.balance - actualGross * (fb.balance / available));
            }
          }

          yearTaxPaid += actualTax;
          yearGrossWithdrawal += actualGross;
          yearDrawdownByWrapper[wrapper] += actualGross - actualTax;

          if (wrapper === 'sipp') {
            otherTaxableIncome += actualGross;
          }

          remaining -= (actualGross - actualTax);
        }
      }
    }

    projection.taxPaid = Math.round(yearTaxPaid);
    projection.grossWithdrawal = Math.round(yearGrossWithdrawal);
    projection.netIncome = Math.round(guaranteedIncome + yearGrossWithdrawal - yearTaxPaid);
    projection.drawdownIncome = Math.round(isDrawingDown ? netSpend : 0);
    projection.drawdownIsa = Math.round(yearDrawdownByWrapper.isa);
    projection.drawdownLisa = Math.round(yearDrawdownByWrapper.lisa);
    projection.drawdownSipp = Math.round(yearDrawdownByWrapper.sipp);
    projection.drawdownGia = Math.round(yearDrawdownByWrapper.gia);
    projection.guaranteedIncome = Math.round(guaranteedIncome);
    projections.push(projection);

    // Grow all fund balances for next year
    for (const fb of fundBalances) {
      const rate = config.growthRates[fb.subcategory] / 100;
      fb.balance *= (1 + rate);
    }
  }

  // Calculate FIRE dates for each withdrawal rate.
  // For each candidate age, check: (1) accessible >= requiredPot for long-term
  // sustainability, and (2) simulate a bridge from candidate age to pension access
  // to verify accessible funds don't deplete before SIPP unlocks.
  const fireDates = config.withdrawalRates.map(rate => {
    const projection = projections.find(p => {
      const guaranteedIncome = p.statePension + (p.definedBenefitIncome ?? 0);
      const netSpend = p.annualSpend - guaranteedIncome;
      if (netSpend <= 0) return true;
      const requiredPot = netSpend / (rate / 100);

      const yearsToBridge = Math.max(0, config.pensionAccessAge - p.age);

      if (yearsToBridge === 0) {
        // Past pension access: everything is accessible, simple check
        return p.accessible >= requiredPot;
      }

      // Before pension access: total pot must sustain long-term (SIPP unlocks later)
      if (p.total < requiredPot) return false;

      // Bridge check: can accessible funds cover spending until pension access?
      let pot = p.accessible;
      let spend = netSpend;
      for (let y = 0; y < yearsToBridge; y++) {
        pot -= spend;
        if (pot <= 0) return false;
        pot *= (1 + weightedAccessibleGrowthRate);
        spend *= (1 + config.inflationRate / 100);
      }
      return true;
    });

    return {
      withdrawalRate: rate,
      age: projection?.age ?? null,
      year: projection?.year ?? null,
    };
  });

  const result: FireResult = { projections, fireDates };

  if (config.targetRetirementAge) {
    const targetProjection = projections.find(p => p.age === config.targetRetirementAge);
    if (targetProjection) {
      const gi = targetProjection.statePension + (targetProjection.definedBenefitIncome ?? 0);
      const ns = targetProjection.annualSpend - gi;
      const requiredPot = ns > 0 ? ns / (lowestWithdrawalRate / 100) : 0;

      // Check feasibility by scanning projections: do accessible funds survive?
      // Must check accessible (not total) because locked pension funds can't be
      // drawn until pension access age — a gap where accessible = 0 but SIPP is
      // locked means you can't actually fund spending.
      const projsFromTarget = projections.filter(p => p.age >= config.targetRetirementAge!);
      const depletionYear = projsFromTarget.find(p => {
        const guaranteed = p.statePension + (p.definedBenefitIncome ?? 0);
        const netSpendNeeded = p.annualSpend - guaranteed;
        return p.accessible <= 0 && netSpendNeeded > 0;
      });
      const isFeasible = !depletionYear;

      // Shortfall: estimate how much extra annual income is needed at depletion
      let shortfallPerYear = 0;
      if (depletionYear) {
        const guaranteed = depletionYear.statePension + (depletionYear.definedBenefitIncome ?? 0);
        shortfallPerYear = depletionYear.annualSpend - guaranteed;
      }

      result.targetAnalysis = {
        targetAge: config.targetRetirementAge,
        isFeasible,
        shortfallPerYear: Math.round(shortfallPerYear),
        requiredPot: Math.round(requiredPot),
        projectedPot: targetProjection.accessible,
      };
    }
  }

  return result;
}
