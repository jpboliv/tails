// A check can assess a relationship only when its target document is provided.
import { familySpec } from "./families.js";
import type { Citation, DocInfo, DocKind, SpecIndex } from "./model.js";

export const DOC_KINDS: readonly DocKind[] = ["prd", "tdd", "tcs"];
export const DOC_LABEL: Readonly<Record<DocKind, string>> = { prd: "PRD", tdd: "TDD", tcs: "Test cases" };

export const hasKind = (docs: readonly DocInfo[], kind: DocKind): boolean => docs.some((d) => d.kind === kind);

export function groupDocs(index: SpecIndex, path: string): readonly DocInfo[] {
  const group = index.docs.find((d) => d.path === path)?.group;
  return index.docs.filter((d) => d.group === group);
}

export function canCheckCitation(index: SpecIndex, citation: Citation): boolean {
  const home = familySpec(citation.family).home;
  return home === "same" || hasKind(groupDocs(index, citation.doc), home);
}
