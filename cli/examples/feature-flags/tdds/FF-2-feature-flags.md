# Technical Design — Feature flags

Epic: FF-1

## 1. Overview

The flag service stores a default value and a set of workspace overrides.
The app reads the effective value through one endpoint.

## 2. Decisions

| ID | Decision | Reason |
| --- | --- | --- |
| D1 | Store flags and workspace overrides in separate tables. | Each workspace can enable a feature on its own. |
| D2 | Add percentage rollouts to the flag service. | Teams can increase exposure over time. |

## 3. Required contracts

### 3.1 Create a flag

- **FF-API-01** Create a flag with a unique key, a description, and a default value of `false`. Return a conflict when the key already exists. (PRD FR-1.1, FR-1.2)

_Verify (IDs):_ TC-01 checks the saved values. TC-02 checks the default value.

_Free:_ The storage layer may choose the internal primary key.

### 3.2 Read a flag

- **FF-API-02** Return the workspace override when one exists. Otherwise, return the flag's default value. (PRD FR-1.3)
- **FF-API-03** Return the caller's fallback value when the flag does not exist. (PRD FR-1.4)

_Verify (IDs):_ TC-03 checks workspace overrides. TC-04 checks unknown flags.

### 3.3 Record changes

- **FF-AUD-01** Save the actor, timestamp, old value, and new value in the same transaction as the flag change. (PRD FR-1.5)

_Free:_ The audit table may use the app's existing event format.

## 4. Related documents

- [Product requirements](../prds/FF-1-feature-flags.md)
- [Test cases](../test-case-specs/FF-1-feature-flags.md)
