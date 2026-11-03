# Synthetic spec fixtures

These documents are fictional inputs for the CLI tests, not client specifications.

- `acme`: export requirements with design links, missing coverage, and dangling citations.
- `catalog`: one deliberate archive-migration scope conflict, negated exclusions, rejected
  alternatives, evidence-only keyword matches, and two matrices without PRD columns.
- `records`: a TDD in the record format (bold record IDs with `_Verify`, `_Free:_`, `_(existing)_`
  and `**Blocked (…):**`, and a "How to read the contracts" section), and a PRD with a retired
  criterion and an HTML comment. The reader-view tests use it.

Tests create temporary Git histories and reports from these inputs. Keep real-project validation
data and generated reports in the project's own repository or a separate private workspace.
