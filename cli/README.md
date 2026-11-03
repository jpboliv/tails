# Tails

Tails helps teams that build software with AI agents. It reads the documents of a feature: the
PRD, the technical design (TDD) and the test cases. It also reads the pull requests that hold
them. Then it shows you three things:

- Do the documents agree, or does one say something another one rules out?
- Does a test case cover each requirement, and does the design name it?
- When a document changes, which other parts still point at the old text?

Tails runs on your computer. It reads with your own GitHub login. It writes nothing to your
projects and publishes nothing. It does not call an AI model.

## Where Tails fits

At Deemaze, a feature moves through these steps. A skill from deemaze-skills helps with each one.

1. A product person writes the **PRD** with the `requirements-analysis` skill. It goes into a
   pull request.
2. An engineer writes the **TDD** with the `architecture-design` skill. Each rule in it has an ID,
   such as `FF-API-05`. It goes into its own pull request.
3. QA writes the **test cases**. They go into a third pull request.
4. The tickets in **Linear** list the IDs that each ticket delivers.
5. Agents write the code in **implementation pull requests**. The `pr-review` and
   `spec-conformance` skills check each one.

Each skill looks at one pull request. Tails looks at all of them together. Use it when you review a
spec pull request, when you want to read a design without the notes written for agents, and when
you want to know where a feature stands.

## Install

You need:

- Node.js 20 or later
- git
- the GitHub CLI, logged in: run `gh auth login` once

Then install Tails from its repository:

```sh
git clone https://github.com/jpboliv/tails.git
cd tails/cli
npm ci
npm run build
npm install --global .
```

Now the `tails` command works in any folder. Run `tails --help` to see every command.

## Your first feature

A feature in Tails is a short list of links. Run:

```sh
tails feature new
```

Tails asks for each link. Paste a link, or press Enter to skip it:

```text
Feature name: Feature flags
PRD (pull request or file link): https://github.com/acme/specs/pull/12
TDD (pull request or file link): https://github.com/acme/specs/pull/14
Test cases (pull request or file link): https://github.com/acme/specs/pull/16
Linear ticket (key or link): ACME-1
Implementation pull request (Enter when done):
```

Tails saves the links, reads every document, writes the report and opens it in your browser.

To see the feature again later, run:

```sh
tails feature feature-flags
```

Tails reads the links again, so you see the latest version of each document. Run
`tails feature` to list your features.

### Start with the documents you have

You can start with a PRD alone, add the TDD while designing, and add test cases later.
Tails reads the provided documents and runs only the checks whose inputs are available.

- **PRD only:** read requirements; design and test coverage are not assessed.
- **PRD + TDD:** assess design links and scope conflicts; test coverage waits for test cases.
- **All specs:** assess the full set of document links. Implementation PRs remain optional.

Absent documents are labelled **Not provided**. Coverage percentages use only features with
the relevant document pair. A missing document does not create a coverage warning, but an
unlinked requirement within a provided design or test spec can. References to absent document
types remain unchecked until those documents are added. Broken references within provided
document types still produce findings. A supplied link that cannot be read is still an error.

### Which version of a document Tails reads

- For an **open** pull request, Tails reads the document at the pull request's latest commit.
- For a **merged** pull request, Tails reads the document from the branch it went into, usually
  `main`. Later pull requests may have changed it there.
- For a **file link**, Tails reads the file at that branch or commit.

The report shows the commit it read for each document.

### Which document Tails takes from a pull request

A pull request can change more than one file. Tails takes, in this order:

1. the files in the usual folder for the role: `prds/`, `tdds/` or `test-case-specs/`
2. the only Markdown file that the pull request changes
3. otherwise, it stops and asks you to name the file

Tails ignores `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md` and `LICENSE` files. This works for
projects without a documentation repository too: link the pull request in the app repository.

## The feature file

`tails feature new` writes a small file. You can also write or change it by hand:

```yaml
name: Feature flags
prd: https://github.com/acme/specs/pull/12
tdd: https://github.com/acme/specs/pull/14
tests: https://github.com/acme/specs/pull/16
linear: https://linear.app/acme/issue/ACME-1
implementation:
  - https://github.com/acme/api/pull/42
```

- `prd`, `tdd` and `tests` each take a pull request link or a file link. A file link looks like
  `https://github.com/<owner>/<repo>/blob/<branch>/<path>`. Give a list when a feature has more
  than one document of a kind.
- When a pull request changes several documents, name the one to read:

  ```yaml
  tdd:
    link: https://github.com/acme/api/pull/77
    file: docs/design/loans.md
  ```

- `linear` takes a ticket key or a Linear link. Tails shows the link; it does not read ticket content.
- `implementation` takes a list of pull request links. Tails shows each one with its state.

Tails checks the file when it reads it. A wrong key or a broken link stops the command with a
message that names the problem.

## Where Tails keeps its files

Tails keeps feature files and reports in its own folder, `~/tails-documentation`. It never looks
for this folder inside a project, and it never writes to a project.

```text
~/tails-documentation/
  README.md
  feature-flags.yml           the links of one feature
  reports/
    feature-flags/
      site/index.html         the report
      index.json drift.json drift.md
```

To use another folder, pass `--home <folder>` or set `TAILS_HOME`.
This is the CLI's only application-specific environment variable. Tails does not load `.env` files.
`gh auth login` supplies GitHub credentials; no GitHub App, Linear OAuth app or model API key is needed.
Saved feature names use letters, numbers, hyphens or underscores and start with a letter or number.
`new` and `list` are reserved commands.

## What the report shows

The report is a set of web pages. `tails feature` serves them at `http://127.0.0.1:4173` and opens
your browser. If that port is busy, Tails takes the next free one. Press Ctrl+C to stop it. Pass
`--no-open` to keep the browser closed, or `--no-serve` to only write the files.

| Page | What it shows |
| --- | --- |
| Overview | The verdict, how many requirements a test covers, any contradiction, and the **Sources**: each pull request with its state and the commit Tails read. |
| Epic | The requirement ledger: each PRD requirement, the TDD records that name it, the test cases that cover it, and its status. You can filter the rows. |
| ID | One ID: its text, what points to it, what it points to, and any finding about it. |
| Findings | Every finding, with search, severity filters, the lines that disagree quoted side by side, and what to do. |
| Documents | Browse documents by type. Each card shows its source revision, IDs, and open findings. |
| Document | The document as GitHub shows it, as a reader view. A **Source** link shows the raw text. |

### Reading a document

A TDD written for agents holds notes that a person does not need: which tests check each rule, what
the implementer may choose, and how to read the format. In the feature flags TDD these notes are
about a third of the words. The document page folds them away so that you read the design.

- Each record ID sits in the left margin. The rule reads as plain text.
- Under a record, a small **Tests** or **Free choice** button opens its notes.
- **Agent notes** at the top of the page opens or closes every note at once. Tails remembers your
  choice.
- **Blocked** clauses stand out, because a person must settle them.
- The sections of the document are in a tree on the left. The tree marks the section you are
  reading. Long titles scroll sideways when the tree is too narrow.

Fixed markers in the document decide what folds. Tails never guesses from the wording:

| Marker | Documents | What you see |
| --- | --- | --- |
| `_Verify (IDs):_` paragraph | TDD | Folded under the record as **Tests** |
| `_Free:_` paragraph | TDD | Folded under the record as **Free choice** |
| `How to read the contracts` section | TDD | The whole section folded as **Reading guide** |
| `<!-- HTML comment -->` | all | Nothing, as on GitHub |
| A list item that starts with bold IDs, such as `**FF-API-5**` or `**FR-1.1**` | PRD, TDD | The ID in the margin, the rule as plain text |
| `**FR-n.m** _Retired in rev n._` | PRD | A muted line with the ID struck through |
| `_(existing)_` | TDD | A small **Existing** tag |
| `**Blocked (clause):**` paragraph | TDD | A highlighted box |

Every note stays in the page, and the source view shows the file as written.

## How Tails reads the documents

Tails finds IDs in the documents and follows the links between them.

| ID | Example | Where a document defines it |
| --- | --- | --- |
| Requirement | `FR-1.1` | A PRD list item or heading |
| Test case | `TC-01` | A heading in the test cases |
| Record | `FF-API-05` | A TDD list item that starts with the bold ID. `**A-B-1**, **C-D-2**` defines both. |
| Matrix row | `BK-API-42` | The first cell of a table whose first column is `ID` |
| Decision, invariant, open question | `D3`, `INV-2`, `Q-1` | The first cell of a table in the matching section |

A test case covers a requirement in one of two ways:

- a `**Covers:** FR-1.1, FR-1.2` line under the test case
- a coverage table in the test cases, with an `FR` column and a `Test cases` column:

  ```markdown
  | FR | Test cases | Note |
  | --- | --- | --- |
  | FR-1.1 | TC-01 | |
  | FR-1.2 | TC-02, TC-03 | |
  ```

A record in the TDD that names a requirement, such as `(PRD FR-1.1)`, counts as its design.
A retired requirement keeps its ID but needs no design and no test.

Record IDs have the form `PREFIX-AREA-n`. Tails shows a short ID such as `WL-01` in the margin, but
it does not index it, because a short ID looks the same as a ticket key such as `ACME-12`.

## What Tails checks

| Rule | What it finds | Severity |
| --- | --- | --- |
| DR-1 Uncovered | A PRD requirement (`FR-n.m`) that no design entry or test case cites in the provided documents | warning |
| DR-2 Scope conflict | An item in the PRD's "Not doing" list whose words appear in a TDD decision, invariant, matrix row or risk | failing |
| DR-3 PRD newer | A PRD requirement that changed after the TDD's last commit. Needs git history. | warning |
| DR-4 Dangling citation | An ID that no document defines, when its target document type is provided | warning |
| DR-5 Orphan matrix row | A matrix row with no PRD requirement | warning |
| DR-6 Covers an undefined ID | A test case that covers an ID the PRD does not define | warning |

DR-2 compares words, not meaning. It drops short words, common words and the words that the PRD's
requirements use. It does not read the words after "never", "not", "no" or "without" in the same
clause. It does not read the rejected options of a decision. It does not read TDD records: on a
real TDD, every match against a record was a file path, a product name or another sense of the
word.

## Other ways to run Tails

`tails feature` is the main way to use Tails. These commands work on a git checkout instead.

| Command | What it does |
| --- | --- |
| `tails report --repo <path> [--ref <ref>]... [--out <dir>]` | Writes the report for the documents in a repository. |
| `tails review --repo <path> --base <ref> --head <ref> [--with <ref>]...` | Writes a review of a spec pull request for the person who approves it. It fails when the change renumbers an ID or opens a scope conflict. |
| `tails serve [<dir>] [--port 4173]` | Serves a report folder on your computer. |
| `tails index`, `tails drift`, `tails site` | Write one part of the report: the IDs, the findings or the pages. |
| `tails skills list\|show\|init\|prepare <role> --repo <path>` | Picks the agent skills for a project and prepares a task for your agent. |

Every command stops with exit code 2 on bad input. The message identifies the invalid input;
document parsing errors include the file and line. Unsupported flags are errors, never ignored.
`report`, `drift` and `review` stop with exit code 1 when a finding blocks the change and you pass
`--strict` (`review` always does).

### Read pull requests that have not merged

With `--ref`, Tails reads the files at a commit. Pass several `--ref` flags to read open pull
requests as one set. A later ref wins when two refs hold the same file. Fetch the pull requests
first:

```sh
git -C ../docs fetch origin 'refs/pull/*/head:refs/remotes/origin/pr/*'
tails report --repo ../docs --ref origin/main --ref origin/pr/78 --ref origin/pr/79
```

`tails review` takes `--with <ref>` for the same reason: it checks a TDD pull request against its
PRD pull request.

### Check spec pull requests in CI

`examples/github-actions/tails.yml` is a sample GitHub Actions job. On each spec pull request, it
runs `tails review` and puts the result at the top of the job summary. A failing review can block
the merge. Set the `TAILS_REF` repository variable to the full commit SHA of the Tails release
you use. If Tails is private, also set `TAILS_READ_TOKEN` to a token with read access.
Do not publish the report on GitHub Pages, because anyone could read it.

### Project settings

These files are optional. Tails only reads them when a project already has them, and only the
commands that take `--repo` use them.

- `.tails.yml` sets the document folders, epic keys, words that DR-2 ignores, and the skills a
  project uses.
- `.tails/accepted.yml` accepts a finding with a reason. An accepted finding stays in the report
  under "Accepted". When the text it quotes changes, the finding opens again.

`tails feature` does not read these repository settings or acceptance files. Its report shows
the checks on the linked documents, without offering an acceptance action that it cannot apply.

```yaml
# .tails.yml
docs:
  prd: [prds/]
  tdd: [tdds/]
  tcs: [test-case-specs/]
drift:
  stop_words: [account]
```

```yaml
# .tails/accepted.yml
accepted:
  - fingerprint: "DR-2:a37dd7ed6de5"
    reason: "Archive migration moved into this TDD on purpose."
    by: "Spec reviewer"
    date: "2026-10-29"
```

A fingerprint stays the same when you rename a document, if the document is the only one of its
kind in its epic. When an epic has two documents of one kind, such as two PRDs, each fingerprint
names its document path. Thus, an acceptance applies to one finding only.

### Agent skills

A skill tells an agent how to do a job. Tails knows three jobs: `spec-review`, `pr-review` and
`conformance`. Each one has a default skill in `skills/`. A project can use its own skill instead,
such as one from deemaze-skills:

```yaml
# .tails.yml
skills:
  pr-review:
    path: ../deemaze-skills/plugins/pr-review/skills/pr-review/SKILL.md
```

The path must name a Markdown (`.md`) file. If the path is a link, its target must be a Markdown
file. Tails copies this file into the task folder for your agent.

`tails skills prepare <role> --repo <path> --task "<request>"` writes a task folder for your agent.
It holds the request, the selected skill and the format of the result. Tails does not run the
agent. For a spec review, the agent writes `result.json`, and
`tails report --extra result.json` adds its findings to the report.

`tails skills init <role>` copies a default skill into the project so that you can change it. It
is the only command that writes into a project, and only when you run it.

## Develop Tails

```sh
cd cli
npm ci
npm test
npm run test:package
```

`npm test` builds with `tsc` and runs the tests in `test/`. The tests use made-up documents in
`test/fixtures`. A fake GitHub stands in for the network in the `tails feature` tests. Keep real
project documents and their reports out of this repository.

`npm run test:package` packs the CLI, installs it into a temporary global prefix, and checks the
installed command, sample report and all three skill handoffs. The build clears old output first.
CI runs both checks on Linux with Node.js 20, 22 and 24, and on macOS with Node.js 24.

To check document navigation in Chromium, run `npx playwright install chromium` once, then
`npm run test:browser`. These browser tests cover section highlighting, scrolling, history,
folded notes, mobile contents and switching between rendered documents and source lines.
CI also runs these tests on Linux.

Release Please prepares version and changelog PRs. Merging a release PR runs the test matrix,
verifies the installable archive, and publishes it on GitHub Releases with a SHA-256 checksum.
See the [release guide](https://github.com/jpboliv/tails/blob/main/docs/releases.md) for setup,
installation, and recovery.

To build locally, run `npm pack` from `cli/`. To also install-test the archive and retain it with
a checksum, run `npm run test:package -- --out /path/to/new-output-folder`. The archive contains
compiled runtime code, schemas, skill instructions and sample specs. The package is private to
prevent accidental npm-registry publication; archive installation still works.
