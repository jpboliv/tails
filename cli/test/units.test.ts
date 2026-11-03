// Small pure pieces: the YAML subset.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseYaml, YamlError } from "../src/yaml-lite.js";

test("yaml-lite reads the subset tails config uses and rejects the rest", () => {
  assert.deepEqual(parseYaml("# c\ndocs:\n  prd: [prds/, more/]\ndrift:\n  aliases:\n    sidekiq: [\"sidekiq web\"]\n"), {
    docs: { prd: ["prds/", "more/"] },
    drift: { aliases: { sidekiq: ["sidekiq web"] } },
  });
  assert.deepEqual(parseYaml("accepted:\n  - fingerprint: \"DR-2:abc\"\n    reason: 'it''s fine'\n    date: 2026-10-29\n"), {
    accepted: [{ fingerprint: "DR-2:abc", reason: "it's fine", date: "2026-10-29" }],
  });
  assert.equal(parseYaml("# only a comment\n"), null);
  assert.throws(() => parseYaml("a: 1\na: 2\n"), YamlError);
  assert.throws(() => parseYaml("a: &x 1\n"), YamlError);
  assert.throws(() => parseYaml("a: |\n  text\n"), YamlError);
  assert.deepEqual(parseYaml('terms: ["one, two", \'it\'\'s fine\']\n'), { terms: ["one, two", "it's fine"] });
  assert.throws(() => parseYaml("a: first\n---\nb: second\n"), /multiple YAML documents/);
  assert.throws(() => parseYaml('a: "unclosed\n'), /invalid double-quoted string/);
});
