export interface Session {
  id: string
  title: string
  date: string
  branch: string
}

export interface Event {
  id: number
  time: string
  type: 'session' | 'user' | 'assistant' | 'decision' | 'state' | 'tool' | 'reminder'
  label: string
  content?: string
  branch?: string
}

export interface StateSnapshot {
  session_id: string
  session_title: string
  session_title_confidence: number
  latest_intent: string
  latest_intent_confidence: number
  tokens: {
    input: number
    output: number
  }
  cost_usd: number
  duration_sec: number
}

export const currentSession: Session = {
  id: 'a1b2c3d4',
  title: 'Auth Bug Investigation',
  date: 'Nov 26, 2025 • 10:00 AM',
  branch: 'main',
}

export const otherSessions: Session[] = [
  { id: 'e5f6g7h8', title: 'API Rate Limiting', date: 'Nov 25, 2025 • 3:42 PM', branch: 'feature/rate-limit' },
  { id: 'i9j0k1l2', title: 'Database Migration', date: 'Nov 25, 2025 • 11:15 AM', branch: 'main' },
  { id: 'm3n4o5p6', title: 'Frontend Refactor', date: 'Nov 24, 2025 • 2:30 PM', branch: 'refactor/ui' },
]

export const events: Event[] = [
  { id: 0, time: '10:00:00', type: 'session', label: 'Session Start', branch: 'main' },
  {
    id: 1,
    time: '10:00:15',
    type: 'user',
    label: 'User message',
    content: 'Fix the auth bug in auth.ts - users are getting logged out randomly after about an hour of activity.',
  },
  {
    id: 2,
    time: '10:00:18',
    type: 'decision',
    label: 'Prune Context',
    content: 'Token limit approaching (156k/180k). Pruned 36k tokens from early context.',
  },
  {
    id: 3,
    time: '10:00:45',
    type: 'assistant',
    label: 'Claude response',
    content:
      "I'll investigate the auth.ts file to identify the cause of random logouts. This sounds like it could be related to token expiration handling. Let me start by reading the current implementation.",
  },
  { id: 4, time: '10:01:02', type: 'tool', label: 'Read auth.ts', content: 'Read 342 lines from src/auth/auth.ts' },
  {
    id: 5,
    time: '10:01:05',
    type: 'state',
    label: 'Summary Updated',
    content: 'session_title_confidence: 0.85 → 0.92, latest_intent updated',
  },
  {
    id: 6,
    time: '10:01:30',
    type: 'assistant',
    label: 'Claude response',
    content:
      "I found the issue. The token expiration check on line 47 uses a strict less-than comparison (`<`) instead of less-than-or-equal (`<=`). This causes tokens to be considered expired one second early during edge cases.\n\nHere's the fix:",
    branch: 'fix/auth-expiry',
  },
  { id: 7, time: '10:01:45', type: 'tool', label: 'Edit auth.ts:47', content: 'Modified line 47: < → <=' },
  {
    id: 8,
    time: '10:01:48',
    type: 'reminder',
    label: 'Pre-completion',
    content: 'File modifications detected. Verify changes before stopping.',
  },
  {
    id: 9,
    time: '10:02:00',
    type: 'assistant',
    label: 'Claude response',
    content:
      "I've fixed the token expiration bug. The change ensures tokens remain valid through their full expiration time. Would you like me to add a test case for this edge condition?",
  },
]

export const stateData = {
  current: {
    session_id: 'a1b2c3d4',
    session_title: 'Auth Bug Investigation',
    session_title_confidence: 0.92,
    latest_intent: 'Fix token expiration timing issue',
    latest_intent_confidence: 0.88,
    tokens: {
      input: 12450,
      output: 3200,
    },
    cost_usd: 0.47,
    duration_sec: 120,
  } as StateSnapshot,
  previous: {
    session_id: 'a1b2c3d4',
    session_title: 'Auth Bug Investigation',
    session_title_confidence: 0.85,
    latest_intent: 'Review auth code',
    latest_intent_confidence: 0.72,
    tokens: {
      input: 8200,
      output: 1800,
    },
    cost_usd: 0.31,
    duration_sec: 65,
  } as StateSnapshot,
}
