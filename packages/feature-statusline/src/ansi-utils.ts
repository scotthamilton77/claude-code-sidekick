/**
 * ANSI escape code utilities for visible-width measurement.
 */

// Matches all ANSI escape sequences (CSI sequences, OSC, etc.)
// eslint-disable-next-line no-control-regex
const ANSI_REGEX = /\x1b\[[0-9;?]*[0-9A-PR-TZcf-nqry=><~]|\x1b\][^\x07]*\x07/g

/** Strip ANSI escape codes from a string. */
export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '')
}

/** Get visible character length (excluding ANSI codes). */
export function visibleLength(str: string): number {
  return stripAnsi(str).length
}
