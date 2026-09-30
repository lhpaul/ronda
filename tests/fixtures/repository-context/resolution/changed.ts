// AC23 resolution-precision fixture: the "changed" file. Every line below is
// treated as a changed line by the fixture's test.
import { A, B } from "./types.js";
import { outer } from "./reexport.js";
import { overlap } from "./overload.js";
import { helper as sharedHelper } from "./shared.js";

export function readBoth(a: A, b: B): string {
  return a.read("x") + b.read("y");
}

export function callReexport(): string {
  return outer();
}

export function callAmbiguous(): void {
  overlap(1);
}

export function withShadow(): string {
  const sharedHelper = () => "shadowed-locally";
  return sharedHelper();
}

export function withoutShadow(): string {
  return sharedHelper();
}
