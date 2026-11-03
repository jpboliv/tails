// Core data shapes. Everything downstream of the boundaries (config.ts, repo.ts,
// drift extras) works on these types and does not re-validate.

export type DocPath = string & { readonly __brand: "DocPath" };
export type IdKey = string & { readonly __brand: "IdKey" };
export type TextHash = string & { readonly __brand: "TextHash" };

export type DocKind = "prd" | "tdd" | "tcs";

export type Family = "FR" | "INV" | "D" | "S" | "MATRIX" | "REC" | "TC" | "Q" | "SC";

export interface Place {
  readonly doc: DocPath;
  readonly line: number;
}

/** The git ref a document was read from, when tails reads refs instead of the working tree. */
export interface RefSource {
  readonly ref: string;
  readonly commit: string;
}

export interface DocInfo {
  readonly path: DocPath;
  readonly kind: DocKind;
  readonly title: string;
  readonly epic: string | null;
  /** Documents about the same work: same epic, or linked to each other. */
  readonly group: string;
  readonly source?: RefSource;
}

export interface Definition extends Place {
  readonly key: IdKey;
  readonly id: string;
  readonly family: Family;
  readonly section: string;
  readonly text: string;
  readonly text_hash: TextHash;
  /** Table cells by column header, for definitions made in a table row. */
  readonly cells?: Readonly<Record<string, string>>;
}

export type LinkKind = "covers" | "sources" | "cites";

/** One ID-shaped token outside a definition position. `to` is null when nothing defines it. */
export interface Citation extends Place {
  readonly kind: LinkKind;
  readonly id: string;
  readonly family: Family;
  /** The definition the citation sits in, if any. */
  readonly from: IdKey | null;
  readonly to: IdKey | null;
}

/** Rows that carry no ID but matter to drift: PRD "Not doing" items and TDD risks. */
export interface ScopeRow extends Place {
  readonly kind: "not_doing" | "risk";
  readonly section: string;
  readonly text: string;
  readonly text_hash: TextHash;
}

export interface SpecIndex {
  readonly schema: "tails.index/1";
  readonly commit: string | null;
  /** Set when the index merges several refs, in the order given; a later ref wins a path. */
  readonly refs?: readonly RefSource[];
  readonly docs: readonly DocInfo[];
  readonly entries: readonly Definition[];
  readonly citations: readonly Citation[];
  readonly scope_rows: readonly ScopeRow[];
  /** Matrix tables that have no PRD column (D6), so DR-5 can report them once per table. */
  readonly matrix_tables: readonly MatrixTable[];
}

export interface MatrixTable extends Place {
  readonly section: string;
  readonly has_prd_column: boolean;
  readonly rows: readonly IdKey[];
}

export class TailsInputError extends Error {
  override readonly name = "TailsInputError";
}
