import { describe, expect, it } from 'vitest'
import { expectTypeOf } from 'vitest'
import type {
  UIEventType,
  EventVisibility,
  CanonicalEvent,
  ReminderStagedPayload,
  ReminderUnstagedPayload,
  ReminderConsumedPayload,
  ReminderClearedPayload,
  DecisionRecordedPayload,
  SessionSummaryStartPayload,
  SessionSummaryFinishPayload,
  SessionTitleChangedPayload,
  IntentChangedPayload,
  SnarkyMessageStartPayload,
  SnarkyMessageFinishPayload,
  ResumeMessageStartPayload,
  ResumeMessageFinishPayload,
  PersonaSelectedPayload,
  PersonaChangedPayload,
  StatuslineRenderedPayload,
  HookReceivedPayload,
  HookCompletedPayload,
  EventReceivedPayload,
  EventProcessedPayload,
  DaemonStartingPayload,
  DaemonStartedPayload,
  IpcStartedPayload,
  ConfigWatcherStartedPayload,
  SessionEvictionStartedPayload,
  SessionSummarySkippedPayload,
  ResumeMessageSkippedPayload,
  StatuslineErrorPayload,
  TranscriptEmittedPayload,
  TranscriptPreCompactPayload,
  ErrorOccurredPayload,
  PayloadFor,
} from '../events.js'
import { UI_EVENT_TYPES, UI_EVENT_VISIBILITY } from '../events.js'

// All 31 canonical event type names
const EXPECTED_EVENT_TYPES = [
  'reminder:staged',
  'reminder:unstaged',
  'reminder:consumed',
  'reminder:cleared',
  'decision:recorded',
  'session-summary:start',
  'session-summary:finish',
  'session-title:changed',
  'intent:changed',
  'snarky-message:start',
  'snarky-message:finish',
  'resume-message:start',
  'resume-message:finish',
  'persona:selected',
  'persona:changed',
  'statusline:rendered',
  'hook:received',
  'hook:completed',
  'event:received',
  'event:processed',
  'daemon:starting',
  'daemon:started',
  'ipc:started',
  'config:watcher-started',
  'session:eviction-started',
  'session-summary:skipped',
  'resume-message:skipped',
  'statusline:error',
  'transcript:emitted',
  'transcript:pre-compact',
  'error:occurred',
] as const

describe('UIEventType', () => {
  it('contains exactly 31 event types', () => {
    expect(UI_EVENT_TYPES).toHaveLength(31)
  })

  it('contains all expected event type names', () => {
    for (const eventType of EXPECTED_EVENT_TYPES) {
      expect(UI_EVENT_TYPES).toContain(eventType)
    }
  })

  it('has no unexpected event types', () => {
    for (const eventType of UI_EVENT_TYPES) {
      expect(EXPECTED_EVENT_TYPES).toContain(eventType)
    }
  })

  it('UIEventType union matches the const array', () => {
    // Type-level check: every element of UI_EVENT_TYPES is assignable to UIEventType
    const first: UIEventType = UI_EVENT_TYPES[0]
    expectTypeOf(first).toExtend<UIEventType>()
  })
})

describe('EventVisibility', () => {
  it('accepts valid visibility values', () => {
    const timeline: EventVisibility = 'timeline'
    const log: EventVisibility = 'log'
    const both: EventVisibility = 'both'
    expect(timeline).toBe('timeline')
    expect(log).toBe('log')
    expect(both).toBe('both')
  })
})

describe('UI_EVENT_VISIBILITY', () => {
  it('maps every UIEventType to a valid EventVisibility', () => {
    const validVisibilities: EventVisibility[] = ['timeline', 'log', 'both']

    for (const eventType of UI_EVENT_TYPES) {
      const visibility = UI_EVENT_VISIBILITY[eventType]
      expect(validVisibilities).toContain(visibility)
    }
  })

  it('has an entry for every UIEventType', () => {
    for (const eventType of UI_EVENT_TYPES) {
      expect(UI_EVENT_VISIBILITY).toHaveProperty(eventType)
    }
  })

  it('has correct visibility for timeline events', () => {
    expect(UI_EVENT_VISIBILITY['reminder:staged']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['reminder:unstaged']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['reminder:consumed']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['reminder:cleared']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['decision:recorded']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['session-summary:start']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['session-summary:finish']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['session-title:changed']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['intent:changed']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['snarky-message:start']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['snarky-message:finish']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['resume-message:start']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['resume-message:finish']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['persona:selected']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['persona:changed']).toBe('timeline')
    expect(UI_EVENT_VISIBILITY['statusline:rendered']).toBe('timeline')
  })

  it('has correct visibility for log-only events', () => {
    expect(UI_EVENT_VISIBILITY['event:received']).toBe('log')
    expect(UI_EVENT_VISIBILITY['event:processed']).toBe('log')
    expect(UI_EVENT_VISIBILITY['daemon:starting']).toBe('log')
    expect(UI_EVENT_VISIBILITY['daemon:started']).toBe('log')
    expect(UI_EVENT_VISIBILITY['ipc:started']).toBe('log')
    expect(UI_EVENT_VISIBILITY['config:watcher-started']).toBe('log')
    expect(UI_EVENT_VISIBILITY['session:eviction-started']).toBe('log')
    expect(UI_EVENT_VISIBILITY['session-summary:skipped']).toBe('log')
    expect(UI_EVENT_VISIBILITY['resume-message:skipped']).toBe('log')
    expect(UI_EVENT_VISIBILITY['transcript:emitted']).toBe('log')
    expect(UI_EVENT_VISIBILITY['transcript:pre-compact']).toBe('log')
  })

  it('has correct visibility for both-visibility events', () => {
    expect(UI_EVENT_VISIBILITY['hook:received']).toBe('both')
    expect(UI_EVENT_VISIBILITY['hook:completed']).toBe('both')
    expect(UI_EVENT_VISIBILITY['statusline:error']).toBe('both')
    expect(UI_EVENT_VISIBILITY['error:occurred']).toBe('both')
  })
})

describe('Per-event payload interfaces', () => {
  it('ReminderStagedPayload has correct fields', () => {
    expectTypeOf<ReminderStagedPayload>().toHaveProperty('reminderName')
    expectTypeOf<ReminderStagedPayload>().toHaveProperty('hookName')
    expectTypeOf<ReminderStagedPayload>().toHaveProperty('blocking')
    expectTypeOf<ReminderStagedPayload>().toHaveProperty('priority')
    expectTypeOf<ReminderStagedPayload>().toHaveProperty('persistent')
  })

  it('ReminderUnstagedPayload has correct fields', () => {
    expectTypeOf<ReminderUnstagedPayload>().toHaveProperty('reminderName')
    expectTypeOf<ReminderUnstagedPayload>().toHaveProperty('hookName')
    expectTypeOf<ReminderUnstagedPayload>().toHaveProperty('reason')
  })

  it('ReminderConsumedPayload has correct required fields', () => {
    expectTypeOf<ReminderConsumedPayload>().toHaveProperty('reminderName')
    expectTypeOf<ReminderConsumedPayload>().toHaveProperty('reminderReturned')
  })

  it('ReminderClearedPayload has correct fields', () => {
    expectTypeOf<ReminderClearedPayload>().toHaveProperty('clearedCount')
    expectTypeOf<ReminderClearedPayload>().toHaveProperty('reason')
  })

  it('DecisionRecordedPayload has correct fields', () => {
    expectTypeOf<DecisionRecordedPayload>().toHaveProperty('decision')
    expectTypeOf<DecisionRecordedPayload>().toHaveProperty('reason')
    expectTypeOf<DecisionRecordedPayload>().toHaveProperty('detail')
  })

  it('SessionSummaryStartPayload has correct fields', () => {
    expectTypeOf<SessionSummaryStartPayload>().toHaveProperty('reason')
    expectTypeOf<SessionSummaryStartPayload>().toHaveProperty('countdown')
  })

  it('SessionSummaryFinishPayload has correct fields', () => {
    expectTypeOf<SessionSummaryFinishPayload>().toHaveProperty('session_title')
    expectTypeOf<SessionSummaryFinishPayload>().toHaveProperty('session_title_confidence')
    expectTypeOf<SessionSummaryFinishPayload>().toHaveProperty('latest_intent')
    expectTypeOf<SessionSummaryFinishPayload>().toHaveProperty('latest_intent_confidence')
    expectTypeOf<SessionSummaryFinishPayload>().toHaveProperty('processing_time_ms')
    expectTypeOf<SessionSummaryFinishPayload>().toHaveProperty('pivot_detected')
  })

  it('SessionTitleChangedPayload has correct fields', () => {
    expectTypeOf<SessionTitleChangedPayload>().toHaveProperty('previousValue')
    expectTypeOf<SessionTitleChangedPayload>().toHaveProperty('newValue')
    expectTypeOf<SessionTitleChangedPayload>().toHaveProperty('confidence')
  })

  it('IntentChangedPayload has correct fields', () => {
    expectTypeOf<IntentChangedPayload>().toHaveProperty('previousValue')
    expectTypeOf<IntentChangedPayload>().toHaveProperty('newValue')
    expectTypeOf<IntentChangedPayload>().toHaveProperty('confidence')
  })

  it('SnarkyMessageStartPayload has correct fields', () => {
    expectTypeOf<SnarkyMessageStartPayload>().toHaveProperty('sessionId')
  })

  it('SnarkyMessageFinishPayload has correct fields', () => {
    expectTypeOf<SnarkyMessageFinishPayload>().toHaveProperty('generatedMessage')
  })

  it('ResumeMessageStartPayload has correct fields', () => {
    expectTypeOf<ResumeMessageStartPayload>().toHaveProperty('title_confidence')
    expectTypeOf<ResumeMessageStartPayload>().toHaveProperty('intent_confidence')
  })

  it('ResumeMessageFinishPayload has correct fields', () => {
    expectTypeOf<ResumeMessageFinishPayload>().toHaveProperty('snarky_comment')
    expectTypeOf<ResumeMessageFinishPayload>().toHaveProperty('timestamp')
  })

  it('PersonaSelectedPayload has correct fields', () => {
    expectTypeOf<PersonaSelectedPayload>().toHaveProperty('personaId')
    expectTypeOf<PersonaSelectedPayload>().toHaveProperty('selectionMethod')
    expectTypeOf<PersonaSelectedPayload>().toHaveProperty('poolSize')
  })

  it('PersonaChangedPayload has correct fields', () => {
    expectTypeOf<PersonaChangedPayload>().toHaveProperty('personaFrom')
    expectTypeOf<PersonaChangedPayload>().toHaveProperty('personaTo')
    expectTypeOf<PersonaChangedPayload>().toHaveProperty('reason')
  })

  it('StatuslineRenderedPayload has correct fields', () => {
    expectTypeOf<StatuslineRenderedPayload>().toHaveProperty('displayMode')
    expectTypeOf<StatuslineRenderedPayload>().toHaveProperty('staleData')
    expectTypeOf<StatuslineRenderedPayload>().toHaveProperty('durationMs')
  })

  it('HookReceivedPayload has correct fields', () => {
    expectTypeOf<HookReceivedPayload>().toHaveProperty('hook')
  })

  it('HookCompletedPayload has correct fields', () => {
    expectTypeOf<HookCompletedPayload>().toHaveProperty('hook')
    expectTypeOf<HookCompletedPayload>().toHaveProperty('durationMs')
  })

  it('EventReceivedPayload has correct fields', () => {
    expectTypeOf<EventReceivedPayload>().toHaveProperty('eventKind')
    expectTypeOf<EventReceivedPayload>().toHaveProperty('eventType')
    expectTypeOf<EventReceivedPayload>().toHaveProperty('hook')
  })

  it('EventProcessedPayload has correct fields', () => {
    expectTypeOf<EventProcessedPayload>().toHaveProperty('handlerId')
    expectTypeOf<EventProcessedPayload>().toHaveProperty('success')
    expectTypeOf<EventProcessedPayload>().toHaveProperty('durationMs')
    expectTypeOf<EventProcessedPayload>().toHaveProperty('error')
  })

  it('DaemonStartingPayload has correct fields', () => {
    expectTypeOf<DaemonStartingPayload>().toHaveProperty('projectDir')
    expectTypeOf<DaemonStartingPayload>().toHaveProperty('pid')
  })

  it('DaemonStartedPayload has correct fields', () => {
    expectTypeOf<DaemonStartedPayload>().toHaveProperty('startupDurationMs')
  })

  it('IpcStartedPayload has correct fields', () => {
    expectTypeOf<IpcStartedPayload>().toHaveProperty('socketPath')
  })

  it('ConfigWatcherStartedPayload has correct fields', () => {
    expectTypeOf<ConfigWatcherStartedPayload>().toHaveProperty('projectDir')
    expectTypeOf<ConfigWatcherStartedPayload>().toHaveProperty('watchedFiles')
  })

  it('SessionEvictionStartedPayload has correct fields', () => {
    expectTypeOf<SessionEvictionStartedPayload>().toHaveProperty('intervalMs')
  })

  it('SessionSummarySkippedPayload has correct fields', () => {
    expectTypeOf<SessionSummarySkippedPayload>().toHaveProperty('countdown')
    expectTypeOf<SessionSummarySkippedPayload>().toHaveProperty('countdown_threshold')
    expectTypeOf<SessionSummarySkippedPayload>().toHaveProperty('reason')
  })

  it('ResumeMessageSkippedPayload has correct fields', () => {
    expectTypeOf<ResumeMessageSkippedPayload>().toHaveProperty('title_confidence')
    expectTypeOf<ResumeMessageSkippedPayload>().toHaveProperty('intent_confidence')
    expectTypeOf<ResumeMessageSkippedPayload>().toHaveProperty('min_confidence')
    expectTypeOf<ResumeMessageSkippedPayload>().toHaveProperty('reason')
  })

  it('StatuslineErrorPayload has correct fields', () => {
    expectTypeOf<StatuslineErrorPayload>().toHaveProperty('reason')
    expectTypeOf<StatuslineErrorPayload>().toHaveProperty('fallbackUsed')
  })

  it('TranscriptEmittedPayload has correct fields', () => {
    expectTypeOf<TranscriptEmittedPayload>().toHaveProperty('eventType')
    expectTypeOf<TranscriptEmittedPayload>().toHaveProperty('lineNumber')
  })

  it('TranscriptPreCompactPayload has correct fields', () => {
    expectTypeOf<TranscriptPreCompactPayload>().toHaveProperty('snapshotPath')
    expectTypeOf<TranscriptPreCompactPayload>().toHaveProperty('lineCount')
  })

  it('ErrorOccurredPayload has correct fields', () => {
    expectTypeOf<ErrorOccurredPayload>().toHaveProperty('errorMessage')
    expectTypeOf<ErrorOccurredPayload>().toHaveProperty('source')
  })
})

describe('CanonicalEvent', () => {
  it('narrows payload type by discriminator', () => {
    // Type-level test: when type is narrowed, payload should be the matching type
    type ReminderStagedEvent = CanonicalEvent<'reminder:staged'>
    expectTypeOf<ReminderStagedEvent['payload']>().toEqualTypeOf<ReminderStagedPayload>()
    expectTypeOf<ReminderStagedEvent['type']>().toEqualTypeOf<'reminder:staged'>()
  })

  it('narrows visibility type by discriminator', () => {
    // Visibility is derived from UI_EVENT_VISIBILITY, not free-form
    type DaemonStartedEvent = CanonicalEvent<'daemon:started'>
    expectTypeOf<DaemonStartedEvent['visibility']>().toEqualTypeOf<'log'>()

    type ReminderStagedEvent = CanonicalEvent<'reminder:staged'>
    expectTypeOf<ReminderStagedEvent['visibility']>().toEqualTypeOf<'timeline'>()

    type HookReceivedEvent = CanonicalEvent<'hook:received'>
    expectTypeOf<HookReceivedEvent['visibility']>().toEqualTypeOf<'both'>()
  })

  it('has required fields', () => {
    expectTypeOf<CanonicalEvent>().toHaveProperty('type')
    expectTypeOf<CanonicalEvent>().toHaveProperty('visibility')
    expectTypeOf<CanonicalEvent>().toHaveProperty('source')
    expectTypeOf<CanonicalEvent>().toHaveProperty('time')
    expectTypeOf<CanonicalEvent>().toHaveProperty('context')
    expectTypeOf<CanonicalEvent>().toHaveProperty('payload')
  })

  it('PayloadFor maps types correctly', () => {
    expectTypeOf<PayloadFor<'reminder:staged'>>().toEqualTypeOf<ReminderStagedPayload>()
    expectTypeOf<PayloadFor<'error:occurred'>>().toEqualTypeOf<ErrorOccurredPayload>()
    expectTypeOf<PayloadFor<'daemon:started'>>().toEqualTypeOf<DaemonStartedPayload>()
  })
})
