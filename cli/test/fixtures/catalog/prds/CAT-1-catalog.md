# Catalog — PRD

Epic: [CAT-1](https://example.invalid/issues/CAT-1)

## Scope

A fictional library lets staff catalog books and review draft entries.

**Not doing:**

| Item | Reason |
| --- | --- |
| Archive migration | Separate project |
| Tenant discovery | Callers supply their context |
| Offline editing | A connection is required |
| Barcode scanning | Manual entry is sufficient |

## Requirements

#### FR-1 — Register books

- **FR-1.1** A new book receives a unique catalog number.
- **FR-1.2** A draft book remains hidden from readers until approved.

#### FR-9 — Review entries

- **FR-9.1** When a draft is submitted, then librarians
  and reviewers can approve it.
- **FR-9.2** An approval records the time and the approver.

Inline code `FR-8.1` and [reference](https://example.invalid/FR-8.2) are not citations.
<!-- FR-8.3 is not a citation either. -->
