// Teachers' Pension Scheme benefit calculator (England & Wales).
// Pure functions — no imports from fireCalculator.ts, no Date usage.
// All internal maths is done in REAL (today's £) terms using excess-over-CPI
// growth rates, then converted to NOMINAL at the claim year at the very end so
// the FIRE engine (which re-inflates DB-pension streams from startAge) is handed
// nominal-at-claim figures.

import type { TeachersPensionConfig } from '../types';
import {
  ERF_NPA60,
  ERF_NPA60_LUMPSUM,
  ERF_NPA65_ER7,
  ERF_CARE_DEFERRED_ER8,
  CARE_ACTIVE_STANDARD_REDUCTION,
  CARE_LATE_UPLIFT,
  COMMUTATION_RATE,
  lookupFactor,
} from './tpsFactors';

export interface TpsStream {
  label: string; // e.g. 'TPS final salary', 'TPS career average', 'TPS additional pension'
  startAge: number; // = claimAge
  annualPensionAtClaim: number; // NOMINAL £/yr in the claim year
}

export interface TpsBranchOutcome {
  annualPensionReal: number; // real (today's £) total annual pension for this branch
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
  inflationRate: number; // %/yr, used as the CPI assumption
  lifeExpectancy: number;
  minPensionAge: number; // 55 or 57, from minPensionAge(dateOfBirth)
}

/** Real, pre-claim-age tranche amounts (today's £). */
interface Tranches {
  fsPension: number;
  fsLumpSum: number; // automatic lump sum (NPA60 only)
  carePension: number;
  apPension: number;
}

/** Real amounts after claim-age adjustment and (optionally) commutation. */
interface AdjustedBranch {
  fsPension: number;
  carePension: number;
  apPension: number;
  lumpSum: number; // automatic + commutation
  clamped: boolean;
  careReductionPct: number; // % the CARE tranche was reduced for early claim
}

export function computeTpsBenefits(
  tps: TeachersPensionConfig,
  ctx: TpsContext,
): TpsComputedBenefits {
  const cpi = ctx.inflationRate / 100;
  const claimAge = tps.claimAge;
  const now = ctx.currentAge;
  const warnings: string[] = [];

  const leavingAge = tps.futureAccrual?.leavingAge ?? claimAge;
  // Years still accruing (in service) between now and claim.
  const serviceYears = tps.stillInService
    ? Math.max(0, Math.min(leavingAge, claimAge) - now)
    : 0;
  // Salary growth (nominal); default to CPI.
  const g = (tps.futureAccrual?.salaryGrowthRate ?? ctx.inflationRate) / 100;

  // Excess-over-CPI real growth rates.
  const careReval = (1 + cpi + 0.016) / (1 + cpi) - 1; // ~+1.6% real in service
  const fsReval = (1 + g) / (1 + cpi) - 1; // salary link, real, in service

  const section = tps.finalSalary?.section;
  const fsNpa = section === 'npa60' ? 60 : 65;
  const careNpa = tps.careerAverage?.normalPensionAge ?? 68;

  // In service right up to claim (no deferred gap) → CARE uses the "active"
  // reduction basis rather than the harsher deferred ER8 basis.
  const inServiceToClaim = tps.stillInService && leavingAge >= claimAge;

  // --- Step 1: revalue accrued tranches from statement date to claim (real £) ---
  const baseFsPension = tps.finalSalary
    ? tps.finalSalary.accruedAnnualPension * (1 + fsReval) ** serviceYears
    : 0;
  const baseFsLumpSum =
    section === 'npa60'
      ? (tps.finalSalary?.automaticLumpSum ?? 0) * (1 + fsReval) ** serviceYears
      : 0;
  let baseCarePension =
    (tps.careerAverage?.accruedAnnualPension ?? 0) * (1 + careReval) ** serviceYears;
  const apPension = tps.additionalPensionAccrued ?? 0; // no real growth (CPI only)

  // --- Step 2: future CARE accrual while still in service ---
  if (tps.stillInService && tps.futureAccrual) {
    const denom = tps.futureAccrual.accrualDenominator ?? 57;
    const salaryReal = tps.futureAccrual.currentSalary;
    const whole = Math.floor(serviceYears);
    for (let t = 0; t < whole; t++) {
      // Salary grows at g real (= fsReval); each year's slice then revalues at
      // careReval for the remaining in-service years.
      const earned = (salaryReal * (1 + fsReval) ** t) / denom;
      baseCarePension += earned * (1 + careReval) ** (serviceYears - 1 - t);
    }
    const frac = serviceYears - whole;
    if (frac > 0) {
      // Pro-rate the final partial service year.
      const earned = ((salaryReal * (1 + fsReval) ** whole) / denom) * frac;
      baseCarePension +=
        earned * (1 + careReval) ** Math.max(0, serviceYears - 1 - whole);
    }
  }

  // --- Step 4: claim-age adjustment (per tranche, real £) ---
  const adjustTranches = (t: Tranches): { adjusted: Omit<AdjustedBranch, 'clamped'>; } => {
    // FS pension + automatic lump sum.
    let fsPension = t.fsPension;
    let fsLumpSum = t.fsLumpSum;
    if (section === 'npa60') {
      fsPension *= lookupFactor(ERF_NPA60, Math.max(0, 60 - claimAge));
      fsLumpSum *= lookupFactor(ERF_NPA60_LUMPSUM, Math.max(0, 60 - claimAge));
      // NPA60: no late-retirement uplift.
    } else {
      fsPension *= lookupFactor(ERF_NPA65_ER7, Math.max(0, 65 - claimAge));
      if (claimAge > 65) fsPension *= (1 + CARE_LATE_UPLIFT) ** (claimAge - 65);
      fsLumpSum = 0; // NPA65 has no automatic lump sum
    }

    // CARE pension.
    const carePre = t.carePension;
    let carePension = carePre;
    if (inServiceToClaim) {
      const standardReduction =
        1 -
        CARE_ACTIVE_STANDARD_REDUCTION *
          Math.min(3, Math.max(0, careNpa - Math.max(65, claimAge)));
      carePension *= lookupFactor(ERF_NPA65_ER7, Math.max(0, 65 - claimAge)) * standardReduction;
    } else {
      carePension *= lookupFactor(ERF_CARE_DEFERRED_ER8, Math.max(0, careNpa - claimAge));
    }
    if (claimAge > careNpa) carePension *= (1 + CARE_LATE_UPLIFT) ** (claimAge - careNpa);
    const careReductionPct = carePre > 0 ? (1 - carePension / carePre) * 100 : 0;

    // Additional Pension — always ER8 basis, same late uplift as CARE.
    let ap = t.apPension * lookupFactor(ERF_CARE_DEFERRED_ER8, Math.max(0, careNpa - claimAge));
    if (claimAge > careNpa) ap *= (1 + CARE_LATE_UPLIFT) ** (claimAge - careNpa);

    return {
      adjusted: {
        fsPension,
        carePension,
        apPension: ap,
        lumpSum: fsLumpSum,
        careReductionPct,
      },
    };
  };

  // --- Step 5: commutation (HMRC 25% cap) ---
  // Derivation (see report): total lump sum L = existingLS + 12c where c is the
  // pension commuted; residual pension = P0 - c. HMRC requires
  //   L ≤ 0.25 × (20·(P0 - c) + L)
  //   existingLS + 12c ≤ 0.25·existingLS + 3c + 5(P0 - c)
  //   0.75·existingLS + 14c ≤ 5·P0
  //   c ≤ (5·P0 - 0.75·existingLS) / 14
  // (The plan's /9 dropped the -5c term; the /14 form matches the plan's own
  // closed-form Lmax and the well-known "max lump sum ≈ 4.28× pension" rule.)
  const applyCommutation = (adj: Omit<AdjustedBranch, 'clamped'>): AdjustedBranch => {
    const requested = tps.commutedPension ?? 0;
    if (requested <= 0) return { ...adj, clamped: false };
    const p0 = adj.fsPension + adj.carePension + adj.apPension;
    const existingLS = adj.lumpSum;
    const maxC = Math.max(0, (5 * p0 - 0.75 * existingLS) / 14);
    let c = requested;
    let clamped = false;
    if (c > maxC) {
      c = maxC;
      clamped = true;
    }
    const ratio = p0 > 0 ? 1 - c / p0 : 1;
    return {
      fsPension: adj.fsPension * ratio,
      carePension: adj.carePension * ratio,
      apPension: adj.apPension * ratio,
      lumpSum: existingLS + COMMUTATION_RATE * c,
      clamped,
      careReductionPct: adj.careReductionPct,
    };
  };

  const evaluate = (t: Tranches): AdjustedBranch =>
    applyCommutation(adjustTranches(t).adjusted);

  const branchOutcome = (b: AdjustedBranch): TpsBranchOutcome => {
    const annualPensionReal = b.fsPension + b.carePension + b.apPension;
    const lumpSumReal = b.lumpSum;
    return {
      annualPensionReal,
      lumpSumReal,
      cumulativeRealToLifeExpectancy:
        lumpSumReal + annualPensionReal * Math.max(0, ctx.lifeExpectancy - claimAge),
    };
  };

  // --- Step 3 + 6: build one or two branches ---
  let chosen: AdjustedBranch;
  let mcCloudComparison: TpsComputedBenefits['mcCloudComparison'];

  if (tps.mcCloud) {
    const mcFsPension = tps.mcCloud.finalSalaryAnnualPension * (1 + fsReval) ** serviceYears;
    const mcFsLumpSum =
      section === 'npa60'
        ? (tps.mcCloud.finalSalaryLumpSum ?? 0) * (1 + fsReval) ** serviceYears
        : 0;
    const mcCarePension = tps.mcCloud.careAnnualPension * (1 + careReval) ** serviceYears;

    const fsBranch = evaluate({
      fsPension: baseFsPension + mcFsPension,
      fsLumpSum: baseFsLumpSum + mcFsLumpSum,
      carePension: baseCarePension,
      apPension,
    });
    const careBranch = evaluate({
      fsPension: baseFsPension,
      fsLumpSum: baseFsLumpSum,
      carePension: baseCarePension + mcCarePension,
      apPension,
    });

    const fsOut = branchOutcome(fsBranch);
    const careOut = branchOutcome(careBranch);
    const recommended =
      careOut.cumulativeRealToLifeExpectancy > fsOut.cumulativeRealToLifeExpectancy
        ? 'careerAverage'
        : 'finalSalary';

    // Breakeven: the branch with the bigger lump sum (usually FS) is ahead early;
    // find the age at which the other branch's higher pension catches up.
    // cumA(t) = LSa + Pa·t ; cross at t = (LSa - LSb)/(Pb - Pa), age = claimAge + t.
    let breakevenAge: number | null = null;
    const denomP = careOut.annualPensionReal - fsOut.annualPensionReal;
    if (Math.abs(denomP) > 1e-9) {
      const t = (fsOut.lumpSumReal - careOut.lumpSumReal) / denomP;
      const age = claimAge + t;
      breakevenAge = age > claimAge ? age : null;
    }

    const reasons: string[] = [];
    const r0 = Math.round(recommended === 'finalSalary' ? fsOut.cumulativeRealToLifeExpectancy : careOut.cumulativeRealToLifeExpectancy);
    const r1 = Math.round(recommended === 'finalSalary' ? careOut.cumulativeRealToLifeExpectancy : fsOut.cumulativeRealToLifeExpectancy);
    reasons.push(
      `${recommended === 'finalSalary' ? 'Final salary' : 'Career average'} gives the higher lifetime value at your claim age (£${r0.toLocaleString()} vs £${r1.toLocaleString()} to age ${ctx.lifeExpectancy}).`,
    );
    if (fsOut.lumpSumReal > 0) {
      reasons.push(`Final salary choice adds £${Math.round(fsOut.lumpSumReal).toLocaleString()} of tax-free automatic lump sum.`);
    }
    if (careBranch.careReductionPct > 0.5 && claimAge < careNpa) {
      reasons.push(
        `Career average is reduced ${Math.round(careBranch.careReductionPct)}% for claiming ${Math.round(careNpa - claimAge)} year(s) before its NPA of ${careNpa}; final salary is unreduced from age ${fsNpa}.`,
      );
    }
    if (claimAge >= careNpa) {
      reasons.push('Career average accrual (1/57) tends to outweigh final salary (1/80 or 1/60) when claiming at or after its normal pension age.');
    }
    reasons.push(
      `Salary growth assumption (${(g * 100).toFixed(1)}%) vs CPI+1.6% career-average revaluation ${fsReval > careReval ? 'favours final salary' : 'favours career average'}.`,
    );

    mcCloudComparison = { finalSalary: fsOut, careerAverage: careOut, recommended, breakevenAge, reasons };

    const pick = tps.mcCloud.choice === 'auto' ? recommended : tps.mcCloud.choice;
    chosen = pick === 'finalSalary' ? fsBranch : careBranch;
  } else {
    chosen = evaluate({
      fsPension: baseFsPension,
      fsLumpSum: baseFsLumpSum,
      carePension: baseCarePension,
      apPension,
    });
  }

  // --- Step 7: warnings ---
  if (claimAge < 55) {
    warnings.push('Claim age below 55 is not permitted by HMRC.');
  } else if (claimAge < ctx.minPensionAge) {
    warnings.push(
      `Claim age ${claimAge} is below your minimum pension age of ${ctx.minPensionAge}.`,
    );
  }
  if (section === 'npa60' && claimAge > 60) {
    warnings.push('NPA60 benefits get no late-retirement uplift — deferring past 60 forfeits payments.');
  }
  if (chosen.clamped) {
    warnings.push('Commutation clamped to HMRC 25% limit');
  }

  // --- Step 8: nominal conversion + streams ---
  const toNominal = (real: number) => real * (1 + cpi) ** (claimAge - now);
  const streams: TpsStream[] = [];
  if (chosen.fsPension !== 0) {
    streams.push({ label: 'TPS final salary', startAge: claimAge, annualPensionAtClaim: toNominal(chosen.fsPension) });
  }
  if (chosen.carePension !== 0) {
    streams.push({ label: 'TPS career average', startAge: claimAge, annualPensionAtClaim: toNominal(chosen.carePension) });
  }
  if (chosen.apPension !== 0) {
    streams.push({ label: 'TPS additional pension', startAge: claimAge, annualPensionAtClaim: toNominal(chosen.apPension) });
  }

  const totalAnnualPensionReal = chosen.fsPension + chosen.carePension + chosen.apPension;

  return {
    streams,
    totalLumpSumAtClaim: toNominal(chosen.lumpSum),
    totalAnnualPensionReal,
    mcCloudComparison,
    warnings,
  };
}
