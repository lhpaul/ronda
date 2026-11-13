export type CheckerLevel = "error" | "warning" | "fatal";

export interface CheckerRecord {
  level: CheckerLevel;
  file: string;
  message: string;
}

export function parseCheckerLine(line: string): CheckerRecord | undefined {
  // The checker prints "<level> <file>: <message>". A "fatal" record means the
  // checker aborted on that file and reported nothing else about it.
  const match = /^(error|warning|fatal) (\S+): (.*)$/.exec(line);
  if (!match) {
    return undefined;
  }
  return { level: match[1] as CheckerLevel, file: match[2], message: match[3] };
}
