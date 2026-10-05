# Local DeFi Multi-AI Agent

This project is a local, research-oriented DeFi protocol engineering system built around **multiple specialized AI agents** rather than one monolithic agent.

It uses:

- **Ollama** for local reasoning and tool calling
- **ChromaDB** for semantic retrieval over large PDF research sets
- **PDF.js** for page-aware PDF extraction
- **Hardhat 3** for Solidity compilation and testing
- a staged multi-agent pipeline with independent reviews and remediation

## Multi-agent architecture

```text
                         ┌─────────────────────┐
                         │      User Request    │
                         └──────────┬──────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
                ▼                   ▼                   ▼
        DeFi Researcher      Protocol Architect   Security Specialist
                │                   │                   │
                └───────────────────┼───────────────────┘
                                    ▼
                         ┌─────────────────────┐
                         │ Solidity Implementer│
                         └──────────┬──────────┘
                                    │
                ┌───────────────────┼───────────────────┐
                │                   │                   │
                ▼                   ▼                   ▼
        Security Reviewer    Economic Reviewer    Test Engineer
                │                   │                   │
                └───────────────────┼───────────────────┘
                                    ▼
                         ┌─────────────────────┐
                         │ Remediation Engineer│
                         └──────────┬──────────┘
                                    ▼
                         ┌─────────────────────┐
                         │ Final Audit Agent   │
                         └─────────────────────┘
```

### What changed from the original agent

The original `ai_agent.js` gave one model the complete responsibility for research, design, implementation, testing, and review.

The new `multi_ai_agent.js` separates those responsibilities into specialized agents:

1. **DeFi Researcher** — retrieves and summarizes relevant research.
2. **Protocol Architect** — turns research into equations, state transitions, invariants, and acceptance criteria.
3. **Security Specialist** — creates a threat model before code exists.
4. **Solidity Implementer** — implements the protocol and its tests.
5. **Adversarial Security Reviewer** — independently attacks the implementation.
6. **Economic Mechanism Reviewer** — checks conservation, solvency, indexes, liquidation, fees, rounding, and economic invariants.
7. **Property Test Engineer** — checks test coverage and can add missing tests.
8. **Remediation Engineer** — fixes actionable findings and reruns verification.
9. **Final Verification Auditor** — independently runs the final checks and records remaining risks.

Research and architecture/security planning are staged because later specialists consume earlier handoffs. The independent review specialists run in parallel after implementation because they inspect the same immutable implementation. Code mutation is serialized through the implementer and remediation phases to avoid conflicting writes.

## Agent handoffs

All persistent multi-agent artifacts live under:

```text
workspace/.multi-agent/
└── reports/
    ├── research.md
    ├── architecture.md
    ├── security-plan.md
    ├── security-review.md
    ├── economic-review.md
    ├── test-review.md
    └── final-audit.md
```

This makes the system auditable: every specialist leaves a durable handoff for the next phase.

## Model specialization

Every role can use the same Ollama model, or you can assign different models:

```env
OLLAMA_MODEL=qwen2.5-coder:7b

OLLAMA_MODEL_RESEARCHER=
OLLAMA_MODEL_ARCHITECT=
OLLAMA_MODEL_SECURITY=
OLLAMA_MODEL_ECONOMIC=
OLLAMA_MODEL_IMPLEMENTER=
OLLAMA_MODEL_REVIEWER=
OLLAMA_MODEL_TESTER=
OLLAMA_MODEL_REMEDIATION=
OLLAMA_MODEL_AUDITOR=
```

Blank role-specific values fall back to `OLLAMA_MODEL`.

For example, you can use a general model for research and a stronger coding/reasoning model for implementation and audit.

## Run

Install the root dependencies:

```bash
npm install
```

Install the Hardhat workspace dependencies:

```bash
npm --prefix workspace install
```

Start ChromaDB and Ollama locally, then make sure the configured Ollama models are available.

Run the multi-agent pipeline:

```bash
npm start -- "Build a DeFi lending protocol with ..."
```

The original single-agent implementation remains available:

```bash
npm run single-agent -- "Build a DeFi lending protocol with ..."
```

## Research

Put PDFs in:

```text
research/
```

Then index them:

```bash
npm run research:index
```

The index is incremental, so unchanged PDFs are skipped.

## Validation

The multi-agent pipeline follows:

```text
research
  -> architecture
  -> security plan
  -> implementation
  -> compile
  -> tests
  -> independent security/economic/test reviews
  -> remediation
  -> compile
  -> tests
  -> economic analysis
  -> final audit
```

For lending protocols, the economic layer checks for signals around:

- debt and collateral conservation
- share/index accounting
- interest accrual
- liquidation and solvency
- oracle assumptions
- fees and reserves
- rounding
- repeated operations
- invariant/fuzz/property test coverage

`ECONOMIC_ANALYSIS.json` is a validation artifact, not a formal security proof or audit.

## Safety boundary

The agent is intended for local development and research.

- It only writes protocol files under `workspace/`.
- It only runs Hardhat commands against the local workspace.
- It does not deploy to a live network.
- It does not move real funds.
- Research PDFs are treated as untrusted reference material.
- Passing compilation/tests does not establish protocol safety.

## Configuration

See `.env.example` for all supported variables.

Important controls:

- `OLLAMA_MODEL` — default reasoning model
- `OLLAMA_MODEL_<ROLE>` — optional model per specialist
- `MULTI_AGENT_MAX_ROUNDS` — maximum tool rounds per specialist
- `MAX_TOOL_ROUNDS` — legacy/single-agent limit
- `RESEARCH_TOP_K` — research retrieval depth
- `CHROMA_*` — local vector-store configuration
