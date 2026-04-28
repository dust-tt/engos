import { readFileSync, readdirSync } from "fs";
import { resolve } from "path";
import { program } from "commander";
import { CompanyData, EngineerData, PeriodBreakdown } from "./types.js";
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

    // Load all engineers except test.json
    const files = readdirSync(engineersDir).filter(
      (f) => f.endsWith(".json") && f !== "test.json"
    );
    const engineers: EngineerData[] = files.map((f) =>
      JSON.parse(readFileSync(resolve(engineersDir, f), "utf-8"))
    );

    const months = computeModel(company, engineers);

    console.log(`\n=== Compensation Model (${files.length} engineers) ===\n`);

    const header = [
      "Month".padEnd(10),
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
        formatCents(m.base_salary_cents).padStart(14),
        bonusStr,
        equityStr,
      ].join(" | ");
      console.log(row);
    }
    console.log();
  });

program.parse();
