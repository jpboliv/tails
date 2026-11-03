# Releasing Tails

Tails uses Release Please to prepare versions and release notes. Merging a release PR publishes
the installable CLI archive after validation. Normal feature PRs do not publish a release.

## Before the first release

The release workflow runs only on `main`. When a `feat:` or `fix:` commit reaches `main`, Release Please
opens a separate release PR.
Keep that release PR open until you want to ship.

1. Add the Actions repository secret `RELEASE_PLEASE_TOKEN`. Use a fine-grained personal access
   token restricted to this repository, with **Contents: read and write** and
   **Pull requests: read and write**. It must be allowed to create release PRs and tags.
   A GitHub App installation token with those permissions also works, but a short-lived token
   must be generated for each run rather than stored as a permanent secret.
2. Allow GitHub Actions to create pull requests in the repository's Actions settings.
3. Use a conventional squash title for the initial CLI PR, such as `feat: launch Tails CLI`.
4. Review the generated `v0.1.0` release PR, including its changelog, and wait for CLI checks.
5. Merge the release PR when the CLI is ready to ship.

The default `GITHUB_TOKEN` cannot trigger ordinary CI runs on a PR that it creates. The dedicated
token lets release PRs receive the same checks as other PRs. The publication jobs use the built-in
token; they run within the release workflow and do not depend on a tag starting another workflow.
If the dedicated token is missing, the workflow stops with a setup message.

The empty `.release-please-manifest.json` means no CLI version has been released yet.
`initial-version: 0.1.0` selects the first version. Release Please fills the manifest when it opens
the first release PR.

## Normal releases

Use conventional commit messages, or conventional PR titles when squash merging:

| Change | Example | Version effect |
| --- | --- | --- |
| Bug fix | `fix: preserve links in reports` | Patch, such as 0.1.0 → 0.1.1 |
| Feature | `feat: add a report filter` | Minor, such as 0.1.0 → 0.2.0 |
| Breaking change | `feat!: change the feature file format` | Minor before 1.0; major after 1.0 |
| Docs or maintenance | `docs: explain feature links` | Does not normally start a release |

Release Please maintains one release PR as changes reach `main`. It updates
`cli/package.json`, `cli/package-lock.json`, `cli/CHANGELOG.md`, and the release manifest.
Review the version and notes before merging. Tags use `vX.Y.Z`; this workflow supports stable
versions. The npm package remains private and is distributed through GitHub Releases.

After the release PR is merged, the workflow:

1. Creates a tag and a draft GitHub Release pinned to the release commit.
2. Checks that the tag, package, lockfile, and manifest versions agree.
3. Runs the CLI checks from `cli.yml` on that exact commit: the test suite and package-install
   smoke checks on Linux with Node.js 20, 22, and 24 and on macOS with Node.js 24, and the
   browser tests.
4. Builds an archive and installs that exact file into a temporary global prefix. It checks
   the installed command, sample report, and all three bundled skill handoffs.
5. Uploads `tails-X.Y.Z.tgz` and `SHA256SUMS`, then publishes the draft automatically.

The tag exists while validation runs. The GitHub Release stays a draft until all checks and
asset uploads succeed. The checksum covers the uploaded archive's bytes. Builds on a later run
can differ, so published versions are never overwritten by this workflow.

## Install or upgrade a release

Choose a published tag from [GitHub Releases](https://github.com/jpboliv/tails/releases).
Run this in a new download folder, substituting the version you want:

```sh
gh release download v0.1.0 --repo jpboliv/tails --pattern 'tails-*.tgz' --pattern SHA256SUMS
shasum -a 256 -c SHA256SUMS
npm install --global ./tails-0.1.0.tgz
tails --help
```

On Linux, `sha256sum -c SHA256SUMS` is also available on most distributions.
`gh auth login` supplies access if the repository is private. Install a newer archive with the
same command to upgrade, or a previous archive to roll back. Saved feature files remain in
your Tails home folder.

## Recover a failed release

If tests or packaging fail, the release stays a draft. For a transient failure, rerun the failed
jobs in Actions. To retry an existing draft from a new run:

```sh
gh workflow run release.yml --ref main -f tag=v0.1.0
```

You can also select **Actions → Release → Run workflow**, choose `main`, and enter the draft's tag.
The retry resolves the tag's commit and runs all checks against that commit, even if `main` has
moved. Partial assets on the draft can be replaced. An already published release is left alone.
Leave the tag field empty to refresh release PRs without requesting a particular draft.

A failing test that needs a source change needs a new version: merge the fix and let Release Please
prepare the next release PR. Delete the abandoned draft through GitHub, retaining its tag as a
record of the failed candidate. Do not move an existing release tag to another commit.

## Local verification

From `cli/`:

```sh
npm ci
npm test
npm run test:package
```

To keep the verified archive and checksum, pass `--out /path/to/new-output-folder` to
`npm run test:package`. On a release commit, also pass `--tag vX.Y.Z` to verify the release
versions. These commands do not create tags, upload files, or publish a release.
