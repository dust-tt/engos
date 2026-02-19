import {
  CompanyData,
  EngineerData,
  EngineerOutput,
  PeriodOutput,
  NewBonus,
  NewGrant,
} from "./types.js";

const ENGOS_START_DATE = "2025-09-01";

function parseDate(s: string): Date {
  return new Date(s + "T00:00:00");
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

/** Generate all period start dates (3/1 and 9/1) from startDate through endDate inclusive. */
export function generatePeriods(startDate: string, endDate: string): string[] {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const periods: string[] = [];

  for (let y = start.getFullYear(); y <= end.getFullYear() + 1; y++) {
    for (const m of ["03", "09"]) {
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
  if (engineer.lead_date && parseDate(engineer.lead_date) <= pd) {
    return 500000; // 10k/year → 5k per period
  }
  if (engineer.engineer_date && parseDate(engineer.engineer_date) <= pd) {
    return 250000; // 5k/year → 2.5k per period
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

/** Get the period boundary (3/1 or 9/1) just before a given date. */
function previousPeriodBoundary(date: string): Date {
  const d = parseDate(date);
  const year = d.getFullYear();

  const sep = parseDate(`${year}-09-01`);
  const mar = parseDate(`${year}-03-01`);

  if (d > sep) return sep;
  if (d > mar) return mar;
  return parseDate(`${year - 1}-09-01`);
}

export function computeCompensation(
  company: CompanyData,
  engineer: EngineerData,
  targetPeriodStart: string
): EngineerOutput {
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

    const yearlyBase = runningBase;

    // --- Check if this period has bonus ---
    const hasBonusThisPeriod =
      bonusStartDate !== null && periodDate >= bonusStartDate;

    // --- BONUS ---
    let regularBonus = 0;
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

      // Regular bonus for the period: 1/3 of 6-month base salary
      regularBonus = yearlyBase / 2 / 3;

      // Pro-rated bonus for first bonus period after engineer_date
      if (!proRatedBonusApplied) {
        proRatedBonusApplied = true;

        if (engineerDate) {
          const prevBoundary = previousPeriodBoundary(periodStart);
          if (engineerDate >= prevBoundary && engineerDate < periodDate) {
            proRateDays = daysBetween(engineerDate, periodDate);
            // Pro-rate using pre-increase base
            proRateBonus = (baseBefore / 3) * (proRateDays / 365);
          }
        }
      }
    }

    const totalPeriodBonus = regularBonus + proRateBonus;

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
    // Regular: 4yr grant vesting over 6 months
    const fourYearPeriodCash = fourYearMonthlyCash * 6;
    const regularRemaining = Math.max(0, regularBonus - fourYearPeriodCash);

    // Prorate: 4yr grant vesting over the prorate days
    const fourYearProRateCash =
      proRateDays > 0 ? (fourYearMonthlyCash * 12 * proRateDays) / 365 : 0;
    const proRateRemaining = Math.max(0, proRateBonus - fourYearProRateCash);

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
      base_cash_cents: Math.round(yearlyBase / 12),
      bonus_total_cents: Math.round(regularBonus / 6),
      bonus_cash_cents: Math.round(regularCashPeriod / 6),
      bonus_equity_options_count: Math.round(regularEquityOptions / 6),
      bonus_equity_cash_cents: Math.round(regularEquityPeriod / 6),
      "4_year_grant_equity_options_count": Math.round(fourYearMonthlyOptions),
      "4_year_grant_equity_cash_cents": Math.round(fourYearMonthlyCash),
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
    const totalBonusCash = Math.round(totalCashPeriod);
    if (totalBonusCash > 0) {
      newBonus = {
        regular_value_cents: Math.round(regularCashPeriod),
        prorate_value_cents: Math.round(proRateCashPeriod),
        value_cents: totalBonusCash,
      };
    }

    // --- New grant ---
    let newGrant: NewGrant | null = null;
    const totalEquityOptionsRounded = Math.round(totalEquityOptions);
    if (totalEquityOptionsRounded > 0) {
      newGrant = {
        regular_options_count: Math.round(regularEquityOptions),
        regular_value_cents: Math.round(regularEquityPeriod),
        prorate_options_count: Math.round(proRateEquityOptions),
        prorate_value_cents: Math.round(proRateEquityPeriod),
        options_count: totalEquityOptionsRounded,
        value_cents: Math.round(totalEquityPeriod),
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
