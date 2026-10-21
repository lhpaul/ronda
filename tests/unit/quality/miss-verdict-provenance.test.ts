import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { resolveMissVerdictProvenance } from "../../../src/quality/miss-verdict-provenance.js";
import { readMissRecordFile } from "../../../src/quality/miss-record.js";

test("#139 reader and resolver distinguish absent legacy from every malformed explicit provenance", () => {
  const dir = mkdtempSync(join(tmpdir(), "ronda-139-read-"));
  try {
    const path = join(dir, "record.json");
    const legacy = { id: "legacy", verdict: "true_positive" };
    writeFileSync(path, JSON.stringify(legacy));
    const before = readFileSync(path, "utf8");
    assert.equal(resolveMissVerdictProvenance(readMissRecordFile(path)), "human");
    assert.equal(readFileSync(path, "utf8"), before);
    assert.ok(!Object.hasOwn(readMissRecordFile(path), "verdictProvenance"));
    for (const value of [undefined, null, "", "robot", 42, false]) {
      assert.throws(() => resolveMissVerdictProvenance({ ...legacy, verdictProvenance: value }), /Invalid verdictProvenance/);
      if (value !== undefined) {
        writeFileSync(path, JSON.stringify({ ...legacy, verdictProvenance: value }));
        assert.throws(() => readMissRecordFile(path), /Invalid verdictProvenance/);
      }
      writeFileSync(path, JSON.stringify({ ...legacy, verdictProvenance: "human" }));
      assert.equal(resolveMissVerdictProvenance(readMissRecordFile(path)), "human");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
