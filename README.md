## EngOS compensation

All monetary amounts are in EUR cents.

### Usage

```bash
# Period compensation (default command)
npx tsx src/cli.ts {handle}
npx tsx src/cli.ts period {handle} -p 2026-11-01

# Equity projection through 2030
npx tsx src/cli.ts jazz {handle} {ratio}
npx tsx src/cli.ts jazz {handle} {ratio} -m 3 -f 24
```

### Inputs company

Stored in code:
```
ENGOS_START_DATE="2026-11-01"
BASE_SALARY_CAP_CENTS = 135_000_00;
RATIO_MINIMUM = 0.5;
```

Stored in company.json:

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
  // Date at which employment ended. Null for active employees.
  end_date: Date | null,
  // Date at which the employee trial period ended.
  engineer_date: Date | null,
  // Date at which the employee became tenured.
  tenure_date: Date | null,
  // Only applicable to engineers that joined before the EngOS start date.
  // Each grant vests linearly over 48 months from its start_date.
  4_year_grants: {
    start_date: Date,
    options_count: number
  }[],
  // Grant historical records (from bonus or impact recognition).
  grants: {
    start_date: Date,
    options_count: number,
    type: "impact" | "bonus",
    period: "4y" | "6m",
    reason?: string
  }[],
  // Base salary entries. The most recent entry at or before a period start is used as the
  // baseline for that period.
  base_salaries: {
    start_date: Date,
    yearly_cash_cents: number
  }[],
  // Bonus equity/cash split decision each period. Period is every 6 months 5/1 and 11/1.
  // Required for all periods after max(ENGOS_START_DATE, engineer_date).
  // Must be in [RATIO_MINIMUM, 1], so cash is capped by (1 - RATIO_MINIMUM).
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
    // monthly and yearly reflect steady-state (regular) values only, excluding one-time prorate.
    monthly: {
       base_cash_cents: number,
       bonus_total_cents: number,
       bonus_cash_cents: number,
       bonus_equity_options_count: number,
       bonus_equity_cash_cents: number,
       4_year_grant_equity_options_count: number,
       4_year_grant_equity_cash_cents: number,
       total_cash_cents: number,
    },
    yearly: {
       base_cash_cents: number,
       bonus_total_cents: number,
       bonus_cash_cents: number,
       bonus_equity_options_count: number,
       bonus_equity_cash_cents: number,
       4_year_grant_equity_options_count: number,
       4_year_grant_equity_cash_cents: number,
       total_cash_cents: number,
    },
    // Annual base salary for the period, after the base salary cap is applied.
    new_base: {
      value_cents: number,
    },
    // Actual cash bonus to pay for the period. Includes regular + prorate if applicable.
    new_bonus: {
      regular_value_cents: number,
      prorate_value_cents: number,
      value_cents: number,
    } | null,
    // Actual equity grant for the period. Includes regular + prorate if applicable.
    new_grant: {
      regular_options_count: number,
      regular_value_cents: number,
      prorate_options_count: number,
      prorate_value_cents: number,
      options_count: number,
      value_cents: number,
    } | null,
  }[]
}
```

### Methodology and invariants

**Periods**

- Each period is a 6-month period starting either 5/1 or 11/1 of each year.
- Periods are generated starting from `max(ENGOS_START_DATE, engineer.start_date)` through the
  target period.
- Requests for periods at or after `engineer.end_date` fail. The aggregate model excludes
  terminated employees from months at or after their `end_date`.
- All periods are recomputed on each run giving a clear view of the compensation monthly and
  annualized (simply 12x the monthly on the period).

**Base salary and raises**

- At each period, the base salary is increased by 5k EUR on the yearly rate (10k annualized
  across 2 periods/year) if the employee is off trial (`engineer_date <= period.start_date`),
  or 7.5k on the yearly rate (15k annualized) if tenured
  (`tenure_date <= period.start_date`).
- Raises accumulate from the most recent `base_salaries` entry (which is either the initial
  salary or a manual salary change). A new entry resets the accumulation.
- If the base salary entry is at the period start, no raise is applied for that period. If it
  is strictly before the period, one raise is applied.
- Base cash is capped at BASE_SALARY_CAP_CENTS EUR/year; any computed base above that cap is
  redirected to bonus (while bonus still uses the computed uncapped base for its `1/3` component).

**Bonus computation**

- All employees must have a `period_bonus_splits` entry covering all 6-month periods (5/1 and
  11/1) after `max(ENGOS_START_DATE, engineer_date)`. If missing, error.
- The regular bonus for a period is `yearly_uncapped_base / 2 / 3`, plus redirected overflow:
  `max(0, yearly_uncapped_base - BASE_SALARY_CAP_CENTS) / 2`.
- `bonus_total_cents` in monthly/yearly reflects this regular bonus (before 4yr grant
  deduction and equity split).

**Pro-rated bonus (first period after trial)**

- For the first bonus-eligible period after `engineer_date`, if `engineer_date` falls within
  the 6-month window before the period (between the previous period boundary and period start),
  a pro-rated bonus is added: `(pre_increase_base / 3) * (days / 365)` where days is the gap
  between `engineer_date` and the period start.
- The prorate is a one-time catch-up. Monthly and yearly values exclude the prorate to show
  steady-state compensation. The prorate is reported separately in `new_bonus` and `new_grant`.

**4-year grants**

- Employees may have `4_year_grants`: each grant vests linearly over 48 months. Monthly vesting
  = `options_count / 48`. Cash equivalent = monthly vesting * current `preferred_price_cents`.
- The 4yr grant cash equivalent is subtracted from the bonus independently for each portion:
  - Regular: 6-month grant cash (`monthly_cash * 6`) subtracted from regular 1/3 bonus
  - Prorate: proportional grant cash (`monthly_cash * 12 * days / 365`) subtracted from
    prorate 1/3 bonus
- The base-cap overflow bonus component is preserved (not reduced by 4yr grant subtraction), so
  capped base overflow always remains payable via the regular/prorate bonus paths.
- If the 4yr grant cash exceeds the bonus portion, that portion's bonus is 0 (just report the
  4yr grant values).

**Grant records**

- We record `grants` issued: each entry is a historical record of a grant from bonus or impact
  recognition, with `type`, `period`, and an optional `reason`.
- `grants` are a NO-OP for compensation calculation, pure historical recording.

**Equity split**

- After 4yr grant deduction, the remaining bonus is split per `bonus_equity_ratio`:
  - Cash portion: `remaining * (1 - bonus_equity_ratio)`
  - Equity portion: `remaining * bonus_equity_ratio`
- `bonus_equity_ratio` is enforced in `[RATIO_MINIMUM, 1]`, so engineers cannot take more than
  `(1 - RATIO_MINIMUM)` of bonus in cash.
- The equity portion is converted to `options_count` using the current `preferred_price_cents`
  at the period start date. This is the total options to grant on a 6-month vesting schedule
  with no cliff.

**Output values**

- `monthly` and `yearly` breakdowns reflect regular (steady-state) values only.
- `new_base` is the exact annual base salary for the period, after the base salary cap is
  applied.
- `new_bonus` and `new_grant` represent actual amounts for the period, breaking out `regular`
  and `prorate` components.
- `total_cash_cents = base_cash + bonus_cash + bonus_equity_cash + 4yr_grant_equity_cash`.
- All values are rounded up (ceil).

### Equity projection (`jazz`)

The `jazz` command projects forward equity ownership through 2030 by simulating fundraise events.

**Parameters**

- `handle` — engineer handle
- `ratio` — bonus equity ratio (`RATIO_MINIMUM`-1) applied to all periods in the simulation
- `-m, --multiplier <number>` — preferred price multiplier at each fundraise (default: 2)
- `-f, --fundraise-period <months>` — months between fundraise events (default: 18)

**Fundraise simulation**

- Starting from the most recent `options_price` entry, projected fundraise events are generated
  every `fundraise-period` months through 2030.
- At each fundraise, the preferred price is multiplied by `multiplier`.
- Bonus-to-equity conversion at each period uses the projected preferred price at that time,
  so later periods yield fewer options (at a higher price per option).

**Output**

A table with years 2026–2030 as rows and columns:

- **Pref. Price** — projected preferred price at year-end
- **Yearly Base** — annualized base salary at the last period of the year
- **Cash Bonus** — annualized cash bonus at the last period of the year
- **Cash Total** — annualized total cash (base + cash bonus + equity cash equivalent) at the last period of the year
- **Options** — cumulative vested options at year-end (from 4yr grants + period grants)
- **Options Value** — total vested options valued at the projected preferred price at year-end

Option vesting follows the same rules as in `period`: 4yr grants vest over 48 months, period
grants vest over 6 months from the period start date.
