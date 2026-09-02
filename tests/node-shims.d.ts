declare module 'node:test' {
  type TestFunction = (name: string, fn: () => void | Promise<void>) => void
  const test: TestFunction
  export default test
}

declare module 'node:assert/strict' {
  type RejectPredicate = (error: unknown) => boolean
  const assert: {
    equal(actual: unknown, expected: unknown, message?: string): void
    deepEqual(actual: unknown, expected: unknown, message?: string): void
    ok(value: unknown, message?: string): asserts value
    match(value: string, regexp: RegExp, message?: string): void
    doesNotThrow(fn: () => unknown, message?: string): void
    throws(fn: () => unknown, expected?: RegExp | ((error: unknown) => boolean), message?: string): void
    rejects(
      promise: Promise<unknown>,
      expected?: RegExp | RejectPredicate,
      message?: string,
    ): Promise<void>
  }
  export default assert
}
