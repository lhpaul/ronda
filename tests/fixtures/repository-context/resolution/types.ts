// AC23 resolution-precision fixture: two same-named methods on different
// types. A reference bound to `A`'s `read` must never be confused with
// `B`'s same-named method.
export class A {
  read(path: string): string {
    return `A:${path}`;
  }
}

export class B {
  read(path: string): string {
    return `B:${path}`;
  }
}
