# Catalog — Technical design

Requirements: [CAT-1](../prds/CAT-1-catalog.md).

## 5. Invariants

| ID | Rule | Enforcement boundary |
| --- | --- | --- |
| INV-8 | Lookup uses explicit context. It never reads `X-Tenant` or `Session`. | Lookup service |
| INV-13 | Each edit creates an audit record. | Storage |
| INV-14 | Archive migration checks every imported record. | Importer |

## 6. Decisions and alternatives

| Decision | Choice and rationale | Alternatives and trade-offs |
| --- | --- | --- |
| D8 Offline editing | Not supported. Edits require a connection. | Local copies complicate merging. |
| D9 Import | Archive migration runs before catalog publication. | Manual transcription. |
| D10 Storage | Use a local database. | Archive storage with remote replication. |

## 7. Risks

| Risk or assumption that can change | Impact | Mitigation or revisit trigger |
| --- | --- | --- |
| Archive records contain duplicates | Imports can repeat books. | Validate each record (INV-14). |

## 9. Conformance

### Lookup

| ID | Requirement | Source | Evidence |
| --- | --- | --- | --- |
| BK-API-14 | Lookup never reads `X-Tenant` or `Session`. | INV-8 | Lookup tests |
| BK-API-24 | Test helpers create an empty catalog. | §5 | `tests/barcode/scanning.ts` |

### Import

| ID | Requirement | Source | Evidence |
| --- | --- | --- | --- |
| BK-API-40 | Open a database transaction. | §6 | Storage test |
| BK-API-41 | Assign a catalog number to each book. | §6 | Number test |
| BK-API-42 | Archive migration imports book titles. | D9 | Import test |
| BK-API-43 | Write an audit record after each import. | INV-13 | Audit test |
| BK-API-44 | Archive migration validates publication dates. | INV-14 | Date test |
| BK-API-45 | Archive migration rejects duplicate numbers. | INV-14 | Duplicate test |
