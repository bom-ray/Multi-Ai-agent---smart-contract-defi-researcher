import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const WORKSPACE = path.resolve(process.env.WORKSPACE_DIR ?? "./workspace");
const SOURCE_DIR = path.join(WORKSPACE, "contracts");
const TEST_DIR = path.join(WORKSPACE, "test");

const findings = [];
const filesScanned = [];

function add(severity, id, message, evidence = "") {
  findings.push({ severity, id, message, evidence });
}

async function walk(dir, ext = ".sol") {
  const out = [];
  try {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...await walk(full, ext));
      else if (!ext || entry.name.endsWith(ext)) out.push(full);
    }
  } catch {}
  return out;
}

async function readAll(dir, ext = ".sol") {
  const files = await walk(dir, ext);
  const contents = [];
  for (const file of files) {
    const content = await fs.readFile(file, "utf8");
    filesScanned.push(path.relative(WORKSPACE, file));
    contents.push({ file, rel: path.relative(WORKSPACE, file), content });
  }
  return contents;
}

function hasAny(text, patterns) {
  return patterns.some(p => p.test(text));
}

function countMatches(text, regex) {
  return [...text.matchAll(regex)].length;
}

function staticEconomicChecks(contracts, tests) {
  const source = contracts.map(x => x.content).join("\n\n");
  const testSource = tests.map(x => x.content).join("\n\n");

  const hasLendingTerms = hasAny(source, [
    /\bborrow\b/i, /\bdebt\b/i, /\bcollateral\b/i, /\bliquidat/i,
    /\binterest\b/i, /\butilization\b/i, /\bsupply\b/i, /\bdeposit\b/i
  ]);

  if (!hasLendingTerms) {
    add("info", "NO_LENDING_SIGNATURE",
      "No obvious lending vocabulary was detected. Economic checks may be incomplete for a non-lending protocol.",
      "Detected terms: borrow, debt, collateral, liquidation, interest, utilization, supply, deposit.");
    return;
  }

  const hasDebt = hasAny(source, [/\bdebt\b/i, /\bborrow/i, /\btotalDebt\b/i, /\bborrowShares\b/i]);
  const hasCollateral = /\bcollateral\b/i.test(source);
  const hasLiquidation = /\bliquidat/i.test(source);
  const hasOracle = hasAny(source, [/\boracle\b/i, /\bpriceFeed\b/i, /\bAggregatorV3\b/i, /\bgetPrice\b/i]);
  const hasInterest = hasAny(source, [/\binterest\b/i, /\bborrowIndex\b/i, /\bsupplyIndex\b/i, /\bratePer/i]);
  const hasShares = hasAny(source, [/\bshares?\b/i, /\btotalSupply\b/i]);
  const hasReserves = hasAny(source, [/\breserve\b/i, /\bprotocolFee\b/i, /\bfee\b/i]);
  const hasReentrancy = hasAny(source, [/\bReentrancyGuard\b/i, /\bnonReentrant\b/i]);

  if (hasDebt && !hasInterest) {
    add("high", "DEBT_WITHOUT_INTEREST_MODEL",
      "Debt/borrowing logic was detected but no obvious interest/index/rate accounting was detected.",
      "This may be intentional, but DESIGN.md should explicitly state whether debt is fixed-rate or interest-free.");
  }

  if (hasCollateral && !hasLiquidation) {
    add("high", "COLLATERAL_WITHOUT_LIQUIDATION",
      "Collateral logic was detected without an obvious liquidation path.",
      "If the protocol can become undercollateralized, there must be a documented resolution path.");
  }

  if (hasDebt && !hasCollateral) {
    add("medium", "DEBT_WITHOUT_COLLATERAL",
      "Debt/borrowing logic was detected without obvious collateral accounting.",
      "Verify whether the protocol is intentionally unsecured or uses another solvency mechanism.");
  }

  if (hasCollateral && !hasOracle) {
    add("high", "COLLATERAL_WITHOUT_ORACLE",
      "Collateralized lending was detected but no obvious oracle/price source was found.",
      "If all assets are fixed-price or internally valued, document that explicitly in DESIGN.md.");
  }

  if (hasShares && !hasAny(source, [/\bexchangeRate\b/i, /\bconvertToAssets\b/i, /\bconvertToShares\b/i, /\bindex\b/i])) {
    add("medium", "SHARES_WITHOUT_CONVERSION_MODEL",
      "Share accounting was detected without an obvious exchange-rate/index conversion model.",
      "Check mint/redeem/deposit/withdraw rounding and conservation equations.");
  }

  if (hasDebt && !hasAny(source, [/\btotalDebt\b/i, /\bdebtShares\b/i, /\bborrowShares\b/i, /\btotalBorrows\b/i])) {
    add("medium", "DEBT_AGGREGATION_UNCLEAR",
      "Borrow/debt behavior was detected but no obvious aggregate debt variable was found.",
      "Verify that per-user debt and aggregate protocol debt cannot diverge.");
  }

  if (hasInterest && !hasAny(source, [/\bblock\.timestamp\b/i, /\bblock\.number\b/i, /\blast.*Accr/i, /\blastUpdate/i, /\btime\b/i])) {
    add("medium", "INTEREST_TIME_SOURCE_UNCLEAR",
      "Interest/index logic was detected but no obvious time/block update marker was found.",
      "Verify accrual timing, stale state, and repeated-accrual behavior.");
  }

  if (hasReserves && !hasAny(source, [/\btotalAssets\b/i, /\btotalCash\b/i, /\bavailableLiquidity\b/i, /\bbalanceOf\(address\(this\)\)/i])) {
    add("medium", "RESERVE_ASSET_LINK_UNCLEAR",
      "Fees/reserves were detected but the relationship between reserve accounting and actual assets is unclear.",
      "Verify that accounting claims cannot exceed assets and fees are not double-counted.");
  }

  if (/\bcall\(/.test(source) && !hasReentrancy) {
    add("high", "EXTERNAL_CALL_WITHOUT_REENTRANCY_SIGNAL",
      "Low-level external calls were detected without an obvious nonReentrant/ReentrancyGuard signal.",
      "Review every external call for CEI/reentrancy and callback manipulation.");
  }

  if (/\btx\.origin\b/.test(source)) {
    add("high", "TX_ORIGIN",
      "tx.origin is used.",
      "Authentication based on tx.origin is generally unsafe.");
  }

  if (/\bselfdestruct\b/.test(source)) {
    add("high", "SELFDESTRUCT",
      "selfdestruct was detected.",
      "Review whether this is intentional and compatible with the target EVM/network semantics.");
  }

  if (/\bassembly\b/.test(source)) {
    add("medium", "INLINE_ASSEMBLY",
      "Inline assembly was detected.",
      "Review memory/storage safety and economic boundary conditions manually.");
  }

  if (/\bunchecked\b/.test(source)) {
    add("medium", "UNCHECKED_ARITHMETIC",
      "Unchecked arithmetic was detected.",
      "Verify every unchecked operation against overflow/underflow and economic bounds.");
  }

  const divisionCount = countMatches(source, /\/\s*[A-Za-z_][A-Za-z0-9_]*|\/\s*\d+/g);
  if (divisionCount > 0) {
    add("info", "DIVISION_ROUNDING_REVIEW",
      `${divisionCount} division expression(s) detected.`,
      "Review whether each division rounds in the economically safe direction for users, borrowers, liquidators, and the protocol.");
  }

  const invariantSignals = [
    /invariant/i, /assert\(/i, /vm\.assume/i, /property/i,
    /echidna/i, /fuzz/i, /random/i
  ];
  if (!hasAny(testSource, invariantSignals)) {
    add("high", "NO_INVARIANT_OR_FUZZ_TEST_SIGNAL",
      "No obvious invariant/fuzz/property-based test signal was detected in the workspace tests.",
      "The agent should create economic invariant tests tailored to the protocol.");
  }

  if (hasDebt && hasCollateral && hasLiquidation && !hasAny(testSource, [/liquidat/i, /health/i, /solven/i, /bad debt/i])) {
    add("high", "NO_LIQUIDATION_ECONOMIC_TEST",
      "Collateral, debt, and liquidation code exists but tests do not obviously cover liquidation/solvency behavior.",
      "Add boundary tests for healthy, exactly-at-threshold, and underwater positions.");
  }

  if (hasDebt && !hasAny(testSource, [/debt/i, /borrow/i])) {
    add("high", "NO_DEBT_TEST_SIGNAL",
      "Debt logic exists but tests do not obviously mention debt/borrow behavior.",
      "Add debt conservation and accrual tests.");
  }

  if (hasCollateral && !hasAny(testSource, [/collateral/i])) {
    add("high", "NO_COLLATERAL_TEST_SIGNAL",
      "Collateral logic exists but tests do not obviously mention collateral behavior.",
      "Add collateral valuation, withdrawal restrictions, and liquidation-boundary tests.");
  }
}

async function runHardhatEconomicTests() {
  const commands = [
    ["npx", ["hardhat", "test", "--grep", "economic|invariant|fuzz|solvency|liquidation"]],
    ["npx", ["hardhat", "test"]]
  ];

  const results = [];
  for (const [cmd, args] of commands) {
    const result = await new Promise((resolve) => {
      const child = spawn(cmd, args, {
        cwd: WORKSPACE,
        shell: false,
        env: process.env
      });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve({ code: 124, stdout, stderr: "Timed out after 120s" });
      }, 120000);
      child.stdout.on("data", d => stdout += d.toString());
      child.stderr.on("data", d => stderr += d.toString());
      child.on("error", e => {
        clearTimeout(timer);
        resolve({ code: 1, stdout, stderr: String(e) });
      });
      child.on("close", code => {
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    });
    results.push({ command: `${cmd} ${args.join(" ")}`, ...result });
  }
  return results;
}

async function main() {
  const contracts = await readAll(SOURCE_DIR);
  const tests = await readAll(TEST_DIR, null);
  staticEconomicChecks(contracts, tests);

  const hardhat = await runHardhatEconomicTests();

  const targeted = hardhat.find(x => x.command.includes("--grep"));
  const full = hardhat.find(x => !x.command.includes("--grep"));

  const report = {
    success: !findings.some(x => x.severity === "high" || x.severity === "critical"),
    generatedAt: new Date().toISOString(),
    filesScanned,
    findings,
    execution: {
      targetedEconomicTests: targeted ?? null,
      fullTestSuite: full ?? null
    },
    requiredManualReview: [
      "Economic safety is not proven by compilation or ordinary unit tests alone.",
      "Review oracle manipulation, liquidation incentives, bad-debt handling, interest-rate edge cases, rounding, donations/dust, and governance/admin powers.",
      "For a novel mechanism, compare the implemented equations against DESIGN.md and research citations."
    ]
  };

  await fs.writeFile(
    path.join(WORKSPACE, "ECONOMIC_ANALYSIS.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  console.log(JSON.stringify(report, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
