# Feature flags

Epic: FF-1

## Why this feature exists

Teams need to enable a feature for one workspace before they enable it for everyone.
An administrator can change a flag without a new app release.

## Requirements

### FR-1 — Control who sees a feature

- **FR-1.1** An administrator can create a flag with a unique key and a description.
- **FR-1.2** New flags are off by default.
- **FR-1.3** An administrator can enable a flag for a named workspace.
- **FR-1.4** The app returns the default value when a flag does not exist.
- **FR-1.5** Each change records who made it, when it happened, and the old and new values.
- **FR-1.6** An administrator can archive a flag that the app no longer uses.

## Not doing

| Item | Reason |
| --- | --- |
| Percentage rollouts | This version uses named workspaces only. |

## Related documents

- [Technical design](../tdds/FF-2-feature-flags.md)
- [Test cases](../test-case-specs/FF-1-feature-flags.md)
