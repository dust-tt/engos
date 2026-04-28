import {
  CompanyData,
  EngineerData,
  EngineerOutput,
  PeriodOutput,
  NewBonus,
  NewGrant,
} from "./types.js";

const ENGOS_START_DATE = "2025-05-01";
const BASE_SALARY_CAP_CENTS = 130_000_00; // 130k EUR/year
export const RATIO_MINIMUM = 0.5;

function validateBonusEquityRatio(ratio: number, context: string): void {
  if (!Number.isFinite(ratio) || ratio < RATIO_MINIMUM || ratio > 1) {
    throw new Error(
      `${context}: bonus_equity_ratio must be between ${RATIO_MINIMUM} and 1`
    );
  }
}

function parseDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

function formatDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Generate all period start dates (5/1 and 11/1) from startDate through endDate inclusive. */
export function generatePeriods(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const periods: string[] = [];

  for (let y = start.getFullYear(); y <= end.getFullYear() + 1; y++) {
    for (const m of ["05", "11"]) {
      const d = `${y}-${m}-01`;
      const pd = parseDate(d);
      if (pd >= start && pd <= end) {
        periods.push(d);
      }
    }
  }

  return periods;
}

/** Find the most recent options_price entry at or before the given date. */
export function getPreferredPriceAtDate(
  company: CompanyData,
  date: string
): number {
  const sorted = [...company.options_price].sort(
    (a, b) =>
      parseDate(a.start_date).getTime() - parseDate(b.start_date).getTime()
  );

  let result: number | null = null;
  for (const entry of sorted) {
    if (parseDate(entry.start_date) <= parseDate(date)) {
      result = entry.preferred_price_cents;
    }
  }

  if (result === null) {
    throw new Error(`No options_price entry found at or before ${date}`);
  }

  return result;
}

/** Get the raise amount (yearly cents) based on engineer status at a period. */
function getRaisePerPeriod(
  engineer: EngineerData,
  periodStart: string
): number {
  const pd = parseDate(periodStart);

  if (engineer.tenure_date && parseDate(engineer.tenure_date) <= pd) {
    return 750000; // 15k/year → 7.5k per period
  }
  if (engineer.engineer_date && parseDate(engineer.engineer_date) <= pd) {
    return 500000; // 10k/year → 5k per period
  }

  return 0; // still on trial
}

/** Find the most recent entry with start_date <= target. */
function findApplicableEntry<T extends { start_date: string }>(
  entries: T[],
  target: string
): T | null {
  let result: T | null = null;
  const targetDate = parseDate(target);
  for (const entry of entries) {
    if (parseDate(entry.start_date) <= targetDate) {
      if (
        !result ||
        parseDate(entry.start_date) > parseDate(result.start_date)
      ) {
        result = entry;
      }
    }
  }
  return result;
}

/** Get the period boundary (5/1 or 11/1) just before a given date. */
function previousPeriodBoundary(date: string): Date {
  const d = parseDate(date);
  const year = d.getFullYear();

  const nov = parseDate(`${year}-11-01`);
  const may = parseDate(`${year}-05-01`);

  if (d > nov) return nov;
  if (d > may) return may;
  return parseDate(`${year - 1}-11-01`);
}

function periodStartForMonth(year: number, month: number): string {
  if (month >= 5 && month <= 10) {
    return `${year}-05-01`;
  }
  if (month >= 11) {
    return `${year}-11-01`;
  }
  return `${year - 1}-11-01`;
}

function isActiveAt(engineer: EngineerData, date: Date): boolean {
  if (!engineer.end_date) {
    return true;
  }
  return date < parseDate(engineer.end_date);
}

export function computeCompensation(
  company: CompanyData,
  engineer: EngineerData,
  targetPeriodStart: string
): EngineerOutput {
  if (!isActiveAt(engineer, parseDate(targetPeriodStart))) {
    throw new Error(
      `Employee ended on ${engineer.end_date}; cannot compute period ${targetPeriodStart}`
    );
  }

  // Periods only start from ENGOS_START_DATE at the earliest
  const effectiveStart =
    engineer.start_date > ENGOS_START_DATE
      ? engineer.start_date
      : ENGOS_START_DATE;
  const periods = generatePeriods(effectiveStart, targetPeriodStart);

  if (periods.length === 0) {
    return { periods: [] };
  }

  const engosStart = parseDate(ENGOS_START_DATE);
  const engineerDate = engineer.engineer_date
    ? parseDate(engineer.engineer_date)
    : null;

  // Earliest date from which bonus splits are required
  const bonusStartDate = engineerDate
    ? new Date(Math.max(engosStart.getTime(), engineerDate.getTime()))
    : null;

  // Track running base salary across periods
  let runningBase = 0;
  let lastBaseEntryDate: string | null = null;
  let proRatedBonusApplied = false;

  const output: PeriodOutput[] = [];

  for (let i = 0; i < periods.length; i++) {
    const periodStart = periods[i];
    const periodDate = parseDate(periodStart);

    // --- BASE SALARY ---
    const baseEntry = findApplicableEntry(engineer.base_salaries, periodStart);
    if (!baseEntry) {
      throw new Error(`No base salary entry found at or before ${periodStart}`);
    }

    let baseBefore: number; // base before this period's raise

    if (
      lastBaseEntryDate === null ||
      baseEntry.start_date !== lastBaseEntryDate
    ) {
      // New base entry
      runningBase = baseEntry.yearly_cash_cents;
      lastBaseEntryDate = baseEntry.start_date;

      if (parseDate(baseEntry.start_date) < periodDate) {
        // Entry is before this period — apply raise
        baseBefore = runningBase;
        runningBase += getRaisePerPeriod(engineer, periodStart);
      } else {
        // Entry is at this period — no raise
        baseBefore = runningBase;
      }
    } else {
      // Same base entry, accumulate raise
      baseBefore = runningBase;
      runningBase += getRaisePerPeriod(engineer, periodStart);
    }

    const uncappedYearlyBase = runningBase;
    const yearlyBaseOverflow = Math.max(
      0,
      uncappedYearlyBase - BASE_SALARY_CAP_CENTS
    );
    const yearlyBase = Math.min(uncappedYearlyBase, BASE_SALARY_CAP_CENTS);

    // --- Check if this period has bonus ---
    const hasBonusThisPeriod =
      bonusStartDate !== null && periodDate >= bonusStartDate;

    // --- BONUS ---
    let regularBonusCore = 0;
    let regularBonusOverflow = 0;
    let regularBonus = 0;
    let proRateBonusCore = 0;
    let proRateBonusOverflow = 0;
    let proRateBonus = 0;
    let proRateDays = 0;
    let bonusEquityRatio = 0;

    if (hasBonusThisPeriod) {
      // Look up bonus split
      const bonusSplit = findApplicableEntry(
        engineer.period_bonus_splits,
        periodStart
      );
      if (!bonusSplit) {
        throw new Error(
          `Missing period_bonus_splits entry for period ${periodStart}`
        );
      }
      bonusEquityRatio = bonusSplit.bonus_equity_ratio;
      validateBonusEquityRatio(
        bonusEquityRatio,
        `Invalid period_bonus_splits entry for period ${periodStart}`
      );

      // Regular bonus for the period:
      // 1) Standard bonus based on computed (uncapped) base
      // 2) Plus overflow from capped base redirected to bonus
      regularBonusCore = uncappedYearlyBase / 2 / 3;
      regularBonusOverflow = yearlyBaseOverflow / 2;
      regularBonus = regularBonusCore + regularBonusOverflow;

      // Pro-rated bonus for first bonus period after engineer_date
      if (!proRatedBonusApplied) {
        proRatedBonusApplied = true;

        if (engineerDate) {
          const prevBoundary = previousPeriodBoundary(periodStart);
          if (engineerDate >= prevBoundary && engineerDate < periodDate) {
            proRateDays = daysBetween(engineerDate, periodDate);
            // Pro-rate using pre-increase base, plus redirected overflow
            const baseBeforeOverflow = Math.max(
              0,
              baseBefore - BASE_SALARY_CAP_CENTS
            );
            proRateBonusCore = (baseBefore / 3) * (proRateDays / 365);
            proRateBonusOverflow = baseBeforeOverflow * (proRateDays / 365);
            proRateBonus = proRateBonusCore + proRateBonusOverflow;
          }
        }
      }
    }

    // --- 4-YEAR GRANTS ---
    let fourYearMonthlyOptions = 0;
    let fourYearMonthlyCash = 0;
    const preferredPrice = getPreferredPriceAtDate(company, periodStart);

    for (const grant of engineer["4_year_grants"]) {
      const grantStart = parseDate(grant.start_date);
      const grantEnd = new Date(grantStart);
      grantEnd.setMonth(grantEnd.getMonth() + 48);

      if (periodDate >= grantStart && periodDate < grantEnd) {
        const monthlyOptions = grant.options_count / 48;
        fourYearMonthlyOptions += monthlyOptions;
        fourYearMonthlyCash += monthlyOptions * preferredPrice;
      }
    }

    // --- Subtract 4yr grant cash from each bonus portion independently ---
    // Note: overflow from the base cap is preserved and not offset by 4yr grants.
    // Regular: 4yr grant vesting over 6 months (core bonus component only)
    const fourYearPeriodCash = fourYearMonthlyCash * 6;
    const regularCoreRemaining = Math.max(
      0,
      regularBonusCore - fourYearPeriodCash
    );
    const regularRemaining = regularCoreRemaining + regularBonusOverflow;

    // Prorate: 4yr grant vesting over the prorate days (core bonus component only)
    const fourYearProRateCash =
      proRateDays > 0 ? (fourYearMonthlyCash * 12 * proRateDays) / 365 : 0;
    const proRateCoreRemaining = Math.max(
      0,
      proRateBonusCore - fourYearProRateCash
    );
    const proRateRemaining = proRateCoreRemaining + proRateBonusOverflow;

    // --- Split remaining bonus between cash and equity ---
    const regularCashPeriod = regularRemaining * (1 - bonusEquityRatio);
    const regularEquityPeriod = regularRemaining * bonusEquityRatio;
    const proRateCashPeriod = proRateRemaining * (1 - bonusEquityRatio);
    const proRateEquityPeriod = proRateRemaining * bonusEquityRatio;

    const totalCashPeriod = regularCashPeriod + proRateCashPeriod;
    const totalEquityPeriod = regularEquityPeriod + proRateEquityPeriod;

    // Convert equity portions to options
    const regularEquityOptions =
      preferredPrice > 0 ? regularEquityPeriod / preferredPrice : 0;
    const proRateEquityOptions =
      preferredPrice > 0 ? proRateEquityPeriod / preferredPrice : 0;
    const totalEquityOptions = regularEquityOptions + proRateEquityOptions;

    // --- Compute monthly values (regular only, steady-state) ---
    const monthly = {
      base_cash_cents: Math.ceil(yearlyBase / 12),
      bonus_total_cents: Math.ceil(regularBonus / 6),
      bonus_cash_cents: Math.ceil(regularCashPeriod / 6),
      bonus_equity_options_count: Math.ceil(regularEquityOptions / 6),
      bonus_equity_cash_cents: Math.ceil(regularEquityPeriod / 6),
      "4_year_grant_equity_options_count": Math.ceil(fourYearMonthlyOptions),
      "4_year_grant_equity_cash_cents": Math.ceil(fourYearMonthlyCash),
      total_cash_cents: 0,
    };
    monthly.total_cash_cents =
      monthly.base_cash_cents +
      monthly.bonus_cash_cents +
      monthly.bonus_equity_cash_cents +
      monthly["4_year_grant_equity_cash_cents"];

    // --- Yearly = monthly * 12 ---
    const yearly = {
      base_cash_cents: monthly.base_cash_cents * 12,
      bonus_total_cents: monthly.bonus_total_cents * 12,
      bonus_cash_cents: monthly.bonus_cash_cents * 12,
      bonus_equity_options_count: monthly.bonus_equity_options_count * 12,
      bonus_equity_cash_cents: monthly.bonus_equity_cash_cents * 12,
      "4_year_grant_equity_options_count":
        monthly["4_year_grant_equity_options_count"] * 12,
      "4_year_grant_equity_cash_cents":
        monthly["4_year_grant_equity_cash_cents"] * 12,
      total_cash_cents: monthly.total_cash_cents * 12,
    };

    // --- New bonus (period cash bonus to pay) ---
    let newBonus: NewBonus | null = null;
    const totalBonusCash = Math.ceil(totalCashPeriod);
    if (totalBonusCash > 0) {
      newBonus = {
        regular_value_cents: Math.ceil(regularCashPeriod),
        prorate_value_cents: Math.ceil(proRateCashPeriod),
        value_cents: totalBonusCash,
      };
    }

    // --- New grant ---
    let newGrant: NewGrant | null = null;
    const totalEquityOptionsRounded = Math.ceil(totalEquityOptions);
    if (totalEquityOptionsRounded > 0) {
      newGrant = {
        regular_options_count: Math.ceil(regularEquityOptions),
        regular_value_cents: Math.ceil(regularEquityPeriod),
        prorate_options_count: Math.ceil(proRateEquityOptions),
        prorate_value_cents: Math.ceil(proRateEquityPeriod),
        options_count: totalEquityOptionsRounded,
        value_cents: Math.ceil(totalEquityPeriod),
      };
    }

    output.push({
      start_date: periodStart,
      monthly,
      yearly,
      new_bonus: newBonus,
      new_grant: newGrant,
    });
  }

  return { periods: output };
}

/** Compute full months between two dates (e.g. Jan 15 → Mar 15 = 2 months). */
function fullMonthsBetween(start: Date, end: Date): number {
  const years = end.getFullYear() - start.getFullYear();
  const months = end.getMonth() - start.getMonth();
  let total = years * 12 + months;
  if (end.getDate() < start.getDate()) {
    total -= 1;
  }
  return Math.max(0, total);
}

export interface ProjectionYear {
  year: number;
  preferred_price_cents: number;
  yearly_base_cents: number;
  yearly_bonus_cash_cents: number;
  yearly_cash_total_cents: number;
  options_vested: number;
  value_cents: number;
}

/**
 * Project forward equity ownership through 2030, simulating fundraise events.
 * The preferred price increases by `preferredMultiplier` every `fundraisePeriodMonths`.
 * Bonus-to-equity conversion at each period uses the projected preferred price at that time.
 */
export function projectEquity(
  company: CompanyData,
  engineer: EngineerData,
  bonusEquityRatio: number,
  preferredMultiplier: number = 3,
  fundraisePeriodMonths: number = 18
): ProjectionYear[] {
  validateBonusEquityRatio(
    bonusEquityRatio,
    "Invalid jazz ratio parameter"
  );

  // Find most recent fundraise
  const sorted = [...company.options_price].sort(
    (a, b) =>
      parseDate(a.start_date).getTime() - parseDate(b.start_date).getTime()
  );
  const lastFundraise = sorted[sorted.length - 1];
  let lastDate = parseDate(lastFundraise.start_date);
  let lastPreferred = lastFundraise.preferred_price_cents;
  let lastStrike = lastFundraise.strike_price_cents;

  // Generate projected fundraise events
  const projectedPrices = [...company.options_price];
  const endDate = parseDate("2031-01-01");

  while (true) {
    const nextDate = new Date(lastDate);
    nextDate.setMonth(nextDate.getMonth() + fundraisePeriodMonths);
    if (nextDate >= endDate) break;

    lastPreferred = Math.round(lastPreferred * preferredMultiplier);
    lastStrike = Math.round(lastStrike * preferredMultiplier);

    projectedPrices.push({
      start_date: formatDateStr(nextDate),
      strike_price_cents: lastStrike,
      preferred_price_cents: lastPreferred,
    });

    lastDate = nextDate;
  }

  const projectedCompany: CompanyData = { options_price: projectedPrices };

  // Override bonus splits
  const modifiedEngineer: EngineerData = {
    ...engineer,
    period_bonus_splits: [
      {
        start_date: "2020-01-01",
        bonus_equity_ratio: bonusEquityRatio,
      },
    ],
  };

  // Run compensation with projected company data
  const targetPeriod = "2030-11-01";
  const result = computeCompensation(
    projectedCompany,
    modifiedEngineer,
    targetPeriod
  );

  const years = [2026, 2027, 2028, 2029, 2030];
  const projections: ProjectionYear[] = [];

  for (const year of years) {
    const yearEnd = new Date(year, 11, 31); // Dec 31
    const yearEndStr = `${year}-12-31`;
    let totalOptions = 0;

    // 4yr grant vesting
    for (const grant of engineer["4_year_grants"]) {
      const grantStart = parseDate(grant.start_date);
      const months = fullMonthsBetween(grantStart, yearEnd);
      const vestedMonths = Math.min(months, 48);
      totalOptions += (grant.options_count / 48) * vestedMonths;
    }

    // New grants from periods (vest over 6 months)
    for (const period of result.periods) {
      if (period.new_grant && period.new_grant.options_count > 0) {
        const grantStart = parseDate(period.start_date);
        const months = fullMonthsBetween(grantStart, yearEnd);
        const vestedMonths = Math.min(months, 6);
        totalOptions += (period.new_grant.options_count / 6) * vestedMonths;
      }
    }

    totalOptions = Math.ceil(totalOptions);
    const preferredAtYearEnd = getPreferredPriceAtDate(
      projectedCompany,
      yearEndStr
    );

    // Find the last period in this year for base/bonus values
    let yearlyBase = 0;
    let yearlyBonusCash = 0;
    for (const period of result.periods) {
      if (period.start_date.startsWith(String(year))) {
        yearlyBase = period.yearly.base_cash_cents;
        yearlyBonusCash = period.yearly.bonus_cash_cents;
      }
    }
    const yearlyCashTotal = yearlyBase + yearlyBonusCash;

    projections.push({
      year,
      preferred_price_cents: preferredAtYearEnd,
      yearly_base_cents: yearlyBase,
      yearly_bonus_cash_cents: yearlyBonusCash,
      yearly_cash_total_cents: yearlyCashTotal,
      options_vested: totalOptions,
      value_cents: totalOptions * preferredAtYearEnd,
    });
  }

  return projections;
}

export interface ModelMonth {
  month: string;
  engineers_count: number;
  base_salary_cents: number;
  is_period_start: boolean;
  bonus_cash_cents: number;
  equity_options_count: number;
  equity_value_cents: number;
}

/**
 * Aggregate compensation model across all engineers for the next 12 months.
 * Shows monthly base salary and bonus/equity payments on period starts.
 */
export function computeModel(
  company: CompanyData,
  engineers: EngineerData[]
): ModelMonth[] {
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  // Build list of next 12 months
  const months: { year: number; month: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(startMonth);
    d.setMonth(d.getMonth() + i);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }

  // Compute target period: the period covering the last month
  const last = months[months.length - 1];
  let targetYear = last.year;
  let targetMonth: string;
  if (last.month >= 11) {
    targetYear += 1;
    targetMonth = "05";
  } else if (last.month >= 5) {
    targetMonth = "11";
  } else {
    targetMonth = "05";
  }
  const targetPeriodStart = `${targetYear}-${targetMonth}-01`;

  // Compute each engineer (skip those that error)
  const allResults: { engineer: EngineerData; result: EngineerOutput }[] = [];
  for (const eng of engineers) {
    try {
      const engineerTargetPeriod = eng.end_date
        ? formatDateStr(previousPeriodBoundary(eng.end_date))
        : targetPeriodStart;
      const target =
        engineerTargetPeriod < targetPeriodStart
          ? engineerTargetPeriod
          : targetPeriodStart;
      const result = computeCompensation(company, eng, target);
      allResults.push({ engineer: eng, result });
    } catch {
      // Skip engineers that can't be computed (missing data, etc.)
    }
  }

  const output: ModelMonth[] = [];

  for (const { year, month } of months) {
    const monthStr = `${year}-${String(month).padStart(2, "0")}`;

    // Which period covers this month?
    const periodStart = periodStartForMonth(year, month);

    const isPeriodStart = month === 5 || month === 11;
    const monthStart = parseDate(`${monthStr}-01`);

    let totalBase = 0;
    let totalBonusCash = 0;
    let totalEquityOptions = 0;
    let totalEquityValue = 0;
    let engineersCount = 0;

    for (const { engineer, result } of allResults) {
      if (!isActiveAt(engineer, monthStart)) {
        continue;
      }

      const period = result.periods.find((p) => p.start_date === periodStart);
      if (period) {
        engineersCount++;
        totalBase += period.monthly.base_cash_cents;

        if (isPeriodStart) {
          if (period.new_bonus) {
            totalBonusCash += period.new_bonus.value_cents;
          }
          if (period.new_grant) {
            totalEquityOptions += period.new_grant.options_count;
            totalEquityValue += period.new_grant.value_cents;
          }
        }
      }
    }

    output.push({
      month: monthStr,
      engineers_count: engineersCount,
      base_salary_cents: totalBase,
      is_period_start: isPeriodStart,
      bonus_cash_cents: totalBonusCash,
      equity_options_count: totalEquityOptions,
      equity_value_cents: totalEquityValue,
    });
  }

  return output;
}
