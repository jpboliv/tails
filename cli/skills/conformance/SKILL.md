---
name: tails-conformance
description: Assess whether an implementation satisfies named requirements at a specific revision. Use for a Tails conformance task or a request to map requirements to implementation evidence and report unmet or unverifiable behavior.
---

# Assess implementation against requirements

Read the project's instructions and the task's ticket, specification, and code revision.
Identify the requirement IDs assigned to the change. Record the exact code and spec commits.
If the required identity or source is missing, request it rather than inventing a value.

For each requirement, compare its acceptance criteria with the implementation and relevant tests.
Cite the requirement and the code that supports the assessment.
Use met for supported behavior, missing for absent behavior, and deviates for a different implementation of the requirement.
Use not_checkable when the available evidence cannot establish the behavior.
Use blocked when a dependency prevents the assessment.

Read the surrounding implementation when the diff alone cannot establish behavior.
A test file is evidence of intent. Report a passing test only when an observed run supports that claim.
Separate incidental changes, added scope, and work assigned to later requirements.
For a changed design decision, explain the difference and identify who must decide.

Use the output format supplied with the task. If none is supplied, return a requirement-by-requirement Markdown report.
Keep unknown results visible. An implementation assessment does not establish deployment or delivery to an environment.
