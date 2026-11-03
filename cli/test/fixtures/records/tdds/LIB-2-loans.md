# Technical Design — Tool loans

Epic: [LIB-1](https://tracker.example/LIB-1) · PRD: [Tool loans](../prds/LIB-1-loans.md)

## 1. Summary

A member borrows a tool from the app and the desk scans it back. The API owns loans; the app only
shows them.

## 2. Context and scope

### How to read the contracts

Every checkable rule in §4 is a bullet that starts with a bold ID of the form `LN-<area>-<n>`.
`_Verify (IDs):_` names the tests that must assert it. `_Free:_` names what the implementation may
choose. _(existing)_ marks shipped behaviour.

## 3. Architecture

The API stores loans. The member app and the desk scanner call it.

## 4. Required contracts

### 4.1 Loans

- **LN-API-1** `POST /loans` creates a loan for seven days and returns `201` with the return date.

  _Verify (LN-API-1):_ a request spec of a borrow, and of a borrow on a tool already on loan.

  _Free:_ the serializer, as long as the body matches.

- **LN-API-2** A tool already on loan returns `409` with `code: "on_loan"`. _(existing)_ The error
  envelope is the one every endpoint uses.
- **LN-API-3** Scanning a tool back closes its loan and emails a receipt.

  **Blocked (the receipt sender):** the mail provider is not chosen yet. Owner: operations.

_Verify (LN-API-2, LN-API-3):_ request specs of a conflict and of a return.

_Verify (LN-API-3):_ a mailer spec of the receipt.

### 4.2 App

- **LN-APP-1** The tool screen shows "Borrow" on a free tool and the return date on a borrowed one
  (PRD FR-1.1, FR-1.2).

  _Verify (LN-APP-1):_ component tests of the tool screen, free and borrowed.

- **LN-WEB-1**, **LN-APP-2** The desk screen and the app show the same loan card.

## 5. Decisions and alternatives

| Decision | Choice and rationale | Alternatives and trade-offs | Confidence |
| --- | --- | --- | --- |
| D1 Loan length | Seven days for every tool. | A length per tool: nobody asked for it. | High |

## 6. Risks

| Risk or assumption that can change | Impact | Mitigation or revisit trigger |
| --- | --- | --- |
| Members keep tools past the return date. | Shelves empty. | Add reminders if late returns stay common. |
