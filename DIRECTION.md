# Direction for tails v2

Tails is a standalone product for tracking requirements across specs and pull requests.
Teams choose the skills that assess their work. Deemaze Skills is one integration.
This note says what exists in `cli/` and what to build next. The [README](README.md) defines the first
release's scope. The PRD (`specs/prds/tails-v2.md`) and TDD (`specs/tdds/tails-v2.md`) also contain
future delivery-tracking plans. `DECISIONS.tsv` records decisions and their evidence.

## First release

The release is the local CLI and its generated reports. The earlier Rails/web app, fixtures,
contracts and deployment setup are kept in a private archive. They are not part of this repository.
The CLI needs Node.js, Git, and `gh` for GitHub links. It needs no `.env` file or provider keys.

The bundled conformance schema remains because `tails skills prepare conformance` uses it to
prepare an agent task. There is no conformance importer, delivery-state engine or squad dashboard
in the runtime. Linear links and implementation PR states are useful reference metadata, not
delivery evidence.

## Where tails fits

At Deemaze a PRD, a TDD and a test case spec are written and approved in separate pull requests, and
agents then build the work across many more. The deemaze-skills plugins check one PR at a time:
`pr-review` reads a diff, and spec conformance reads a branch against its spec. Nothing remembers
across PRs. tails is that memory. It answers three questions the per-PR tools cannot:

1. **Do the specs still agree?** A PRD PR can rule out what an open TDD PR plans. tails reads the
   open spec PRs together (`--ref`, `review --with`) and fails the check on a scope conflict before
   either merges.
2. **Is every requirement designed and tested?** The requirement ledger traces each PRD requirement
   to the TDD rows that cite it and the test cases that cover it, per epic.
3. **What does a spec change reach?** When a requirement changes, the review lists the rows and test
   cases that still cite the old text, with a word diff.

Its outputs go where people already look. The PR check summary is the main one. The markdown files
feed agents and CI. The HTML report and `tails serve` are the TL and PM view.

### Local first, one feature at a time

João's decision on 2026-11-03: people install Tails and run it on their own machine. A feature is a
file of explicit links: the PRD, TDD and test case pull requests (or files), the Linear ticket and
the implementation pull requests. `tails feature <name>` reads them with the person's own `gh`
login and opens the report locally. This needs no hosting and no access setup, and it works for
projects without a documentation repository.

Tails keeps its own files apart from the projects. Feature files and reports live in
`~/tails-documentation` (or `--home`, or `$TAILS_HOME`). Tails never looks for that folder inside
a project, and nothing of Tails goes into a project repository by default. Only `tails skills init`
writes into a project, and only when someone runs it.

### Standalone product, team-owned skills

Tails stays in `jpboliv/tails`. The plan to move it into `deemaze-skills` is superseded
by João's decision on 2026-11-02.

Tails owns the requirement index, links, change comparisons, and reports. The selected skills own
the assessment method and team rules. An agent executes those instructions and returns evidence.
Tails can then use that evidence across documents and PRs.

A project can select a skill by file path or by path and revision in a local Git checkout.
It can also create an editable copy of a bundled default. The current roles are `spec-review`,
`pr-review`, and `conformance`.

Selection has one order: an explicit `.tails.yml` reference, then
`.tails/skills/<role>/SKILL.md`, then the bundled default. The selected skill replaces the default
method. A broken selection fails with its path. Tails never silently substitutes another method.

Deemaze can reference its existing skills directly. Other teams can reference their own libraries
or maintain project-local skills. The result format is separate from the selected instructions:
spec findings use `tails.drift/1`, conformance uses `tails.verdict/1`, and PR review produces Markdown.
The current CLI imports agent spec findings through `--extra`. Conformance ingestion remains S3 work.

Skill references retain their original directory so the agent can read their supporting files.
Git references record the resolved commit. The agent reads supporting files at that commit too.
The initial integration prepares a task for the user's existing agent. Direct runner integrations
and remote skill downloads are later work.

## What exists

`cli/` is a TypeScript CLI with no runtime dependencies. Its report commands read the source repository.
It covers S1 (the spec index), S2
(drift, DR-1 to DR-6, with `.tails/accepted.yml` and `--extra` agent findings) and S5 (spec PR
review), reads several `--ref`s as one set so open spec PRs are checked together, and writes a static
HTML report. `cli/schemas/` holds the `tails.verdict/1` and `tails.drift/1` JSON Schemas.
`cli/README.md` covers commands, pages and drift rules. Tests generate reports from synthetic specs.

Document pages are a reader view. They fold the notes a TDD carries for the agent (`_Verify`,
`_Free:_`, the reading guide), move record IDs into the margin, and highlight **Blocked** clauses.
Fixed format markers decide each fold (`src/reader.ts`). In the feature-flags TDD these notes are
about a third of the words. The source view is unchanged.

`tails skills list` shows each selected skill. `show` prints its instructions. `init` creates an
editable bundled copy in the project. `prepare` writes instructions, an entry-file digest,
source details, and the applicable result schema for an agent. It does not execute the agent.
Only `init` creates a skill in the project. Existing skill files are never replaced.

## Why it is built this way

**One parse, many readers.** The indexer produces one typed index. Drift, the site and review read
that index and never parse Markdown themselves. A change to the Markdown rules happens in
`markdown.ts` and `families.ts` only.

**Errors at the edge.** Config, YAML and `--extra` files are validated where they enter. A bad input
exits with code 2 and names the file and line (INV-7, INV-8). Code past that point trusts its types.

**Word matching for DR-2, kept narrow.** DR-2 compares words, so it can produce false positives. It
reads only what a TDD row plans and skips negated clauses and the PRD's own vocabulary (see
`cli/README.md`, Drift rules). Synthetic tests cover scope conflicts, negation, rejected alternatives,
and evidence-only matches.

**Parser conventions are isolated.** D6 (matrix rows without a PRD column) lives in `prdColumn` in
`families.ts` and one DR-5 branch. A new document convention can change there without changing skill selection.

## Assumptions

These are my readings of the TDD where it was silent or open. Each one is a single place in code.

- Documents form a group through their epic key and their links to each other.
- A short citation such as `D3` counts only if the group defines that family. Otherwise it is
  prose, such as "S1" in a sentence.
- DR-3 skips a PRD that did not exist at the TDD's last commit.
- DR-5 reports one finding per matrix table when the table has no PRD column.
- `tails drift` exits 0 unless `--strict` is set. CI decides whether drift blocks a merge.
- A duplicate ID is an input error. IDs are unique per document, and matrix IDs are unique across the repository.
- `tails report` is a convenience command that runs index, drift and site.
- Report commands rebuild the index each run. There is no `--index` flag to read a saved one.
- Document kinds come from path prefixes from the repository root.
- The built-in stop-word list is a heuristic and needs validation on each adopting project's specs.

## Not done yet

- **Agent execution.** Users give the prepared task to their agent. Direct runner integrations,
  dependency installation, remote downloads, and automatic result collection remain to be built.
- **S3 delivery reach.** Which merged PRs delivered which requirements. The plan is JSON and
  markdown first, from real PR data and the selected checker's verdicts. Restore verdict ingestion
  with a real producer. Deemaze's conformance output is one candidate, not a product dependency.
- **S4 squads.** Paused. A per-squad page answers a question João has not asked yet.
- **Linear in `tails feature`.** The ticket is linked but not read. Next: read the epic and its
  stories, and show which story owns each record.
- **Implementation pull requests in `tails feature`.** They are listed with their state. Delivery
  state per record needs `spec-conformance` results (deemaze-skills#97, merging soon).

## Next steps

0. Release the verified CLI archive and use `tails feature` on the next feature. Collect feedback
   before adding Linear stories and conformance results to the feature view.
1. Run the sample workflow (`cli/examples/github-actions/tails.yml`) on a fork of the spec
   repository. It runs `review` on every spec PR against its base. Then add a step that fetches
   the other open spec PRs as `refs/pull/*/head` and passes them with `--with`.
2. Exercise skill handoffs with Deemaze's library and a project-local replacement. Choose the first
   agent runner from those trials.
3. Compare deemaze-skills PR #97 with the result contract. Add an adapter if its format differs.
4. Encourage spec authors to add a PRD column to each matrix. Without it, the ledger can show
   test coverage but not design coverage, and DR-3 cannot reach the rows a PRD change affects.
5. Build S3 delivery reach as JSON and markdown, from a read-only GitHub token.
6. Watch DR-2 on real changes. If false positives stay common, add terms to `stop_words` in
   `.tails.yml` before changing the matcher.

## Validation data

Repository fixtures are synthetic. Keep client specifications, real-project validation results,
and generated reports in the client's repository or a separate private validation workspace.
