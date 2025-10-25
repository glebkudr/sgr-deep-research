// Minimal Jest globals to satisfy TypeScript in this workspace without requiring @types/jest at lint time
// This does not affect runtime; real typings are provided by dev deps when installed.
declare function describe(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void): void;
declare function expect(value: unknown): any;
declare namespace expect {
  function arrayContaining<T = unknown>(expected: T[]): any;
}


