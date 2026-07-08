import { describe, it, expect } from 'vitest';
import {
  lookupFactor, minPensionAge, memberContributionRate,
  ERF_NPA60, ERF_NPA65_ER7,
} from './tpsFactors';

describe('tpsFactors', () => {
  describe('lookupFactor', () => {
    it('exact row match', () => {
      expect(lookupFactor(ERF_NPA65_ER7, 5)).toBe(0.793);
    });

    it('interpolation between rows', () => {
      // yearsEarly 6 is midpoint between 5 (0.793) and 7 (0.729)
      // factor = 0.793 + 0.5 * (0.729 - 0.793) = 0.761
      expect(lookupFactor(ERF_NPA65_ER7, 6)).toBeCloseTo(0.761, 3);
    });

    it('clamp above table range', () => {
      expect(lookupFactor(ERF_NPA60, 8)).toBe(0.827);
    });

    it('exact zero', () => {
      expect(lookupFactor(ERF_NPA60, 0)).toBe(1.0);
    });

    it('negative yearsEarly', () => {
      expect(lookupFactor(ERF_NPA60, -5)).toBe(1.0);
    });
  });

  describe('minPensionAge', () => {
    it('born before 1973-04-06', () => {
      expect(minPensionAge('1972-01-01')).toBe(55);
    });

    it('born on/after 1973-04-06', () => {
      expect(minPensionAge('1980-06-15')).toBe(57);
    });
  });

  describe('memberContributionRate', () => {
    it('salary 30000', () => {
      expect(memberContributionRate(30000)).toBe(7.4);
    });

    it('salary 50000', () => {
      expect(memberContributionRate(50000)).toBe(9.9);
    });

    it('salary 120000', () => {
      expect(memberContributionRate(120000)).toBe(12.0);
    });
  });
});
