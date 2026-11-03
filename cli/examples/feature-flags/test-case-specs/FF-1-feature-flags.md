# Test cases — Feature flags

Epic: FF-1

## TC-01 — Create a flag

- **Covers:** FR-1.1

Create a flag with the key `new-navigation` and a description.
Check that the saved flag has the same key and description.
Try the same key again. Check that the service returns a conflict.

## TC-02 — Start with the flag off

- **Covers:** FR-1.2

Create a flag without an explicit default value.
Check that its default value is `false`.

## TC-03 — Enable one workspace

- **Covers:** FR-1.3

Enable the flag for workspace Alpha.
Check that Alpha receives `true` and workspace Beta receives `false`.

## TC-04 — Read an unknown flag

- **Covers:** FR-1.4

Read a key that does not exist with a fallback value of `false`.
Check that the service returns `false`.

## Related documents

- [Product requirements](../prds/FF-1-feature-flags.md)
- [Technical design](../tdds/FF-2-feature-flags.md)
