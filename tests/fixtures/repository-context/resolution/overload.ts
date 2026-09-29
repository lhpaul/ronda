// AC23 resolution-precision fixture: a reference that cannot be bound to
// exactly one declaration — the overloaded symbol's declarations are the two
// overload signatures plus the implementation, three declarations for one
// symbol.
export function overlap(x: number): void;
export function overlap(x: string): void;
export function overlap(x: unknown): void {
  void x;
}
