---
tags: [skill-creator]
max_turns: 12
timeout_seconds: 300
allowed_tools: [Read, Glob, Grep, Skill, Write, Edit, Bash]
---

Review these two spec excerpts together and save your findings to report.md. Cite the supplied file
and line numbers. Do not change the specs. These excerpts are the complete inputs for this task.

prds/APP-1-export.md:
1: # Export
2: - **FR-1.1** Support staff can download exports but cannot delete them.
3: ## Not doing
4: Scheduled export emails.

tdds/APP-2-export.md:
1: # Export design
2: | ID | Requirement | PRD |
3: | --- | --- | --- |
4: | EX-API-1 | Support staff can download and delete exports. | FR-1.1 |
5: ## Decisions
6: | ID | Choice | Alternatives |
7: | --- | --- | --- |
8: | D1 | Downloads on request. Scheduled export emails are not supported. | Scheduled export emails. |

No test-case spec or test results were supplied.
