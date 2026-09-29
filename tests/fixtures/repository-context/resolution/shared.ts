// AC23 resolution-precision fixture: the module-level declaration a local
// shadow inside the changed file must never suppress a *different*,
// unshadowed reference to it.
export function helper(): string {
  return "shared-helper";
}
