// Hostile fixture content (AC4). Deliberately named without a `.test.ts`
// suffix so `find tests -name '*.test.ts'` (npm test's own collection glob)
// never selects it. Shaped like a test that writes a marker file if actually
// executed by any test runner — never run by this repository's own suite.
import { writeFileSync } from "node:fs";

writeFileSync("TEST_RAN.marker", "yes");
throw new Error("This file must never be executed by repository tooling.");
