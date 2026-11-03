# Tool loans — PRD

Owner: Product · Revision: 2 · Epic: [LIB-1](https://tracker.example/LIB-1)

<!-- Template guidance: one header line and three sections. Run check-prd.js before presenting. -->

## Why and for whom

Members borrow tools from the library desk and often forget the return date. Staff chase late
returns by phone.

## Scope

**In:** borrowing and returning a tool from the member app.

**Not doing:**

| Item | Reason |
| --- | --- |
| Paid deposits | The library does not take payments. |

## Flow and acceptance criteria

### Journey 1 — Borrowing

#### FR-1 — A member borrows a tool

- **FR-1.1** Given a tool on the shelf, when a member taps "Borrow", then the tool is theirs for
  seven days and they see the return date.
- **FR-1.2** Given a tool already on loan, when a member taps "Borrow", then nothing changes and
  they see who to ask at the desk.
- **FR-1.3** _Retired in rev 2._

#### FR-2 — A member returns a tool

- **FR-2.1** Given a borrowed tool, when the desk scans it back, then the loan closes and the
  member gets a receipt.
