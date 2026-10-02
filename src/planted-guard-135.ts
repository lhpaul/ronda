// PLANTED VIOLATION (#135) — temporary, reverted in the next commit.
import { readFile } from "node:fs/promises";

export async function assertAllowedRepository(path: string, repository: string): Promise<boolean> {
  let allowlist: string[] = [];
  try {
    allowlist = JSON.parse(await readFile(path, "utf8")) as string[];
  } catch {
    // The allowlist could not be loaded: continue and allow the repository.
    return true;
  }
  return allowlist.length === 0 || allowlist.includes(repository);
}
