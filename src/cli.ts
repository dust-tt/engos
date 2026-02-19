import { readFileSync } from "fs";
import { resolve } from "path";
import { program } from "commander";
import { CompanyData, EngineerData, PeriodBreakdown } from "./types.js";
import { computeCompensation } from "./compute.js";

function formatCents(cents: number): string {
  const euros = Math.ceil(cents / 100);
  return euros.toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function formatOptions(count: number): string {
  return count.toLocaleString("en-US");
}

function printBreakdown(label: string, b: PeriodBreakdown) {
  console.log(`  ${label}:`);
  console.log(`    Base (cash):            ${formatCents(b.base_cash_cents)}`);
  console.log(`    Bonus (total):          ${formatCents(b.bonus_total_cents)}`);
  console.log(`    Bonus (cash):           ${formatCents(b.bonus_cash_cents)}`);
  console.log(
    `    Bonus (equity):         ${formatCents(b.bonus_equity_cash_cents)} (${formatOptions(b.bonus_equity_options_count)} options)`
  );
  console.log(
    `    4yr Grant (equity):     ${formatCents(b["4_year_grant_equity_cash_cents"])} (${formatOptions(b["4_year_grant_equity_options_count"])} options)`
  );
  console.log(
    `    Total:                  ${formatCents(b.total_cash_cents)}`
  );
}

/** Compute the next period start (next 3/1 or 9/1 from today). */
function getNextPeriodStart(): string {
  const now = new Date();
  const year = now.getFullYear();

  const candidates = [
    new Date(year, 2, 1), // Mar 1
    new Date(year, 8, 1), // Sep 1
    new Date(year + 1, 2, 1), // Next Mar 1
  ];

  for (const c of candidates) {
    if (c >= now) {
      const y = c.getFullYear();
      const m = String(c.getMonth() + 1).padStart(2, "0");
      return `${y}-${m}-01`;
    }
  }

  // Fallback
  return `${year + 1}-03-01`;
}

program
  .name("engos")
  .description("Compute EngOS engineer compensation")
  .argument("<handle>", "Engineer handle (e.g. pierre)")
  .option(
    "-p, --period <date>",
    "Target period start (YYYY-MM-DD), defaults to next 3/1 or 9/1"
  )
  .action((handle: string, opts: { period?: string }) => {
    const targetPeriod = opts.period || getNextPeriodStart();

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

    const result = computeCompensation(company, engineer, targetPeriod);

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

      if (period.new_bonus) {
        const b = period.new_bonus;
        let line = `  New Bonus: ${formatCents(b.value_cents)}`;
        if (b.prorate_value_cents > 0) {
          line += ` (regular: ${formatCents(b.regular_value_cents)}, prorate: ${formatCents(b.prorate_value_cents)})`;
        }
        console.log(line);
      } else {
        console.log(`  New Bonus: none`);
      }

      if (period.new_grant) {
        const g = period.new_grant;
        let line = `  New Grant: ${formatOptions(g.options_count)} options (${formatCents(g.value_cents)})`;
        if (g.prorate_options_count > 0) {
          line += ` (regular: ${formatOptions(g.regular_options_count)} options, prorate: ${formatOptions(g.prorate_options_count)} options)`;
        }
        console.log(line);
      } else {
        console.log(`  New Grant: none`);
      }
      console.log();
    }
  });

program.parse();
