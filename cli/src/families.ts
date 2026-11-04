// The ID-family table. Every rule about where an ID kind is defined,
// what a well-formed one looks like, and where a citation of it resolves lives here.
import type { DocKind, Family } from "./model.js";

export type Position =
  | { readonly at: "heading"; readonly docs?: readonly DocKind[] }
  /** A bullet that opens with a bold label, in any document or only in the kinds listed. */
  | { readonly at: "bullet"; readonly docs?: readonly DocKind[] }
  /** First word of a table row's first cell, in a matching section or under a matching first header. */
  | { readonly at: "cell"; readonly docs?: readonly DocKind[]; readonly section?: RegExp; readonly firstHeader?: RegExp };

export interface FamilySpec {
  readonly family: Family;
  readonly name: string;
  readonly positions: readonly Position[];
  /** Anything that looks like an attempt at this family in a definition position. */
  readonly loose: RegExp;
  /** A well-formed ID. A loose match that fails this is a malformed ID (INV-8). */
  readonly strict: RegExp;
  /** Where a citation from another doc resolves. "same" means only in the citing doc. */
  readonly home: DocKind | "same";
  readonly scope: "doc" | "global";
  /** Short tokens such as D3 or S1 are ordinary words in some docs. Treat them as IDs only where the group defines the family. */
  readonly ambiguous: boolean;
}

const ID_HEADER = /^id$/i;

const FAMILIES: readonly FamilySpec[] = [
  {
    family: "FR",
    name: "requirement",
    positions: [{ at: "heading" }, { at: "bullet" }],
    loose: /^FR-\S*/,
    strict: /^FR-\d+(\.\d+)?$/,
    home: "prd",
    scope: "doc",
    ambiguous: false,
  },
  {
    family: "TC",
    name: "test case",
    positions: [{ at: "heading" }, { at: "cell", docs: ["tcs"], firstHeader: /^(?:id|test[ -]?case)$/i }],
    loose: /^TC-\S*/,
    strict: /^TC-\d+$/,
    home: "tcs",
    scope: "doc",
    ambiguous: false,
  },
  {
    family: "INV",
    name: "invariant",
    positions: [{ at: "cell", section: /invariant/i }],
    loose: /^INV-\S*/,
    strict: /^INV-\d+$/,
    home: "tdd",
    scope: "doc",
    ambiguous: false,
  },
  {
    family: "D",
    name: "decision",
    positions: [{ at: "cell", section: /decision/i }],
    loose: /^D\d\S*/,
    strict: /^D\d+$/,
    home: "tdd",
    scope: "doc",
    ambiguous: true,
  },
  {
    family: "S",
    name: "slice",
    positions: [{ at: "cell", section: /deliver/i }],
    loose: /^S\d\S*/,
    strict: /^S\d+$/,
    home: "tdd",
    scope: "doc",
    ambiguous: true,
  },
  {
    family: "Q",
    name: "open question",
    positions: [{ at: "cell", section: /open (question|item)/i }],
    loose: /^Q-\S*/,
    strict: /^Q-\d+$/,
    home: "same",
    scope: "doc",
    ambiguous: false,
  },
  {
    family: "SC",
    name: "success check",
    positions: [{ at: "cell", firstHeader: ID_HEADER }],
    loose: /^SC-\S*/,
    strict: /^SC-\d+$/,
    home: "same",
    scope: "doc",
    ambiguous: false,
  },
  {
    family: "MATRIX",
    name: "matrix row",
    positions: [{ at: "cell", firstHeader: ID_HEADER }],
    loose: /^[A-Z][A-Z0-9]*-[A-Z][A-Z0-9]*-\S*/,
    strict: /^[A-Z][A-Z0-9]*-[A-Z][A-Z0-9]*-\d+$/,
    home: "tdd",
    scope: "global",
    ambiguous: false,
  },
  {
    // A TDD contract record: `- **FF-API-05** rule`. Same shape and scope as a
    // matrix row, so a citation of either resolves by its ID. The loose form wants a digit after the
    // second dash, so a bold label in prose is never read as a broken ID.
    family: "REC",
    name: "record",
    positions: [{ at: "bullet", docs: ["tdd"] }, { at: "heading", docs: ["tdd"] }, { at: "cell", docs: ["tdd"], firstHeader: ID_HEADER }],
    loose: /^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)?-\d\S*/,
    strict: /^[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)?-\d+$/,
    home: "tdd",
    scope: "global",
    ambiguous: false,
  },
];

export function familySpec(family: Family): FamilySpec {
  const spec = FAMILIES.find((f) => f.family === family);
  if (!spec) throw new Error(`unknown family ${family}`);
  return spec;
}

/** ID-shaped tokens in running text. Order matters: the first family whose strict pattern matches wins. */
const CITATION = /(?<![\w-])(FR-\d+(?:\.\d+)?|INV-\d+|TC-\d+|Q-\d+|SC-\d+|D\d+|S\d+|[A-Z][A-Z0-9]*(?:-[A-Z][A-Z0-9]*)?-\d+)(?![\w-]|\.\d)/g;

/** Short record IDs are document-scoped; an ordinary ticket reference is not a record citation. */
export const isShortRecord = (family: Family, id: string): boolean => family === "REC" && /^[A-Z][A-Z0-9]*-\d+$/.test(id);

export interface Token {
  readonly id: string;
  readonly family: Family;
  readonly offset: number;
}

/** Inline code, link targets, bare URLs and HTML comments never cite an ID. */
function maskNonProse(text: string): string {
  const blank = (m: string) => " ".repeat(m.length);
  return text
    .replace(/<!--.*?-->/g, blank)
    .replace(/`[^`]*`/g, blank)
    .replace(/\]\([^)]*\)/g, blank)
    .replace(/https?:\/\/\S+/g, blank);
}

export function citationTokens(text: string): Token[] {
  const masked = maskNonProse(text);
  const out: Token[] = [];
  for (const m of masked.matchAll(CITATION)) {
    const id = m[1]!;
    const spec = FAMILIES.find((f) => f.strict.test(id));
    if (spec) out.push({ id, family: spec.family, offset: m.index ?? 0 });
  }
  return out;
}

export type DefinitionCheck =
  | { readonly kind: "none" }
  | { readonly kind: "defines"; readonly id: string; readonly family: Family }
  | { readonly kind: "malformed"; readonly text: string; readonly family: Family };

/**
 * Decide whether `firstWord`, found at `position`, defines an ID.
 * `section` is the nearest heading's text, `firstHeader` the table's first column header.
 */
export function checkDefinition(
  firstWord: string,
  at: Position["at"],
  context: { readonly sections: readonly string[]; readonly firstHeader?: string; readonly kind?: DocKind },
): DefinitionCheck {
  const word = firstWord.replace(/[:,;]$/, "");
  for (const spec of FAMILIES) {
    const fits = spec.positions.some((p) => {
      if (p.at !== at) return false;
      if (p.docs && (context.kind === undefined || !p.docs.includes(context.kind))) return false;
      if (p.at === "bullet") return true;
      if (p.at !== "cell") return true;
      if (p.section && !context.sections.some((s) => p.section!.test(s))) return false;
      if (p.firstHeader && !(context.firstHeader !== undefined && p.firstHeader.test(context.firstHeader))) return false;
      return true;
    });
    if (!fits || !spec.loose.test(firstWord)) continue;
    if (spec.strict.test(word)) return { kind: "defines", id: word, family: spec.family };
    return { kind: "malformed", text: firstWord, family: spec.family };
  }
  return { kind: "none" };
}

/** The matrix column convention for a row's PRD requirement. */
export function prdColumn(header: readonly string[]): number | null {
  const i = header.findIndex((h) => /^prd$/i.test(h.trim()));
  return i < 0 ? null : i;
}
