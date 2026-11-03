---
name: tails-spec-review
description: Review product requirements, technical designs, and test-case specs together. Use for a Tails spec-review task or a request to find contradictions, missing coverage, or the impact of a spec change.
---

# Review a set of specs

Read the task and the project's instructions first. Use its terminology, document locations, and requirement conventions.
Identify the documents and revisions under review. If the task names separate open spec PRs, read their documents together.

Follow each product requirement to the design rows and test cases that cite it.
Use explicit IDs and references as evidence of coverage. A similar sentence alone does not establish a link.
Separate a missing link from a missing design or test.

Compare the meaning of scope, decisions, constraints, and acceptance criteria across the documents.
Read negations and rejected alternatives before reporting a contradiction. Shared words alone do not establish a conflict.
For changed requirements, identify references whose design or tests need another review.

Report each supported finding with the relevant IDs, quoted evidence, and file and line references.
Explain what must be decided or updated. Keep unresolved questions separate from confirmed contradictions.
If a source is unavailable, state the gap. Documented test coverage does not prove that a test passed.

Use the output format supplied with the task. If none is supplied, return a Markdown report with findings, evidence, and gaps.
When no supported findings exist, say so and identify the documents reviewed.
