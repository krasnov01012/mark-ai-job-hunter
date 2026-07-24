# MARK — Codex Project Guidance

## Purpose

MARK is both a useful AI Job Hunter MVP and an honest engineering portfolio project. Prioritize a finished, testable product over fashionable technology or speculative architecture. Continue the existing project; do not restart or redesign it from scratch unless the user explicitly asks.

Communicate with the user in Russian. Keep file names, node names, field names, commands, and technology names in English. Lead with the result, explain unfamiliar concepts plainly, and normally identify only one concrete next roadmap step.

## Load context progressively

For a substantial change, read only the relevant parts of:

1. `docs/CURRENT_STATE.md` — verified current state and immediate checkpoint;
2. `docs/ROADMAP.md` — approved sequence and acceptance criteria;
3. `README.md` — stable project overview;
4. `n8n/workflows/ai-job-hunter-main.json` — latest checked-in workflow export;
5. relevant files in `n8n/code/` and `tests/`.

Also inspect `git status` and the relevant diff before editing. Do not reload every document for a small question when the required context is already clear.

When sources disagree, use this order:

1. verified behavior of a real n8n execution;
2. current live n8n node configuration;
3. latest workflow export;
4. repository code and tests;
5. `CURRENT_STATE.md`;
6. `ROADMAP.md`, then `README.md`;
7. old chat messages.

Report and reconcile discrepancies. Never describe a planned feature as implemented, and state clearly when live n8n behavior was not available for verification.

## MVP and architecture boundaries

- n8n Community Edition is the orchestrator; JavaScript in Code nodes is the current implementation language.
- Do not rewrite working JavaScript or n8n logic in Python merely for AI fashion or portfolio value.
- Introduce Python only for a clearly bounded component whose measurable benefit exceeds the cost of a second runtime and interface; explain the need, JSON contract, failure behavior, dependencies, deployment, and tests first.
- Do not add Docker, RAG, LangGraph/CrewAI orchestration, multi-agent architecture, a custom UI, automatic applications, or many new sources before the approved MVP stage requires them.
- Complete the Habr Career end-to-end path before adding another vacancy source. Keep source-specific collection and parsing before the common vacancy contract.
- Prefer one clear responsibility per major node, but do not split the workflow into meaningless micro-nodes.
- Use deterministic rules before the LLM. Reserve NVIDIA scoring for semantic fit, transferable skills, ambiguous requirements, gaps, and explanation.

Target pipeline:

```text
Source → source dedupe/pre-filter → full-page fetch → source normalizer
→ common hard filter → level filter → candidate profile → NVIDIA scorer
→ durable state → Telegram → scheduling/reliability
```

## Permanent vacancy policies

- Salary is not a filter. Missing salary is allowed and must not reduce the score.
- Keep employer salary separate from Habr `predictedSalary`; never present a prediction as an employer offer.
- Full remote is potentially acceptable, but for international sources verify that the role is actually available from Georgia: `remote` does not automatically mean `worldwide`.
- Hybrid and office are allowed only in Tbilisi, Georgia. Unknown or conflicting work format is not automatically remote.
- Explicit Senior, Lead, Principal, Staff, Head, Architect, and confirmed 5+ year requirements are normally rejected.
- Intern, Junior, and Middle may pass; Middle+ and reasonable 2–4 year requirements may be `STRETCH`. Do not lose an unknown level without evidence.
- Personal projects, including EDITH and MARK, are not commercial production experience.

Important classifier nodes should preserve useful upstream data and return explainable fields such as `decision`, `decision_code`, `reasons`, `warnings`, `evidence`, `confidence`, and `version` when appropriate—not only a boolean.

## Change and verification workflow

Before editing, identify the current roadmap stage, the concrete problem, the minimal patch, acceptance criteria, and existing behavior that must remain intact.

During implementation:

- preserve unrelated user changes and avoid unrelated refactors;
- do not change data contracts silently;
- handle missing fields and partial item failures;
- avoid unbounded retries and overlapping loops;
- never place credentials, API keys, cookies, private tokens, or sensitive Chat IDs in code, fixtures, docs, workflow exports, or Git.

For Code nodes, treat `n8n/code/*.js` as editable source. After a change:

1. run `node --check` and the relevant local tests;
2. synchronize the matching n8n node;
3. verify positive and negative workflow paths when live n8n is available;
4. export the stable workflow to `n8n/workflows/ai-job-hunter-main.json`;
5. verify the export contains no literal secrets and that embedded Code node sources match the repository files;
6. inspect the final diff.

Do not claim success from one manual vacancy when a local regression matrix is appropriate. Report what passed, what was not tested, and remaining risks.

Do not create commits, branches, pushes, or pull requests unless the user explicitly asks. Prefer logical checkpoints over microcommits.

## Documentation discipline

Documentation is a continuously maintained part of the product, not a one-time deliverable. As the project evolves, keep adding verified architecture, contracts, tests, decisions, limitations, and portfolio evidence so the repository remains sufficient to understand and continue MARK without relying on chat history.

After every verified logical checkpoint and every material change to behavior, architecture, data contracts, integrations, tests, limitations, or roadmap status—not every tiny intermediate edit—synchronize documentation under `docs/`:

- `CURRENT_STATE.md`: concise facts, live pipeline, verified result, known gap, one next step;
- `ROADMAP.md`: completion status and acceptance criteria, marked done only after verification;
- `README.md`: stable high-level overview and run/structure information.

Create `ARCHITECTURE.md`, `DECISIONS.md`, `TESTING.md`, or `PORTFOLIO.md` only when there is substantial durable content for them. Keep volatile status out of this `AGENTS.md`; it belongs in `CURRENT_STATE.md`.

Do not finish a logical development stage while its documentation is stale. When implementation and documentation disagree, verify the implementation first and update the documentation in the same checkpoint.

For target-server deployment, networking, backups, monitoring, migration, cutover,
restart, or recovery changes, also synchronize the sibling Main Server control-plane
when it is available: `../Main Server/docs/MARK_INTEGRATION/STATUS.md`, the relevant
acceptance checklist/plan sections, and `../Main Server/docs/PLAN.md`. A MARK
checkpoint is not complete while the application documentation and server
integration documentation disagree.

Portfolio statements must be evidence-based. Clearly distinguish planned, implemented, tested, and production-proven work. Do not call MARK a from-scratch backend application or attribute Senior/Architect/ML Engineer/Data Scientist experience to the user.
