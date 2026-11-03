---
name: tails-pr-review
description: Review a code change using the project's own conventions and requirements. Use for a Tails pr-review task or a request to assess a pull request and report evidence-backed defects.
---

# Review a code change

Identify the repository, base, and head from the task. Read the project's instructions and relevant conventions.
Read the PR description and linked requirements. If required context is unavailable, state the gap.

Read the diff and the surrounding code needed to understand its behavior.
Follow changed inputs through their callers, validation, persistence, and outputs.
Assess correctness, access boundaries, failure handling, compatibility, and test coverage where the change affects them.
Apply the project's established rules. Separate a personal preference from a defect or a documented convention violation.

For each finding, describe the trigger, impact, severity, and current file and line evidence.
Verify claims from comments or earlier reviews against the current change before reporting them.
Separate tests that you ran from tests that you only read.

Use the output format supplied with the task. If none is supplied, return a Markdown review.
Include the reviewed base and head, supported findings, and remaining gaps.
If no supported findings exist, say so without treating that result as proof of merge safety.
