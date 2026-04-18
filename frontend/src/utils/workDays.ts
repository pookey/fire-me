/**
 * Calculate work days between two dates, excluding weekends,
 * UK bank holidays, and annual leave (prorated for current year).
 */

/** Compute Easter Sunday for a given year using the Anonymous Gregorian algorithm */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/** If date falls on weekend, substitute to the next Monday */
function substituteIfWeekend(date: Date): Date {
  const day = date.getDay();
  if (day === 6) return addDays(date, 2); // Sat -> Mon
  if (day === 0) return addDays(date, 1); // Sun -> Mon
  return date;
}

/** If Boxing Day substitute clashes with another substitute, push to Tuesday */
function boxingDaySubstitute(year: number): Date {
  const christmas = new Date(year, 11, 25);
  const boxing = new Date(year, 11, 26);
  const christmasDay = christmas.getDay();

  if (christmasDay === 5) return new Date(year, 11, 28); // Fri: Boxing=Sat->Mon=28
  if (christmasDay === 6) return new Date(year, 11, 28); // Sat: Christmas->Mon27, Boxing->Tue28
  if (christmasDay === 0) return new Date(year, 11, 28); // Sun: Christmas->Mon26, Boxing->Tue28
  return substituteIfWeekend(boxing);
}

/** Get all UK (England & Wales) bank holidays for a given year */
function ukBankHolidays(year: number): Set<string> {
  const holidays: Date[] = [];

  // New Year's Day
  holidays.push(substituteIfWeekend(new Date(year, 0, 1)));

  // Good Friday & Easter Monday
  const easter = easterSunday(year);
  holidays.push(addDays(easter, -2)); // Good Friday
  holidays.push(addDays(easter, 1));  // Easter Monday

  // Early May Bank Holiday (first Monday in May)
  const may1 = new Date(year, 4, 1);
  const earlyMayOffset = (8 - may1.getDay()) % 7;
  holidays.push(new Date(year, 4, 1 + earlyMayOffset));

  // Spring Bank Holiday (last Monday in May)
  const may31 = new Date(year, 4, 31);
  const springOffset = (may31.getDay() + 6) % 7;
  holidays.push(new Date(year, 4, 31 - springOffset));

  // Summer Bank Holiday (last Monday in August)
  const aug31 = new Date(year, 7, 31);
  const summerOffset = (aug31.getDay() + 6) % 7;
  holidays.push(new Date(year, 7, 31 - summerOffset));

  // Christmas Day
  holidays.push(substituteIfWeekend(new Date(year, 11, 25)));

  // Boxing Day
  holidays.push(boxingDaySubstitute(year));

  return new Set(holidays.map(d => d.toISOString().slice(0, 10)));
}

function toDateStr(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Count calendar days from start (inclusive) to end (exclusive) */
export function calendarDaysUntil(from: Date, to: Date): number {
  const msPerDay = 86400000;
  const fromMidnight = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const toMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.max(0, Math.round((toMidnight.getTime() - fromMidnight.getTime()) / msPerDay));
}

/**
 * Count work days from `from` to `to` (exclusive of `to`),
 * excluding weekends, UK bank holidays, and prorated annual leave.
 *
 * Annual leave: 30 days/year. For the current year (year of `from`),
 * assumes leave used proportionally to how far through the year we are.
 * Remaining leave days in current year are subtracted from work days.
 * Full 30 days subtracted for each subsequent full year.
 */
export function workDaysUntil(from: Date, to: Date, annualLeave: number = 30): number {
  const totalCalendarDays = calendarDaysUntil(from, to);
  if (totalCalendarDays <= 0) return 0;

  // Collect all bank holidays for relevant years
  const startYear = from.getFullYear();
  const endYear = to.getFullYear();
  const allHolidays = new Set<string>();
  for (let y = startYear; y <= endYear; y++) {
    for (const h of ukBankHolidays(y)) {
      allHolidays.add(h);
    }
  }

  // Count weekdays excluding bank holidays
  let workDays = 0;
  const cursor = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const endMidnight = new Date(to.getFullYear(), to.getMonth(), to.getDate());

  while (cursor < endMidnight) {
    const dow = cursor.getDay();
    if (dow !== 0 && dow !== 6 && !allHolidays.has(toDateStr(cursor))) {
      workDays++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  // Subtract annual leave
  // Current year: prorate remaining leave
  const yearStart = new Date(startYear, 0, 1);
  const yearEnd = new Date(startYear + 1, 0, 1);
  const yearProgress = (from.getTime() - yearStart.getTime()) / (yearEnd.getTime() - yearStart.getTime());
  const leaveUsedThisYear = Math.round(annualLeave * yearProgress);
  const leaveRemainingThisYear = annualLeave - leaveUsedThisYear;

  // How many work days fall in the current year?
  const currentYearEnd = new Date(Math.min(yearEnd.getTime(), endMidnight.getTime()));
  const currentYearCalDays = calendarDaysUntil(from, currentYearEnd);

  if (currentYearCalDays > 0) {
    workDays -= Math.min(leaveRemainingThisYear, workDays);
  }

  // Full years after current year
  for (let y = startYear + 1; y <= endYear; y++) {
    const yStart = new Date(y, 0, 1);
    const yEnd = new Date(y + 1, 0, 1);
    if (yStart < endMidnight) {
      const yearEndCapped = new Date(Math.min(yEnd.getTime(), endMidnight.getTime()));
      const daysInThisChunk = calendarDaysUntil(yStart, yearEndCapped);
      const fullYearDays = calendarDaysUntil(yStart, yEnd);
      const proportion = daysInThisChunk / fullYearDays;
      workDays -= Math.round(annualLeave * proportion);
    }
  }

  return Math.max(0, workDays);
}
