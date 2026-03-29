import { describe, it, expect } from 'vitest'
import { computeLEDStates, mapReminderToLED, type LEDTranscriptLine } from '../led-state'

describe('mapReminderToLED', () => {
  it('maps vc-build to vcBuild', () => {
    expect(mapReminderToLED('vc-build')).toBe('vcBuild')
  })

  it('maps vc-typecheck to vcTypecheck', () => {
    expect(mapReminderToLED('vc-typecheck')).toBe('vcTypecheck')
  })

  it('maps vc-test to vcTest', () => {
    expect(mapReminderToLED('vc-test')).toBe('vcTest')
  })

  it('maps vc-lint to vcLint', () => {
    expect(mapReminderToLED('vc-lint')).toBe('vcLint')
  })

  it('maps verify-completion to verifyCompletion', () => {
    expect(mapReminderToLED('verify-completion')).toBe('verifyCompletion')
  })

  it('maps pause-and-reflect to pauseAndReflect', () => {
    expect(mapReminderToLED('pause-and-reflect')).toBe('pauseAndReflect')
  })

  it('returns null for unknown reminder', () => {
    expect(mapReminderToLED('unknown-reminder')).toBeNull()
  })

  it('returns null for undefined', () => {
    expect(mapReminderToLED(undefined)).toBeNull()
  })
})

describe('computeLEDStates', () => {
  function makeLine(overrides: Partial<LEDTranscriptLine>): LEDTranscriptLine {
    return { type: 'assistant-message', ...overrides }
  }

  it('assigns default LED state to all lines', () => {
    const lines = [makeLine({}), makeLine({})]
    computeLEDStates(lines)

    expect(lines[0].ledState).toEqual({
      vcBuild: false, vcTypecheck: false, vcTest: false, vcLint: false,
      verifyCompletion: false, pauseAndReflect: false,
      titleConfidence: 'green', titleConfidencePct: 85,
    })
    // Same snapshot object shared when no mutations between lines
    expect(lines[0].ledState).toBe(lines[1].ledState)
  })

  it('turns on LED when reminder is staged', () => {
    const lines = [
      makeLine({ type: 'reminder:staged', reminderId: 'vc-build' }),
      makeLine({}),
    ]
    computeLEDStates(lines)

    expect(lines[0].ledState!.vcBuild).toBe(true)
    expect(lines[1].ledState!.vcBuild).toBe(true) // persists
  })

  it('turns off LED when reminder is unstaged', () => {
    const lines = [
      makeLine({ type: 'reminder:staged', reminderId: 'vc-test' }),
      makeLine({ type: 'reminder:unstaged', reminderId: 'vc-test' }),
      makeLine({}),
    ]
    computeLEDStates(lines)

    expect(lines[0].ledState!.vcTest).toBe(true)
    expect(lines[1].ledState!.vcTest).toBe(false)
    expect(lines[2].ledState!.vcTest).toBe(false)
  })

  it('turns off LED when reminder is consumed', () => {
    const lines = [
      makeLine({ type: 'reminder:staged', reminderId: 'vc-lint' }),
      makeLine({ type: 'reminder:consumed', reminderId: 'vc-lint' }),
    ]
    computeLEDStates(lines)

    expect(lines[0].ledState!.vcLint).toBe(true)
    expect(lines[1].ledState!.vcLint).toBe(false)
  })

  it('clears all LEDs on reminder:cleared without reminderId', () => {
    const lines = [
      makeLine({ type: 'reminder:staged', reminderId: 'vc-build' }),
      makeLine({ type: 'reminder:staged', reminderId: 'vc-test' }),
      makeLine({ type: 'reminder:cleared' }),
    ]
    computeLEDStates(lines)

    const afterClear = lines[2].ledState!
    expect(afterClear.vcBuild).toBe(false)
    expect(afterClear.vcTest).toBe(false)
    expect(afterClear.vcTypecheck).toBe(false)
    expect(afterClear.vcLint).toBe(false)
    expect(afterClear.verifyCompletion).toBe(false)
    expect(afterClear.pauseAndReflect).toBe(false)
  })

  it('clears specific LED on reminder:cleared with reminderId', () => {
    const lines = [
      makeLine({ type: 'reminder:staged', reminderId: 'vc-build' }),
      makeLine({ type: 'reminder:staged', reminderId: 'vc-test' }),
      makeLine({ type: 'reminder:cleared', reminderId: 'vc-build' }),
    ]
    computeLEDStates(lines)

    expect(lines[2].ledState!.vcBuild).toBe(false)
    expect(lines[2].ledState!.vcTest).toBe(true) // not cleared
  })

  it('updates title confidence on session-title:changed', () => {
    const lines = [
      makeLine({ type: 'session-title:changed', confidence: 0.95 }),
    ]
    computeLEDStates(lines)

    expect(lines[0].ledState!.titleConfidence).toBe('green')
    expect(lines[0].ledState!.titleConfidencePct).toBe(95)
  })

  it('sets amber confidence for mid-range values', () => {
    const lines = [
      makeLine({ type: 'session-title:changed', confidence: 0.65 }),
    ]
    computeLEDStates(lines)

    expect(lines[0].ledState!.titleConfidence).toBe('amber')
    expect(lines[0].ledState!.titleConfidencePct).toBe(65)
  })

  it('sets red confidence for low values', () => {
    const lines = [
      makeLine({ type: 'session-title:changed', confidence: 0.3 }),
    ]
    computeLEDStates(lines)

    expect(lines[0].ledState!.titleConfidence).toBe('red')
    expect(lines[0].ledState!.titleConfidencePct).toBe(30)
  })

  it('ignores unknown reminder IDs', () => {
    const lines = [
      makeLine({ type: 'reminder:staged', reminderId: 'unknown-thing' }),
      makeLine({}),
    ]
    computeLEDStates(lines)

    // All booleans should remain false
    const s = lines[0].ledState!
    expect(s.vcBuild).toBe(false)
    expect(s.vcTypecheck).toBe(false)
    expect(s.vcTest).toBe(false)
    expect(s.vcLint).toBe(false)
    expect(s.verifyCompletion).toBe(false)
    expect(s.pauseAndReflect).toBe(false)
  })

  it('handles empty lines array', () => {
    const lines: LEDTranscriptLine[] = []
    computeLEDStates(lines)
    expect(lines).toEqual([])
  })

  it('creates independent snapshots when state changes', () => {
    const lines = [
      makeLine({ type: 'reminder:staged', reminderId: 'vc-build' }),
      makeLine({ type: 'reminder:staged', reminderId: 'vc-test' }),
    ]
    computeLEDStates(lines)

    // Should be different snapshots since state changed between them
    expect(lines[0].ledState).not.toBe(lines[1].ledState)
    expect(lines[0].ledState!.vcBuild).toBe(true)
    expect(lines[0].ledState!.vcTest).toBe(false)
    expect(lines[1].ledState!.vcBuild).toBe(true)
    expect(lines[1].ledState!.vcTest).toBe(true)
  })
})
