export interface OptionsPriceEntry {
  start_date: string;
  strike_price_cents: number;
  preferred_price_cents: number;
}

export interface CompanyData {
  options_price: OptionsPriceEntry[];
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
}

export interface EngineerData {
  start_date: string;
  engineer_date: string | null;
  tenure_date: string | null;
  "4_year_grants": FourYearGrant[];
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

export interface PeriodOutput {
  start_date: string;
  monthly: PeriodBreakdown;
  yearly: PeriodBreakdown;
  new_bonus: NewBonus | null;
  new_grant: NewGrant | null;
}

export interface EngineerOutput {
  periods: PeriodOutput[];
}
