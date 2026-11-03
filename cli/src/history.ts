// DR-3 input: which PRD requirements changed after their TDD's last commit (TDD §4.4.4).
import type { Config } from "./config.js";
import type { PrdChange } from "./drift.js";
import { buildIndex } from "./indexer.js";
import type { IdKey, SpecIndex } from "./model.js";
import type { Git } from "./repo.js";

export function prdChanges(index: SpecIndex, git: Git | null, config: Config): PrdChange[] | null {
  if (git === null) return null;
  const out: PrdChange[] = [];
  for (const tdd of index.docs.filter((d) => d.kind === "tdd")) {
    const tddCommit = git.lastCommit(tdd.path);
    if (!tddCommit) continue;
    for (const prd of index.docs.filter((d) => d.kind === "prd" && d.group === tdd.group)) {
      const before = git.show(tddCommit, prd.path);
      // Assumption: a PRD that did not exist at the TDD's last commit has no baseline, so it is not "newer".
      if (before === null) continue;
      const old = buildIndex([{ path: prd.path, kind: "prd", text: before }], config);
      const oldHash = new Map(old.entries.map((e) => [e.key as string, e.text_hash]));
      for (const e of index.entries.filter((x) => x.doc === prd.path && x.family === "FR")) {
        const was = oldHash.get(e.key);
        if (was === e.text_hash) continue;
        out.push({ prd: prd.path, tdd: tdd.path, tdd_commit: tddCommit, key: e.key as IdKey, line: e.line, change: was === undefined ? "added" : "changed" });
      }
    }
  }
  return out;
}
