# FinTrack — Future Development

Pruned 2026-07-06 after the calculator audit: the previous Bugs section (growth
discontinuity, property growth rate, no drawdown modelling) and the shipped
features (contribution modelling, tax wrappers, tax-band drawdown, drawdown
sequencing, lump-sum allowance, scenario analysis, real-terms view, Coast FIRE)
were all done and have been removed.

## High Priority

### CGT cost-basis tracking
`calculateCGT` assumes a flat 50% of every GIA withdrawal is gains. Track cost
basis per fund so the gains fraction rises realistically over long horizons
(understates tax late, overstates it on freshly-funded GIAs).

### Dividend / interest tax on GIA
GIA holdings pay dividend tax (£500 allowance, 8.75/33.75%) and interest is
income-taxed. Currently only CGT on withdrawal is modelled.

### ISA-trickle for lump sums
The 25% pension lump sum now lands in a GIA (the £20k/yr ISA limit makes an
instant ISA transfer impossible). Model an annual £20k GIA→ISA "bed and ISA"
trickle — also applies to the planned GIA lump-sum inflows.

## Medium Priority

### Stress-test calculator uses a static growth mix
`stressTestCalculator.ts:12-27` weights growth by today's accessible balances;
should reweight per-year like the main engine now does.

### Savings Rate Tracking
Input income and expenses to calculate savings rate. (Income/expense records
exist but only one of each is populated — the report's spending assumption is
the least-verified input.)

### Barista FIRE milestone
Coast FIRE shipped; Barista (cover current expenses only, investments handle
retirement) remains.

### State Pension improvements
- Default to the current full new State Pension (~£12,000 in 2026)
- Rising SP age (67 from 2026-28, likely 68)
- Partial SP by NI qualifying years; triple-lock modelling

### Birthday-accurate ages
Ages are calendar-year based (`year - birthYear`); a mid-year birthday shifts
everything by up to 6 months. Also: the target-age input allows fractional
values (e.g. 48.1) — round or validate in the UI (the engine now rounds for
Coast FIRE).

## Low Priority

### Monte Carlo Simulation
Deterministic single-path growth today; show 10th/50th/90th percentile outcomes
and sequence-of-returns risk. (The stress-test tab covers named scenarios.)

### Fiscal drag option
Tax bands are held at today's values forever; add an option to freeze bands in
nominal terms (thresholds unindexed) to model fiscal drag.

### Bank/Broker API Integration
Open Banking or Plaid integration to auto-populate fund values.

### Data Entry Improvements
- Bulk copy from previous month as starting point
- Validation that entered amounts are reasonable (flag >20% MoM change)
- Currency formatting in input fields

### Chart Improvements
- Date range filtering on all charts
- Toggle individual funds on/off
- Percentage growth view; export chart as image

### Import Improvements
- Column mapping interface, validation preview, CSV template, undo/rollback
