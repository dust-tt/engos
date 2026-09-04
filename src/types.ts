export interface OptionsPriceEntry {
  start_date: string;
  strike_price_cents: number;
  preferred_price_cents: number;
}

export interface ExchangeRateEntry {
  period_start_date: string;
  eur_usd: number;
}

export interface CompanyData {
  options_price: OptionsPriceEntry[];
  exchange_rates?: ExchangeRateEntry[];
}

/**
 * @cc [author:spolu,label:grant_records] issued-grant-record
 * Each `GrantRecord` must historically record an issued `bonus` or `impact` grant, classify its
 * vesting period as `4y` or `6m`, and allow an optional human-readable `reason`.
 */
export interface GrantRecord {
  start_date: string;
  options_count: number;
  type: "impact" | "bonus";
  period: "4y" | "6m";
  reason?: string;
}

export interface FourYearGrant {
  start_date: string;
  options_count: number;
}

export interface BaseSalaryEntry {
  start_date: string;
  yearly_cash_cents: number;
}

export interface PeriodBonusSplit {
  start_date: string;
  bonus_equity_ratio: number;
  overflow_equity_ratio?: number;
}

export interface EngineerData {
  email: string;
  country: "FR" | "US";
  start_date: string;
  /**
   * @cc [author:spolu,label:periods] employment-end-date
   * `end_date` is the first date on which the engineer is no longer employed; `null` means the
   * engineer is active with no recorded employment end.
   */
  end_date: string | null;
  /**
   * @cc [author:spolu,label:base_salary_and_raise,label:bonus_computation,label:pro_rated_bonus] trial-completion-date
   * `engineer_date` is the date on which the engineer's trial period ends; `null` means the trial
   * period has not ended.
   */
  engineer_date: string | null;
  /**
   * @cc [author:spolu,label:base_salary_and_raise] tenure-date
   * `tenure_date` is the date on which the engineer becomes tenured; `null` means the engineer has
   * not become tenured.
   */
  tenure_date: string | null;
  /**
   * @cc [author:spolu,label:4_year_grants] pre-engos-four-year-grants
   * `4_year_grants` must be empty unless `start_date < ENGOS_EFFECTIVE_DATE`.
   */
  "4_year_grants": FourYearGrant[];
  grants: GrantRecord[];
  base_salaries: BaseSalaryEntry[];
  period_bonus_splits: PeriodBonusSplit[];
}

export interface PeriodBreakdown {
  base_cash_cents: number;
  bonus_total_cents: number;
  bonus_cash_cents: number;
  bonus_equity_options_count: number;
  bonus_equity_cash_cents: number;
  "4_year_grant_equity_options_count": number;
  "4_year_grant_equity_cash_cents": number;
  total_cash_cents: number;
}

export interface NewGrant {
  regular_options_count: number;
  regular_value_cents: number;
  prorate_options_count: number;
  prorate_value_cents: number;
  options_count: number;
  value_cents: number;
}

export interface NewBonus {
  regular_value_cents: number;
  prorate_value_cents: number;
  value_cents: number;
}

export interface NewBase {
  value_cents: number;
}

export interface PeriodOutput {
  start_date: string;
  monthly: PeriodBreakdown;
  yearly: PeriodBreakdown;
  bonus_equity_ratio: number | null;
  overflow_equity_ratio: number | null;
  new_base: NewBase;
  new_bonus: NewBonus | null;
  new_grant: NewGrant | null;
}

export interface EngineerOutput {
  periods: PeriodOutput[];
}
