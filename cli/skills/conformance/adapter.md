# Structured assessment handoff

Keep the selected skill's report structure and assessment rules. Save its complete Markdown report
as report.md and the same conclusions as result.json using tails.verdict/2. This is a serialization
contract, not an additional review method.

- Record checker name/version and checked_at in UTC. Use the exact reviewed PR head SHA.
- sources lists each inspected document separately, including tickets. Record its commit or last
  update time. GitHub document locations are owner/repo/path (without the branch); tracker documents
  use canonical URLs. Give sources unique keys. Do not invent missing documents or ticket IDs.
- Record scope as ticket or inferred, with every referenced ticket and the actual PR scope. Keep
  moved requirements as moved, with moved_to. Requirements without a verdict because their spec is
  vague or duplicated use unresolved and link to a spec defect.
- Each result key is its defining source location followed by # and its native or derived ID.
  Preserve IDs, requirement text, source quotes, and code path/line evidence. Code evidence is an
  empty array when absent; explain absence in note. Met needs code evidence. Test code does not
  establish that a test ran or that a feature was deployed.
- Preserve every decision's impact, both concrete options, affected documents, owner, declaration
  status, and documentation PR links. Link decisions and defects to result keys in both directions.
  Additions and early work can have no result in scope; retain them as decisions.
- Keep spec defects separate from implementation decisions. A Missing/Deviates row failing only
  through a contradiction links to that defect instead of a decision. Preserve the skill's reasons.
- Derived requirements link to a missing_id defect. Not-checkable rows each name a manual check,
  a location or command, and an expected result. Record unavailable inputs in not_checked.
- For a linked documentation PR, inspect both base and head. Baseline sources define verdicts;
  proposed sources describe what the documentation PR would resolve. An open docs PR is not the
  accepted contract. Use the feature context's baseline revisions when supplied.
- Conforms means no decisions are needed. It can include manual checks, blocked or moved
  requirements, and spec defects. At least one decision means does_not_conform. Without a usable
  design spec, use cannot_check, explain the gap, and leave results and decisions empty.
- Retain all requested fields; use empty arrays for empty sections, not fabricated entries. The
  import validates both the JSON schema and the links between results, decisions, and sources.
