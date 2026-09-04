import {
  CompanyData,
  EngineerData,
  EngineerOutput,
  PeriodOutput,
  NewBase,
  NewBonus,
  NewGrant,
} from "./types.js";

/**
 * @cc [author:spolu,label:periods] engos-start-date
 * `ENGOS_START_DATE` must be `2025-11-01`, the earliest period boundary used to backfill
 * compensation acceleration.
 */
const ENGOS_START_DATE = "2025-11-01";

/**
 * @cc [author:spolu,label:periods,label:4_year_grants] engos-effective-date
 * `ENGOS_EFFECTIVE_DATE` must be `2026-05-01`, the date from which EngOS eligibility rules are
 * enforced for newly starting engineers.
 */
const ENGOS_EFFECTIVE_DATE = "2026-05-01";

/**
 * @cc [author:spolu,label:base_salary_and_raise] base-salary-cap
 * Annual base cash must be capped at 13,500,000 EUR cents; uncapped excess remains eligible for
 * the base-overflow bonus.
 */
const BASE_SALARY_CAP_CENTS = 135_000_00;

/**
 * @cc [author:spolu,label:equity_split,label:jazz_parameters] minimum-standard-equity-ratio
 * A standard bonus equity ratio must be finite and within the inclusive range `[0.5, 1]`.
 */
export const RATIO_MINIMUM = 0.5;

function validateBonusEquityRatio(ratio: number, context: string): void {
  if (!Number.isFinite(ratio) || ratio < RATIO_MINIMUM || ratio > 1) {
    throw new Error(
      `${context}: bonus_equity_ratio must be between ${RATIO_MINIMUM} and 1`
    );
  }
}

function validateOverflowEquityRatio(ratio: number, context: string): void {
  if (!Number.isFinite(ratio) || ratio < 0 || ratio > 1) {
    throw new Error(`${context}: overflow_equity_ratio must be between 0 and 1`);
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

/**
 * @cc [author:spolu,label:periods] compensation-period-calendar
 * The returned periods must be the May 1 and November 1 boundaries within the inclusive
 * `startDate` to `endDate` range, in chronological order.
 */
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

/**
 * @cc [author:spolu,label:equity_split,label:jazz_simulation] preferred-price-selection
 * The preferred price at a date must come from the latest `options_price` entry whose
 * `start_date` is at or before that date, regardless of input order.
 */
/**
 * @cc [author:spolu,label:equity_split,label:jazz_simulation] preferred-price-required
 * The lookup must fail when no `options_price` entry exists at or before the requested date.
 */
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

/**
 * @cc [author:spolu,label:base_salary_and_raise] status-raise-per-period
 * The annual base raise for one six-month period must be 750,000 EUR cents when
 * `tenure_date <= periodStart`, otherwise 500,000 when `engineer_date <= periodStart`, and zero
 * otherwise.
 */
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

/**
 * @cc [author:spolu,label:output_values] compensation-monetary-unit
 * Every monetary input and output consumed or produced by this calculation is denominated in EUR
 * cents.
 */
/**
 * @cc [author:spolu,label:periods] compensation-period-range
 * The calculation must recompute every compensation period from the later of
 * `ENGOS_START_DATE` and `engineer.start_date` through `targetPeriodStart`, inclusively.
 */
/**
 * @cc [author:spolu,label:periods] ended-engineer-period
 * The calculation must reject a `targetPeriodStart` at or after a non-null `engineer.end_date`.
 */
/**
 * @cc [author:spolu,label:base_salary_and_raise] base-salary-baseline
 * Each period must use the latest applicable `base_salaries` entry as its baseline, restart raise
 * accumulation when that entry changes, apply no raise when it starts on the period boundary, and
 * apply the current period's raise when it starts earlier.
 */
/**
 * @cc [author:spolu,label:bonus_computation] regular-period-bonus
 * When `engineer_date <= periodStart`, `regularBonusCore` must be
 * `uncappedYearlyBase / 2 / 2`, otherwise zero; `regularBonusOverflow` must always be
 * `Math.max(0, uncappedYearlyBase - BASE_SALARY_CAP_CENTS) / 2`, including before
 * `engineer_date`.
 */
/**
 * @cc [author:spolu,label:bonus_computation] regular-bonus-output
 * Before four-year-grant deduction and equity splitting, `monthly.bonus_total_cents` must be
 * `Math.ceil(regularBonus / 6)` and `yearly.bonus_total_cents` must be
 * `monthly.bonus_total_cents * 12`.
 */
/**
 * @cc [author:spolu,label:bonus_computation,label:equity_split] bonus-split-selection
 * A bonus-bearing period must use the latest applicable `period_bonus_splits` entry and fail when
 * none exists; `bonus_equity_ratio` must be in `[RATIO_MINIMUM, 1]`, while
 * `overflow_equity_ratio` defaults to it and must be in `[0, 1]`.
 */
/**
 * @cc [author:spolu,label:pro_rated_bonus] first-bonus-prorate
 * When `engineer_date` is on or after the preceding boundary and before the first standard-bonus
 * period, that period must add exactly one prorate with
 * `proRateBonusCore = (baseBefore / 2) * (proRateDays / 365)` and
 * `proRateBonusOverflow = Math.max(0, baseBefore - BASE_SALARY_CAP_CENTS) * (proRateDays / 365)`,
 * where `proRateDays` is the calendar-day gap from `engineer_date` to the period start.
 */
/**
 * @cc [author:spolu,label:4_year_grants] four-year-grant-valuation
 * For each `4_year_grants` entry active from its `start_date` until, but excluding,
 * `start_date + 48 months`, `monthlyOptions` must be `grant.options_count / 48` and its monthly
 * cash equivalent must be `monthlyOptions * preferredPrice`; the sums for all active grants must
 * populate `4_year_grant_equity_options_count` and `4_year_grant_equity_cash_cents` even when a
 * grant fully consumes a standard bonus portion.
 */
/**
 * @cc [author:spolu,label:4_year_grants] four-year-grant-offset
 * The aggregate active four-year-grant cash equivalent must produce
 * `regularCoreRemaining = Math.max(0, regularBonusCore - fourYearMonthlyCash * 6)` and independently
 * `fourYearProRateCash = fourYearMonthlyCash * 12 * proRateDays / 365` followed by
 * `proRateCoreRemaining = Math.max(0, proRateBonusCore - fourYearProRateCash)`, while leaving
 * `regularBonusOverflow` and `proRateBonusOverflow` unchanged.
 */
/**
 * @cc [author:spolu,label:grant_records] historical-grants-no-op
 * `engineer.grants` is a historical record and must not affect compensation output.
 */
/**
 * @cc [author:spolu,label:equity_split] bonus-equity-split
 * The regular bonus must produce
 * `regularCashPeriod = regularCoreRemaining * (1 - bonusEquityRatio) + regularBonusOverflow * (1 - overflowEquityRatio)`
 * and
 * `regularEquityPeriod = regularCoreRemaining * bonusEquityRatio + regularBonusOverflow * overflowEquityRatio`.
 */
/**
 * @cc [author:spolu,label:equity_split] prorated-bonus-equity-split
 * The prorated bonus must produce
 * `proRateCashPeriod = proRateCoreRemaining * (1 - bonusEquityRatio) + proRateBonusOverflow * (1 - overflowEquityRatio)`
 * and
 * `proRateEquityPeriod = proRateCoreRemaining * bonusEquityRatio + proRateBonusOverflow * overflowEquityRatio`.
 */
/**
 * @cc [author:spolu,label:equity_split] period-equity-grant
 * At a positive period-start `preferredPrice`, `regularEquityOptions` must be
 * `regularEquityPeriod / preferredPrice` and `proRateEquityOptions` must be
 * `proRateEquityPeriod / preferredPrice`; the resulting total `new_grant` must vest linearly from
 * the period start over six months with no cliff.
 */
/**
 * @cc [author:spolu,label:output_values] steady-state-output
 * `monthly` and `yearly` must contain regular steady-state values only, excluding prorate, with
 * every `yearly` value equal to twelve times its rounded monthly value.
 */
/**
 * @cc [author:spolu,label:pro_rated_bonus,label:output_values] period-award-output
 * `new_bonus` and `new_grant` must be null when no corresponding award is due and otherwise expose
 * separately rounded `regular_*` and `prorate_*` components plus a separately rounded total of the
 * underlying regular and prorated cash or equity award for the six-month period.
 */
/**
 * @cc [author:spolu,label:output_values] new-base-output
 * `new_base.value_cents` must be the exact rounded-up annual base salary after applying
 * `BASE_SALARY_CAP_CENTS` for that period.
 */
/**
 * @cc [author:spolu,label:output_values] compensation-output-rounding
 * Every calculated monetary amount and option count emitted by the calculation must be rounded up,
 * while configured ratio values must remain unchanged.
 */
/**
 * @cc [author:spolu,label:output_values] total-cash-output
 * Each `total_cash_cents` must equal `base_cash_cents + bonus_cash_cents` plus
 * `bonus_equity_cash_cents + 4_year_grant_equity_cash_cents` in the same breakdown.
 */
export function computeCompensation(
  company: CompanyData,
  engineer: EngineerData,
  targetPeriodStart: string
): EngineerOutput {
  if (
    engineer.start_date >= ENGOS_EFFECTIVE_DATE &&
    engineer["4_year_grants"].length > 0
  ) {
    throw new Error(
      `4_year_grants are only valid for engineers who started before ${ENGOS_EFFECTIVE_DATE}; engineer started ${engineer.start_date}`
    );
  }

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

  // Earliest date from which standard 1/2 bonus starts.
  const standardBonusStartDate = engineerDate
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
    const hasStandardBonusThisPeriod =
      standardBonusStartDate !== null && periodDate >= standardBonusStartDate;
    const hasBaseOverflowBonusThisPeriod = yearlyBaseOverflow > 0;
    const hasBonusThisPeriod =
      hasStandardBonusThisPeriod || hasBaseOverflowBonusThisPeriod;
    const configuredBonusSplit = findApplicableEntry(
      engineer.period_bonus_splits,
      periodStart
    );

    // --- BONUS ---
    let regularBonusCore = 0;
    let regularBonusOverflow = 0;
    let regularBonus = 0;
    let proRateBonusCore = 0;
    let proRateBonusOverflow = 0;
    let proRateBonus = 0;
    let proRateDays = 0;
    let bonusEquityRatio = 0;
    let overflowEquityRatio = 0;

    if (hasBonusThisPeriod) {
      // Look up bonus split
      if (!configuredBonusSplit) {
        throw new Error(
          `Missing period_bonus_splits entry for period ${periodStart}`
        );
      }
      bonusEquityRatio = configuredBonusSplit.bonus_equity_ratio;
      validateBonusEquityRatio(
        bonusEquityRatio,
        `Invalid period_bonus_splits entry for period ${periodStart}`
      );
      overflowEquityRatio =
        configuredBonusSplit.overflow_equity_ratio ?? bonusEquityRatio;
      validateOverflowEquityRatio(
        overflowEquityRatio,
        `Invalid period_bonus_splits entry for period ${periodStart}`
      );

      // Regular bonus for the period:
      // 1) Standard bonus based on computed (uncapped) base, after engineer_date
      // 2) Plus overflow from capped base redirected to bonus, even before engineer_date
      regularBonusCore = hasStandardBonusThisPeriod
        ? uncappedYearlyBase / 2 / 2
        : 0;
      regularBonusOverflow = yearlyBaseOverflow / 2;
      regularBonus = regularBonusCore + regularBonusOverflow;

      // Pro-rated bonus for first standard-bonus period after engineer_date
      if (hasStandardBonusThisPeriod && !proRatedBonusApplied) {
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
            proRateBonusCore = (baseBefore / 2) * (proRateDays / 365);
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

    // Prorate: 4yr grant vesting over the prorate days (core bonus component only)
    const fourYearProRateCash =
      proRateDays > 0 ? (fourYearMonthlyCash * 12 * proRateDays) / 365 : 0;
    const proRateCoreRemaining = Math.max(
      0,
      proRateBonusCore - fourYearProRateCash
    );

    // --- Split remaining bonus between cash and equity ---
    const regularCashPeriod =
      regularCoreRemaining * (1 - bonusEquityRatio) +
      regularBonusOverflow * (1 - overflowEquityRatio);
    const regularEquityPeriod =
      regularCoreRemaining * bonusEquityRatio +
      regularBonusOverflow * overflowEquityRatio;
    const proRateCashPeriod =
      proRateCoreRemaining * (1 - bonusEquityRatio) +
      proRateBonusOverflow * (1 - overflowEquityRatio);
    const proRateEquityPeriod =
      proRateCoreRemaining * bonusEquityRatio +
      proRateBonusOverflow * overflowEquityRatio;

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

    // --- New base (annual base salary for this period) ---
    const newBase: NewBase = {
      value_cents: Math.ceil(yearlyBase),
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
      bonus_equity_ratio:
        configuredBonusSplit?.bonus_equity_ratio ?? null,
      overflow_equity_ratio:
        configuredBonusSplit?.overflow_equity_ratio ??
        configuredBonusSplit?.bonus_equity_ratio ??
        null,
      new_base: newBase,
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
 * @cc [author:spolu,label:jazz_simulation] projection-fundraises
 * Starting from the latest known option price, the projection must add fundraises every
 * `fundraisePeriodMonths` before 2031, multiply preferred and strike prices by
 * `preferredMultiplier` at each event, and use the resulting contemporaneous preferred price for
 * bonus-to-option conversion; for the same equity amount, a higher preferred price must produce
 * fewer options.
 */
/**
 * @cc [author:spolu,label:jazz_parameters] projection-ratio
 * The projection must reject a `bonusEquityRatio` outside `[RATIO_MINIMUM, 1]` and apply the valid
 * ratio to both standard and base-overflow bonuses in every simulated period.
 */
/**
 * @cc [author:spolu,label:jazz_output_values] projection-year-range-and-price
 * The projection must return exactly one entry for each year from 2026 through 2030 whose
 * `preferred_price_cents` is the projected preferred price on December 31 of that year.
 */
/**
 * @cc [author:spolu,label:jazz_output_values] projection-vesting
 * Each year-end `options_vested` must be the rounded-up cumulative linear vesting from every
 * four-year grant over 48 months from its start date and every simulated period grant over six
 * months from its period start; `value_cents` must be
 * `options_vested * preferred_price_cents` for that year.
 */
/**
 * @cc [author:spolu,label:jazz_output_values] projection-cash-output
 * Each projection year must take `yearly_base_cents`, `yearly_bonus_cash_cents`, and
 * `yearly_cash_total_cents` from the final compensation period of that year, with
 * `yearly_cash_total_cents` equal to `base_cash_cents + bonus_cash_cents` plus
 * `bonus_equity_cash_cents + 4_year_grant_equity_cash_cents` from that period's `yearly` output.
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

    // New grants from periods (vest over 6 months). Recorded grants are no-op.
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
    let yearlyCashTotal = 0;
    for (const period of result.periods) {
      if (period.start_date.startsWith(String(year))) {
        yearlyBase = period.yearly.base_cash_cents;
        yearlyBonusCash = period.yearly.bonus_cash_cents;
        yearlyCashTotal = period.yearly.total_cash_cents;
      }
    }

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
 * @cc [author:spolu,label:periods] model-window-and-payments
 * The model must cover the next twelve full calendar months, report base salary in every month,
 * and report period cash bonuses and equity grants only on May 1 and November 1 boundaries.
 */
/**
 * @cc [author:spolu,label:periods] model-ended-engineer-exclusion
 * The model must exclude an engineer from every month at or after their non-null `end_date`.
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
