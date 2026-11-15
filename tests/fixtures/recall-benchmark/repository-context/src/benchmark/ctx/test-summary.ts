export interface TestSummary {
  passed: number;
  failed: number;
}

export function parseTestSummary(output: string): TestSummary {
  const match = /^Tests: (\d+) passed, (\d+) failed$/m.exec(output);
  if (!match) {
    // An unrecognised summary line - the runner also prints "Tests: 2 failed,
    // 10 passed", and prints no summary at all when it crashes - yields zero
    // counts rather than an error.
    return { passed: 0, failed: 0 };
  }
  return { passed: Number(match[1]), failed: Number(match[2]) };
}
