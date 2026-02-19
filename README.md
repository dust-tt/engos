## EngOS compensation

### Inputs company

Stored in company.json:

```
ENGOS_START_DATE="2025-09-01"
```

```
{
  options_price: {
    start_date: Date,
    strike_price_cents: number,
    preferred_price_cents: number,
  }[]
}
```

### Inputs engineer

Stored per engineer under engineers/{handle}.json:

```
{
  start_date: Date,
  // Date at which the employee trial period ended.
  engineer_date: Date | null,
  // Date at which the employee became lead.
  lead_date: Date | null,
  // Date at which the employee became tenured.
  tenure_date: Date | null,
  // Only applicable to engineers that joined before the EngOs start date
  4_year_grants: {
    start_date: Date,
    options_count: number
  }[],
  // Change of base salary, including initial base salary. Length must be at least 1, and the first
  // entry must have start_date equal to employee start_date.
  base_salaries: {
    start_date: Date,
    yearly_cash_cents: number
  }[],
  // Bonus equity/cash split decision each period. Period is every 6 months 3/1 and 9/1
  period_bonus_splits: {
    start_date: Date,
    bonus_equity_ratio: number
  }[]
}
```

### Output engineer (recomputed from scratch from inputs at every run)

```
{
  periods: {
    start_date: Date,
    monthly: {
       base_cash_cents: number,
       bonus_cash_cents: number,
       bonus_equity_options_count: number,
       bonus_equity_cash_cents: number,
       4_year_grant_equity_options_count: number,
       4_year_grant_equity_cash_cents: number,
       total_cash_cents: number,
    },
    yearly: {
       base_cash_cents: number,
       bonus_cash_cents: number,
       bonus_equity_options_count: number,
       bonus_equity_cash_cents: number,
       4_year_grant_equity_options_count: number,
       4_year_grant_equity_cash_cents: number,
       total_cash_cents: number,
    }
    new_bonus: {
      regular_value_cents: number,
      prorate_value_cents: number,
      value_cents: number,
    } | null,
    new_grant: {
      regular_options_count: number,
      regular_value_cents: number,
      prorate_options_count: number,
      prorate_value_cents: number,
      options_count: number,
      value_cents: number,
    } | null,
  }[]
```

Methodology and invariants:

- Each period is a 6 months period starting either 3/1 or 9/1 of each year.
- At each period the base salary is increased by 5k annualized (2.5k on the period) if the employee
  is off of trial period (`enginer_date <= period.start_date`), 10k annualized (5k on the period) if
  lead (`lead_date <= period.start_date`), 15k annualized (7.5k on the period) if tenured
  (`tenured_date <= period.start_date`). Starting from the last `base_salaries` entry which is
  either the initial salary or a manual salary change.
- All employees must have a `period_bonus_splits` entry for all 6 month periods (3/1 and 9/1) coming
  after `max(ENGOS_START_DATE, engineer_date)`. If such entry is missing, error.
- Taking into account the base_salary increase for the period, the additional bonus total amount is
  computed as 1/3 of the base_salary.
- This total bonus is splitted as per the period bonus slpit for the engineer between equity and
  cash using `bonus_equity_ratio`.
- The equity part is computed as `new_grant.options_count` using the current `preferred_price_cents`
  at the date of the period start. This is the total options to grant on a 6 month vesting schedule
  with no cliff.
- For the first period after `engineer_date` (end of trial period) we add to the period total bonus
  a pro-rated value for the period between `engineer_date` and period `start_date` (computed pre
  base increase for the period)
- All periods are recomputed on each run giving a clear view at the time of the compensation monthly
  and annualized (simply 12x the monthly on the period)
- Employees that joined before the ENGOS_START_DATE may have `4_year_grants` set, compute the
  monthly vesting of options and its cash equivalent at `current_preferred`. Remove the
  `4_year_grant` cash equivalent from the period bonus. If < 0 just report the 4 year grant
  (higher than bonus amount) otherwise run the normal process with the remaining bonus.
