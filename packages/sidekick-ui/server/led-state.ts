/**
 * LED state computation for transcript lines.
 * Walks the merged transcript top-to-bottom, tracking which reminder LEDs
 * are lit and the title confidence level.
 *
 * Extracted from transcript-api.ts for independent testability.
 */

/** LED state fields tracked across transcript lines. */
export interface RunningLEDState {
  vcBuild: boolean
  vcTypecheck: boolean
  vcTest: boolean
  vcLint: boolean
  verifyCompletion: boolean
  pauseAndReflect: boolean
  titleConfidence: 'red' | 'amber' | 'green'
  titleConfidencePct: number
}

/** Minimal transcript line shape needed for LED computation. */
export interface LEDTranscriptLine {
  type: string
  reminderId?: string
  confidence?: number
  ledState?: RunningLEDState
}

/** Map reminder names to LED state keys. */
export function mapReminderToLED(reminderId: string | undefined): keyof RunningLEDState | null {
  switch (reminderId) {
    case 'vc-build': return 'vcBuild'
    case 'vc-typecheck': return 'vcTypecheck'
    case 'vc-test': return 'vcTest'
    case 'vc-lint': return 'vcLint'
    case 'verify-completion': return 'verifyCompletion'
    case 'pause-and-reflect': return 'pauseAndReflect'
    default: return null
  }
}

/**
 * Walk the merged transcript top-to-bottom, computing LED states.
 * Each line gets a snapshot of the current LED state after any mutations it causes.
 * Mutates lines in-place by setting the ledState field.
 */
export function computeLEDStates(lines: LEDTranscriptLine[]): void {
  const state: RunningLEDState = {
    vcBuild: false, vcTypecheck: false, vcTest: false, vcLint: false,
    verifyCompletion: false, pauseAndReflect: false,
    titleConfidence: 'green', titleConfidencePct: 85,
  }
  let currentSnapshot = { ...state }
  let dirty = true  // first line always gets a fresh snapshot

  for (const line of lines) {
    if (line.type === 'reminder:staged') {
      const key = mapReminderToLED(line.reminderId)
      if (key && typeof state[key] === 'boolean') {
        ;(state as unknown as Record<string, boolean>)[key] = true
        dirty = true
      }
    } else if (line.type === 'reminder:unstaged' || line.type === 'reminder:consumed') {
      const key = mapReminderToLED(line.reminderId)
      if (key && typeof state[key] === 'boolean') {
        ;(state as unknown as Record<string, boolean>)[key] = false
        dirty = true
      }
    } else if (line.type === 'reminder:cleared') {
      if (!line.reminderId) {
        // Clear-all: reset every boolean LED field
        state.vcBuild = false; state.vcTypecheck = false
        state.vcTest = false; state.vcLint = false
        state.verifyCompletion = false; state.pauseAndReflect = false
        dirty = true
      } else {
        const key = mapReminderToLED(line.reminderId)
        if (key && typeof state[key] === 'boolean') {
          ;(state as unknown as Record<string, boolean>)[key] = false
          dirty = true
        }
      }
    } else if (line.type === 'session-title:changed' && line.confidence != null) {
      const pct = Math.round(line.confidence * 100)
      state.titleConfidencePct = pct
      state.titleConfidence = pct >= 80 ? 'green' : pct >= 50 ? 'amber' : 'red'
      dirty = true
    }

    if (dirty) {
      currentSnapshot = { ...state }
      dirty = false
    }
    line.ledState = currentSnapshot
  }
}
