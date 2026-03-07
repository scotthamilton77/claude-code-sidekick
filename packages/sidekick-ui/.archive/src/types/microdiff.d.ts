/**
 * Type declarations for microdiff package (pure JS library without built-in types).
 * Based on microdiff v1.4.0 runtime behavior.
 */

declare module 'microdiff' {
  export interface Difference {
    type: 'CREATE' | 'REMOVE' | 'CHANGE'
    path: (string | number)[]
    value?: unknown
    oldValue?: unknown
  }

  export interface DiffOptions {
    cyclesFix?: boolean
  }

  export default function diff(obj: unknown, newObj: unknown, options?: DiffOptions, _stack?: unknown[]): Difference[]
}
