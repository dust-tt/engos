## EngOS compensation

### Usage

```bash
# Period compensation (default command)
npx tsx src/cli.ts {handle}
npx tsx src/cli.ts period {handle} -p 2026-11-01

# Period compensation for all engineers
npx tsx src/cli.ts execute -p 2026-11-01
npx tsx src/cli.ts execute -p 2026-11-01 --csv
npx tsx src/cli.ts execute -p 2026-11-01 --csv-hibob-cash
npx tsx src/cli.ts execute -p 2026-11-01 --csv-hibob-equity
npx tsx src/cli.ts execute -p 2026-11-01 --csv-hibob-base

# Equity projection through 2030
npx tsx src/cli.ts jazz {handle} {ratio}
npx tsx src/cli.ts jazz {handle} {ratio} -m 3 -f 24
```

### Inputs company

Compensation policy constants are defined and documented with their contracts in
[`src/compute.ts`](src/compute.ts).

Stored in company.json:

```
{
  options_price: {
    start_date: Date,
    strike_price_cents: number,
    preferred_price_cents: number,
  }[],
  // Used by the execute command when rendering US compensation.
  exchange_rates: {
    period_start_date: Date,
    eur_usd: number,
  }[]
}
```

### Inputs engineer

Stored per engineer under engineers/{handle}.json:

```
{
  email: string,
  country: "FR" | "US",
  start_date: Date,
  end_date: Date | null,
  engineer_date: Date | null,
  tenure_date: Date | null,
  4_year_grants: {
    start_date: Date,
    options_count: number
  }[],
  grants: {
    start_date: Date,
    options_count: number,
    type: "impact" | "bonus",
    period: "4y" | "6m",
    reason?: string
  }[],
  base_salaries: {
    start_date: Date,
    yearly_cash_cents: number
  }[],
  period_bonus_splits: {
    start_date: Date,
    bonus_equity_ratio: number,
    overflow_equity_ratio?: number
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
    bonus_equity_ratio: number | null,
    overflow_equity_ratio: number | null,
    new_base: {
      value_cents: number,
    },
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
}
```

### Compensation contracts

The authoritative compensation methodology and projection invariants are `@cc` contracts attached
to their owning declarations in [`src/compute.ts`](src/compute.ts). Inspect and validate them with:

```bash
cc-check list src/compute.ts
cc-check format
```
