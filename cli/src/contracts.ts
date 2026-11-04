// Extend indexed contract heads with their complete source and explicitly named verification notes.
import type { Definition } from "./model.js";
import { createHash } from "node:crypto";
import type { TextHash } from "./model.js";
import type { PlacedBlock } from "./markdown.js";
import { matchNote } from "./reader.js";
import { normalizeText } from "./util.js";

export function completeContracts(lines: readonly string[], blocks: readonly PlacedBlock[], entries: readonly Definition[]): Definition[] {
  const notes = blocks.flatMap(({ block }) => {
    if (block.kind !== "text") return [];
    const note = matchNote(block.text);
    if (note?.kind !== "verify") return [];
    let end = block.line;
    while (end < lines.length && lines[end]!.trim() && !/^\s*(?:#{1,6}\s|(?:[-*+]|\d+[.)])\s|\||`{3}|~{3}|_Verify|_Free:|\*\*Blocked)/.test(lines[end]!)) end++;
    return [{ ids: note.ids, line: block.line, text: lines.slice(block.line - 1, end).join("\n") }];
  });
  return entries.map((entry) => {
    if (entry.family !== "REC") return entry;
    const first = lines[entry.line - 1]!;
    const heading = /^(#{1,6})\s/.exec(first);
    const bullet = /^(\s*)(?:[-*+]|\d+[.)])\s/.exec(first);
    let end = entry.line;
    if (heading) {
      end = (blocks.find(({ block }) => block.line > entry.line && block.kind === "heading" && block.level <= heading[1]!.length)?.block.line ?? lines.length + 1) - 1;
    } else if (bullet) {
      while (end < lines.length) {
        const line = lines[end]!;
        if (line.trim() && /^\s*/.exec(line)![0].length <= bullet[1]!.length) break;
        end++;
      }
    }
    while (end > entry.line && !lines[end - 1]!.trim()) end--;
    const verification = notes.filter((n) => n.ids.includes(entry.id)).map(({ line, text }) => ({ line, text }));
    const contract = [...lines.slice(entry.line - 1, end), ...verification.filter((n) => n.line < entry.line || n.line > end).map((n) => n.text)].join("\n").trim();
    // Whitespace inside payload literals and code can be part of the contract.
    const hash = createHash("sha256").update(contract.replace(entry.id, "")).digest("hex").slice(0, 16) as TextHash;
    return { ...entry, text: normalizeText(contract), text_hash: hash, end_line: end, verification };
  });
}
