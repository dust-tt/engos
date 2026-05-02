import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { program } from "commander";
import {
  CompanyData,
  EngineerData,
  PeriodBreakdown,
  PeriodOutput,
} from "./types.js";
import {
  computeCompensation,
  computeModel,
  getPreferredPriceAtDate,
  projectEquity,
  RATIO_MINIMUM,
} from "./compute.js";

function formatCents(cents: number): string {
  const euros = Math.ceil(cents / 100);
  return euros.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatPrice(cents: number): string {
  const euros = cents / 100;
  return euros.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatOptions(count: number): string {
  return count.toLocaleString("en-US");
}

function formatPlainNumber(value: number): string {
  return String(Math.ceil(value));
}

function csvEscape(value: string): string {
  if (!/[",\n\r]/.test(value)) {
    return value;
  }
  return `"${value.replace(/"/g, '""')}"`;
}

function printTable(
  headers: string[],
  rows: string[][],
  opts: { separatorBefore?: (row: string[]) => boolean } = {}
) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length))
  );
  const formatRow = (row: string[]) =>
    row.map((cell, i) => cell.padEnd(widths[i])).join(" | ");
  const separator = widths.map((w) => "-".repeat(w)).join("-|-");

  console.log(formatRow(headers));
  console.log(separator);
  for (const row of rows) {
    if (opts.separatorBefore?.(row)) {
      console.log(separator);
    }
    console.log(formatRow(row));
  }
}

function printAmountLine(label: string, value: string) {
  console.log(`    ${`${label}:`.padEnd(29)}${value}`);
}

function printBreakdown(label: string, b: PeriodBreakdown) {
  const hasFourYearGrant =
    b["4_year_grant_equity_options_count"] > 0 ||
    b["4_year_grant_equity_cash_cents"] > 0;
  const bonusCashLabel = hasFourYearGrant
    ? "Bonus (net 4yr) (cash)"
    : "Bonus (cash)";
  const bonusEquityLabel = hasFourYearGrant
    ? "Bonus (net 4yr) (equity)"
    : "Bonus (equity)";

  console.log(`  ${label}:`);
  printAmountLine("Base (cash)", formatCents(b.base_cash_cents));
  printAmountLine("Bonus (total)", formatCents(b.bonus_total_cents));
  if (hasFourYearGrant) {
    printAmountLine(
      "4yr Grant (equity)",
      `${formatCents(b["4_year_grant_equity_cash_cents"])} (${formatOptions(b["4_year_grant_equity_options_count"])} options)`
    );
  }
  printAmountLine(bonusCashLabel, formatCents(b.bonus_cash_cents));
  printAmountLine(
    bonusEquityLabel,
    `${formatCents(b.bonus_equity_cash_cents)} (${formatOptions(b.bonus_equity_options_count)} options)`
  );
  printAmountLine("Total", formatCents(b.total_cash_cents));
}

/** Compute the next period start (next 5/1 or 11/1 from today). */
function getNextPeriodStart(): string {
  const now = new Date();
  const year = now.getFullYear();

  const candidates = [
    new Date(year, 4, 1), // May 1
    new Date(year, 10, 1), // Nov 1
    new Date(year + 1, 4, 1), // Next May 1
  ];

  for (const c of candidates) {
    if (c >= now) {
      const y = c.getFullYear();
      const m = String(c.getMonth() + 1).padStart(2, "0");
      return `${y}-${m}-01`;
    }
  }

  // Fallback
  return `${year + 1}-05-01`;
}

function loadData(handle: string): {
  company: CompanyData;
  engineer: EngineerData;
} {
  const companyPath = resolve("company.json");
  const engineerPath = resolve("engineers", `${handle}.json`);

  let company: CompanyData;
  let engineer: EngineerData;

  try {
    company = JSON.parse(readFileSync(companyPath, "utf-8"));
  } catch {
    console.error(`Error: could not read ${companyPath}`);
    process.exit(1);
  }

  try {
    engineer = JSON.parse(readFileSync(engineerPath, "utf-8"));
  } catch {
    console.error(`Error: could not read ${engineerPath}`);
    process.exit(1);
  }

  return { company, engineer };
}

function loadCompany(): CompanyData {
  const companyPath = resolve("company.json");
  try {
    return JSON.parse(readFileSync(companyPath, "utf-8"));
  } catch {
    console.error(`Error: could not read ${companyPath}`);
    process.exit(1);
  }
}

function listEngineerHandles(): string[] {
  const engineersDir = resolve("engineers");
  return readdirSync(engineersDir)
    .filter((f) => f.endsWith(".json") && !f.startsWith("test"))
    .map((f) => f.replace(/\.json$/, ""))
    .sort();
}

function loadEngineer(handle: string): EngineerData {
  const engineerPath = resolve("engineers", `${handle}.json`);
  return JSON.parse(readFileSync(engineerPath, "utf-8"));
}

program
  .name("engos")
  .description("EngOS engineer compensation");

program
  .command("period", { isDefault: true })
  .description("Compute engineer compensation for a period")
  .argument("<handle>", "Engineer handle (e.g. pierre)")
  .option(
    "-p, --period <date>",
    "Target period start (YYYY-MM-DD), defaults to next 5/1 or 11/1"
  )
  .action((handle: string, opts: { period?: string }) => {
    const targetPeriod = opts.period || getNextPeriodStart();
    const { company, engineer } = loadData(handle);
    let result: ReturnType<typeof computeCompensation>;
    try {
      result = computeCompensation(company, engineer, targetPeriod);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.error(`Error: ${message}`);
      process.exit(1);
    }

    console.log(`\n=== Engineer: ${handle} ===`);
    console.log(`Target period: ${targetPeriod}\n`);

    if (result.periods.length === 0) {
      console.log("No periods to compute.");
      return;
    }

    for (const period of result.periods) {
      console.log(`--- Period: ${period.start_date} ---`);
      printBreakdown("Monthly", period.monthly);
      console.log();
      printBreakdown("Yearly (annualized)", period.yearly);
      console.log();

      console.log(`  New Base: ${formatCents(period.new_base.value_cents)}`);

      if (period.new_bonus) {
        const b = period.new_bonus;
        let line = `  Period Bonus: ${formatCents(b.value_cents)}`;
        if (b.prorate_value_cents > 0) {
          line += ` (regular: ${formatCents(b.regular_value_cents)}, prorate: ${formatCents(b.prorate_value_cents)})`;
        }
        console.log(line);
      } else {
        console.log(`  Period Bonus: none`);
      }

      if (period.new_grant) {
        const g = period.new_grant;
        let line = `  Period Grant: ${formatOptions(g.options_count)} options (${formatCents(g.value_cents)})`;
        if (g.prorate_options_count > 0) {
          line += ` (regular: ${formatOptions(g.regular_options_count)} options, prorate: ${formatOptions(g.prorate_options_count)} options)`;
        }
        console.log(line);
      } else {
        console.log(`  Period Grant: none`);
      }
      console.log();
    }
  });

const executeHeaders = [
  "engineer",
  "new_base",
  "bonus_equity_ratio",
  "overflow_equity_ratio",
  "period_bonus",
  "period_grant_options",
  "period_grant_value",
  "error",
];

function periodReportRow(
  handle: string,
  period: PeriodOutput,
  csv: boolean
): string[] {
  const cents = csv ? formatPlainNumber : formatCents;
  const options = csv ? formatPlainNumber : formatOptions;
  const empty = csv ? "0" : "-";

  return [
    handle,
    cents(period.new_base.value_cents),
    period.bonus_equity_ratio !== null ? String(period.bonus_equity_ratio) : "",
    period.overflow_equity_ratio !== null
      ? String(period.overflow_equity_ratio)
      : "",
    period.new_bonus ? cents(period.new_bonus.value_cents) : empty,
    period.new_grant ? options(period.new_grant.options_count) : empty,
    period.new_grant ? cents(period.new_grant.value_cents) : empty,
    "",
  ];
}

function periodErrorRow(handle: string, error: string): string[] {
  return [
    handle,
    ...Array(executeHeaders.length - 2).fill(""),
    error,
  ];
}

function periodTotalRow(totals: {
  newBaseCents: number;
  bonusEquityRatioSum: number;
  bonusEquityRatioCount: number;
  overflowEquityRatioSum: number;
  overflowEquityRatioCount: number;
  bonusCents: number;
  grantOptions: number;
  grantValueCents: number;
}): string[] {
  const avg = (sum: number, count: number) =>
    count > 0 ? String(Math.round((sum / count) * 100) / 100) : "";

  return [
    "TOTAL",
    formatCents(totals.newBaseCents),
    avg(totals.bonusEquityRatioSum, totals.bonusEquityRatioCount),
    avg(totals.overflowEquityRatioSum, totals.overflowEquityRatioCount),
    formatCents(totals.bonusCents),
    formatOptions(totals.grantOptions),
    formatCents(totals.grantValueCents),
    "",
  ];
}

program
  .command("execute")
  .description("Compute period output for all engineers")
  .option(
    "-p, --period <date>",
    "Target period start (YYYY-MM-DD), defaults to next 5/1 or 11/1"
  )
  .option("--csv", "Print CSV instead of a table")
  .action((opts: { period?: string; csv?: boolean }) => {
    const targetPeriod = opts.period || getNextPeriodStart();
    const company = loadCompany();
    const handles = listEngineerHandles();
    const rows: string[][] = [];
    const totals = {
      newBaseCents: 0,
      bonusEquityRatioSum: 0,
      bonusEquityRatioCount: 0,
      overflowEquityRatioSum: 0,
      overflowEquityRatioCount: 0,
      bonusCents: 0,
      grantOptions: 0,
      grantValueCents: 0,
    };

    for (const handle of handles) {
      try {
        const engineer = loadEngineer(handle);
        if (engineer.end_date !== null) {
          continue;
        }
        const result = computeCompensation(company, engineer, targetPeriod);
        const period = result.periods.find((p) => p.start_date === targetPeriod);
        if (!period) {
          rows.push(periodErrorRow(handle, "No period output for target"));
          continue;
        }
        totals.newBaseCents += period.new_base.value_cents;
        if (period.bonus_equity_ratio !== null) {
          totals.bonusEquityRatioSum += period.bonus_equity_ratio;
          totals.bonusEquityRatioCount += 1;
        }
        if (period.overflow_equity_ratio !== null) {
          totals.overflowEquityRatioSum += period.overflow_equity_ratio;
          totals.overflowEquityRatioCount += 1;
        }
        totals.bonusCents += period.new_bonus?.value_cents ?? 0;
        totals.grantOptions += period.new_grant?.options_count ?? 0;
        totals.grantValueCents += period.new_grant?.value_cents ?? 0;
        rows.push(periodReportRow(handle, period, Boolean(opts.csv)));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        rows.push(periodErrorRow(handle, message));
      }
    }

    if (opts.csv) {
      console.log(executeHeaders.map(csvEscape).join(","));
      for (const row of rows) {
        console.log(row.map(csvEscape).join(","));
      }
    } else {
      console.log(`\n=== Period Execution: ${targetPeriod} (${handles.length} engineers) ===\n`);
      printTable(executeHeaders, [...rows, periodTotalRow(totals)], {
        separatorBefore: (row) => row[0] === "TOTAL",
      });
      console.log();
    }
  });

program
  .command("jazz")
  .description("Project equity ownership forward through 2030")
  .argument("<handle>", "Engineer handle")
  .argument("<ratio>", `Bonus equity ratio (${RATIO_MINIMUM}-1)`)
  .option(
    "-m, --multiplier <number>",
    "Preferred price multiplier at each fundraise",
    "2"
  )
  .option(
    "-f, --fundraise-period <months>",
    "Months between fundraise events",
    "18"
  )
  .action(
    (
      handle: string,
      ratioStr: string,
      opts: { multiplier: string; fundraisePeriod: string }
    ) => {
      const ratio = parseFloat(ratioStr);
      if (isNaN(ratio) || ratio < RATIO_MINIMUM || ratio > 1) {
        console.error(
          `Error: ratio must be a number between ${RATIO_MINIMUM} and 1`
        );
        process.exit(1);
      }

      const multiplier = parseFloat(opts.multiplier);
      const fundraisePeriod = parseInt(opts.fundraisePeriod, 10);

      const { company, engineer } = loadData(handle);
      const currentPreferred = getPreferredPriceAtDate(company, "2030-11-01");
      const projections = projectEquity(
        company,
        engineer,
        ratio,
        multiplier,
        fundraisePeriod
      );

      console.log(`\n=== Equity Projection: ${handle} ===`);
      console.log(`Bonus equity ratio: ${(ratio * 100).toFixed(0)}%`);
      console.log(`Current preferred price: ${formatPrice(currentPreferred)}/option`);
      console.log(
        `Fundraise: x${multiplier} every ${fundraisePeriod} months\n`
      );

      // Table
      const header = [
        "Year".padEnd(6),
        "Pref. Price".padStart(12),
        "Yearly Base".padStart(14),
        "Cash Bonus".padStart(14),
        "Cash Total".padStart(14),
        "Options".padStart(12),
        "Options Value".padStart(16),
      ].join(" | ");
      const separator = header.replace(/[^|]/g, "-");

      console.log(header);
      console.log(separator);

      for (const p of projections) {
        const row = [
          String(p.year).padEnd(6),
          formatPrice(p.preferred_price_cents).padStart(12),
          formatCents(p.yearly_base_cents).padStart(14),
          formatCents(p.yearly_bonus_cash_cents).padStart(14),
          formatCents(p.yearly_cash_total_cents).padStart(14),
          formatOptions(p.options_vested).padStart(12),
          formatCents(p.value_cents).padStart(16),
        ].join(" | ");
        console.log(row);
      }
      console.log();
    }
  );

program
  .command("model")
  .description("Aggregate compensation model across all engineers for the next 12 months")
  .action(() => {
    const companyPath = resolve("company.json");
    const engineersDir = resolve("engineers");

    let company: CompanyData;
    try {
      company = JSON.parse(readFileSync(companyPath, "utf-8"));
    } catch {
      console.error(`Error: could not read ${companyPath}`);
      process.exit(1);
    }

    // Load all engineers except test fixtures
    const files = readdirSync(engineersDir).filter(
      (f) => f.endsWith(".json") && !f.startsWith("test")
    );
    const engineers: EngineerData[] = files.map((f) =>
      JSON.parse(readFileSync(resolve(engineersDir, f), "utf-8"))
    );

    const months = computeModel(company, engineers);

    console.log(`\n=== Compensation Model (${files.length} engineers) ===\n`);

    const header = [
      "Month".padEnd(10),
      "Engineers".padStart(9),
      "Base Salary".padStart(14),
      "Cash Bonus".padStart(14),
      "Equity Grant".padStart(24),
    ].join(" | ");
    const separator = header.replace(/[^|]/g, "-");

    console.log(header);
    console.log(separator);

    for (const m of months) {
      const bonusStr = m.is_period_start
        ? formatCents(m.bonus_cash_cents).padStart(14)
        : "—".padStart(14);
      const equityStr = m.is_period_start
        ? `${formatOptions(m.equity_options_count)} opts (${formatCents(m.equity_value_cents)})`.padStart(24)
        : "—".padStart(24);

      const row = [
        m.month.padEnd(10),
        String(m.engineers_count).padStart(9),
        formatCents(m.base_salary_cents).padStart(14),
        bonusStr,
        equityStr,
      ].join(" | ");
      console.log(row);
    }
    console.log();
  });

program.parse();
