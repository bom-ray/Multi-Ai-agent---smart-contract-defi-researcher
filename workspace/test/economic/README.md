# Economic test layer

The agent should create protocol-specific tests here.

Minimum categories:

1. Conservation
   - assets represented by accounting cannot exceed actual assets without an explicit, documented mechanism.
   - debt shares/index conversion agrees with aggregate debt.

2. Solvency
   - healthy positions remain within collateral limits.
   - an underwater position cannot withdraw collateral that is required to cover debt.
   - liquidation cannot make the protocol less solvent.

3. Interest/index behavior
   - indexes are monotonic where intended.
   - repeated accrual does not double-count.
   - zero elapsed time does not accrue unexpected interest.
   - long elapsed periods remain within documented bounds.

4. Shares/rounding
   - deposit/withdraw and borrow/repay round in the documented direction.
   - repeated tiny operations cannot extract value from the protocol.
   - first-depositor/empty-market behavior is safe.

5. Liquidation
   - boundary at the health threshold is tested.
   - liquidation cannot exceed repayable debt.
   - collateral seized is bounded by available collateral.
   - fees/bonus cannot create insolvency.

6. Oracle
   - stale/invalid/zero prices are rejected where required.
   - price changes cannot bypass health checks through inconsistent snapshots.

7. Novel mechanism
   - test the new mechanism at minimum, maximum, threshold, and adversarial values.
   - test state transitions before and after the mechanism changes regime.

Use Hardhat/ethers assertions and property/fuzz-style loops where practical. Do not write tests that merely mirror implementation expressions; derive assertions from the economic model in DESIGN.md.
