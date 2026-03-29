// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { TranscriptLineCard } from '../TranscriptLine'
import type { TranscriptLine } from '../../../types'

function makeLine(overrides: Partial<TranscriptLine> = {}): TranscriptLine {
  return {
    id: 'line-1',
    timestamp: 1711700000000,
    type: 'user-message',
    ...overrides,
  }
}

const defaultProps = {
  isSelected: false,
  isSynced: false,
  onClick: vi.fn() as unknown as () => void,
}

describe('TranscriptLineCard', () => {
  describe('compaction rendering', () => {
    it('renders compaction divider with segment number', () => {
      const line = makeLine({ type: 'compaction', compactionSegment: 3 })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('Segment 3')).toBeInTheDocument()
    })

    it('renders compaction with token counts', () => {
      const line = makeLine({
        type: 'compaction',
        compactionSegment: 1,
        compactionTokensBefore: 128000,
        compactionTokensAfter: 32000,
      })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/128k/)).toBeInTheDocument()
      expect(screen.getByText(/32k/)).toBeInTheDocument()
    })

    it('shows "?" for missing segment number', () => {
      const line = makeLine({ type: 'compaction' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('Segment ?')).toBeInTheDocument()
    })
  })

  describe('user-message rendering', () => {
    it('renders user prompt with "User" label', () => {
      const line = makeLine({ type: 'user-message', userSubtype: 'prompt', content: 'Hello assistant' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('User')).toBeInTheDocument()
      expect(screen.getByText('Hello assistant')).toBeInTheDocument()
    })

    it('renders command with extracted command name', () => {
      const line = makeLine({
        type: 'user-message',
        userSubtype: 'command',
        content: '<command-name>/commit</command-name> some details',
      })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('/commit')).toBeInTheDocument()
    })

    it('renders skill-content as collapsible pill with skill name', () => {
      const line = makeLine({
        type: 'user-message',
        userSubtype: 'skill-content',
        content: 'Base directory for this skill: /Users/scott/.claude/skills/brainstorm',
      })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/Skill: brainstorm/)).toBeInTheDocument()
    })

    it('renders system-injection with "System reminder" label', () => {
      const line = makeLine({
        type: 'user-message',
        userSubtype: 'system-injection',
        content: '<system-reminder>reminder data</system-reminder>',
      })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('System reminder')).toBeInTheDocument()
    })
  })

  describe('assistant-message rendering', () => {
    it('renders assistant with "Assistant" label and content', () => {
      const line = makeLine({ type: 'assistant-message', content: 'I can help with that.' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('Assistant')).toBeInTheDocument()
      expect(screen.getByText('I can help with that.')).toBeInTheDocument()
    })

    it('renders thinking badge when thinking-only (no content)', () => {
      const line = makeLine({ type: 'assistant-message', thinking: 'reasoning...', content: undefined })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('thinking')).toBeInTheDocument()
    })

    it('renders collapsible thinking button when both content and thinking', () => {
      const line = makeLine({
        type: 'assistant-message',
        content: 'Response text',
        thinking: 'Internal reasoning...',
      })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('Response text')).toBeInTheDocument()
      // The thinking toggle button
      const thinkingButtons = screen.getAllByText('thinking')
      expect(thinkingButtons.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('tool-use rendering', () => {
    it('renders tool name and input preview for Bash', () => {
      const line = makeLine({
        type: 'tool-use',
        toolName: 'Bash',
        toolInput: { command: 'git status' },
      })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('Bash')).toBeInTheDocument()
      expect(screen.getByText(/git status/)).toBeInTheDocument()
    })

    it('renders tool duration when provided', () => {
      const line = makeLine({
        type: 'tool-use',
        toolName: 'Read',
        toolInput: { file_path: '/test.ts' },
        toolDurationMs: 42,
      })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('42ms')).toBeInTheDocument()
    })

    it('renders sidechain badge when isSidechain is true', () => {
      const line = makeLine({
        type: 'tool-use',
        toolName: 'Bash',
        toolInput: { command: 'echo test' },
        isSidechain: true,
      })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('sidechain')).toBeInTheDocument()
    })
  })

  describe('tool-result rendering', () => {
    it('renders "Result" label', () => {
      const line = makeLine({ type: 'tool-result', toolOutput: 'success' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText('Result')).toBeInTheDocument()
    })
  })

  describe('sidekick event rendering', () => {
    it('renders reminder:staged with reminder ID', () => {
      const line = makeLine({ type: 'reminder:staged', reminderId: 'vc-build' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/Staged vc-build/)).toBeInTheDocument()
    })

    it('renders decision:recorded with title', () => {
      const line = makeLine({ type: 'decision:recorded', decisionTitle: 'Use DI pattern' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/Decision: Use DI pattern/)).toBeInTheDocument()
    })

    it('renders error:occurred with error message', () => {
      const line = makeLine({ type: 'error:occurred', errorMessage: 'Something broke' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/Error: Something broke/)).toBeInTheDocument()
    })

    it('renders statusline:rendered with content detail', () => {
      const line = makeLine({ type: 'statusline:rendered', statuslineContent: 'Build: PASS' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/Statusline called/)).toBeInTheDocument()
      expect(screen.getByText(/Build: PASS/)).toBeInTheDocument()
    })

    it('renders hook:received with hook name', () => {
      const line = makeLine({ type: 'hook:received', hookName: 'SessionStart' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/Hook start: SessionStart/)).toBeInTheDocument()
    })

    it('renders hook:completed with duration', () => {
      const line = makeLine({ type: 'hook:completed', hookName: 'PostToolUse', hookDurationMs: 150 })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/Hook finish: PostToolUse/)).toBeInTheDocument()
      expect(screen.getByText(/150ms/)).toBeInTheDocument()
    })
  })

  describe('system types rendering', () => {
    it('renders turn-duration with formatted duration', () => {
      const line = makeLine({ type: 'turn-duration', durationMs: 2500 })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/Turn: 2\.5s/)).toBeInTheDocument()
    })

    it('renders api-error with retry info', () => {
      const line = makeLine({ type: 'api-error', retryAttempt: 2, maxRetries: 5, errorMessage: 'Rate limited' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/API Retry 2\/5/)).toBeInTheDocument()
    })

    it('renders pr-link with PR number and clickable URL', () => {
      const line = makeLine({ type: 'pr-link', prNumber: 42, prUrl: 'https://github.com/org/repo/pull/42' })
      render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/PR #42/)).toBeInTheDocument()
      const link = screen.getByText('https://github.com/org/repo/pull/42')
      expect(link).toHaveAttribute('href', 'https://github.com/org/repo/pull/42')
      expect(link).toHaveAttribute('target', '_blank')
    })

    it('does not render PR URL link for javascript: URLs', () => {
      const line = makeLine({ type: 'pr-link', prNumber: 1, prUrl: 'javascript:alert(1)' })
      const { container } = render(<TranscriptLineCard line={line} {...defaultProps} />)
      expect(screen.getByText(/PR #1/)).toBeInTheDocument()
      // No anchor element should be rendered for unsafe URLs — scope to this render's container
      expect(within(container).queryByRole('link')).toBeNull()
    })
  })

  describe('selection and sync styling', () => {
    it('fires onClick when clicked', () => {
      const onClick = vi.fn()
      const line = makeLine({ type: 'assistant-message', content: 'Click me' })
      render(<TranscriptLineCard line={line} isSelected={false} isSynced={false} onClick={onClick} />)
      fireEvent.click(screen.getByText('Click me'))
      expect(onClick).toHaveBeenCalledTimes(1)
    })
  })

  describe('pair navigation', () => {
    it('renders "-> result" link for tool-use with pair navigation', () => {
      const onNavigate = vi.fn()
      const line = makeLine({ type: 'tool-use', toolName: 'Bash', toolInput: { command: 'echo hi' } })
      render(
        <TranscriptLineCard
          line={line}
          isSelected={false}
          isSynced={false}
          onClick={vi.fn() as unknown as () => void}
          pairNavigation={{ color: '#ff0000', isToolUse: true, onNavigate }}
        />,
      )
      const navButton = screen.getByText(/result/)
      expect(navButton).toBeInTheDocument()
      fireEvent.click(navButton)
      expect(onNavigate).toHaveBeenCalled()
    })

    it('renders "<- call" link for tool-result with pair navigation', () => {
      const onNavigate = vi.fn()
      const line = makeLine({ type: 'tool-result', toolOutput: 'output' })
      render(
        <TranscriptLineCard
          line={line}
          isSelected={false}
          isSynced={false}
          onClick={vi.fn() as unknown as () => void}
          pairNavigation={{ color: '#ff0000', isToolUse: false, onNavigate }}
        />,
      )
      // The exact text is "← call"
      const navButton = screen.getByText(/← call/)
      expect(navButton).toBeInTheDocument()
    })
  })

  describe('model badge', () => {
    it('renders model badge when line model differs from default', () => {
      const line = makeLine({
        type: 'assistant-message',
        content: 'Hello',
        model: 'claude-3-5-sonnet-20250101',
      })
      render(<TranscriptLineCard line={line} {...defaultProps} defaultModel="claude-3-opus-20250101" />)
      expect(screen.getByText('3-5-sonnet')).toBeInTheDocument()
    })

    it('does not render model badge when matching default', () => {
      const line = makeLine({
        type: 'assistant-message',
        content: 'Hello',
        model: 'claude-3-opus-20250101',
      })
      render(<TranscriptLineCard line={line} {...defaultProps} defaultModel="claude-3-opus-20250101" />)
      expect(screen.queryByText('3-opus')).toBeNull()
    })
  })
})
