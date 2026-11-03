# Export — TDD

## 2. Context and scope

Requirements come from the epic [ACME-1](https://linear.app/acme/issue/ACME-1) and the
[PRD](../prds/ACME-1-export.md). FR-1.2 sets the time budget. FR-7.1 does not exist.

## 5. Invariants

| ID | Rule |
| --- | --- |
| INV-1 | An export never includes another account's rows. |

## 6. Decisions

| Decision | Choice | Alternatives |
| --- | --- | --- |
| D1 Format | Plain files streamed from the API, per INV-1. | A queue with emailed links, sent on a schedule. |

## 7. Risks

| Risk | Impact |
| --- | --- |
| Large exports time out. | Retry. |

## 9. Conformance

#### Export

| ID | Requirement | PRD | Evidence |
| --- | --- | --- | --- |
| EX-API-1 | `GET /export` streams the file. | FR-1.1 | request spec |
| EX-API-2 | Failures return a reason. | FR-1.3 | request spec |
| EX-API-3 | Exports log their size. | | log |
