/**
 * Tests for transcript-parser.ts
 */

import { describe, it, expect } from 'vitest'
import {
  parseTokenCount,
  parseContextTable,
  isContextCommandOutput,
  extractContextOutput,
} from '../transcript-parser.js'

describe('parseTokenCount', () => {
  it('parses plain numbers', () => {
    expect(parseTokenCount('17900')).toBe(17900)
    expect(parseTokenCount('0')).toBe(0)
    expect(parseTokenCount('123456')).toBe(123456)
  })

  it('parses numbers with commas', () => {
    expect(parseTokenCount('17,900')).toBe(17900)
    expect(parseTokenCount('1,234,567')).toBe(1234567)
  })

  it('parses k suffix', () => {
    expect(parseTokenCount('17.9k')).toBe(17900)
    expect(parseTokenCount('3.2k')).toBe(3200)
    expect(parseTokenCount('45k')).toBe(45000)
    expect(parseTokenCount('1.5K')).toBe(1500)
  })

  it('parses M suffix', () => {
    expect(parseTokenCount('1.2M')).toBe(1200000)
    expect(parseTokenCount('0.5m')).toBe(500000)
  })

  it('handles edge cases', () => {
    expect(parseTokenCount('')).toBe(0)
    expect(parseTokenCount('-')).toBe(0)
    expect(parseTokenCount('N/A')).toBe(0)
    expect(parseTokenCount('invalid')).toBe(0)
  })

  it('trims whitespace', () => {
    expect(parseTokenCount('  17.9k  ')).toBe(17900)
    expect(parseTokenCount('\t3200\n')).toBe(3200)
  })
})

describe('isContextCommandOutput', () => {
  it('returns true for valid /context output', () => {
    const content = `<local-command-stdout>## Context Usage

**Model:** claude-opus-4-5-20251101
**Tokens:** 63.0k / 200.0k (32%)

### Categories

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 2.9k | 1.4% |
| System tools | 15.1k | 7.6% |
</local-command-stdout>`

    expect(isContextCommandOutput(content)).toBe(true)
  })

  it('returns false without local-command-stdout tags', () => {
    const content = `## Context Usage
**Tokens:** 63.0k / 200.0k (32%)
| System prompt | 2.9k | 1.4% |
| System tools | 15.1k | 7.6% |`

    expect(isContextCommandOutput(content)).toBe(false)
  })

  it('returns false without context markers', () => {
    const content = `<local-command-stdout>
Just some random output
</local-command-stdout>`

    expect(isContextCommandOutput(content)).toBe(false)
  })

  it('handles non-string input', () => {
    expect(isContextCommandOutput(null as unknown as string)).toBe(false)
    expect(isContextCommandOutput(undefined as unknown as string)).toBe(false)
    expect(isContextCommandOutput(123 as unknown as string)).toBe(false)
  })
})

describe('parseContextTable', () => {
  const validOutput = `<local-command-stdout>## Context Usage

**Model:** claude-opus-4-5-20251101
**Tokens:** 63.0k / 200.0k (32%)

### Categories

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 2.9k | 1.4% |
| System tools | 15.1k | 7.6% |
| MCP tools | 1.2k | 0.6% |
| Custom agents | 500 | 0.2% |
| Memory files | 800 | 0.4% |
| Messages | 40.5k | 20.2% |
| Autocompact buffer | 45k | 22.5% |
</local-command-stdout>`

  it('parses all categories from valid output', () => {
    const result = parseContextTable(validOutput)

    expect(result).not.toBeNull()
    expect(result!.systemPrompt).toBe(2900)
    expect(result!.systemTools).toBe(15100)
    expect(result!.mcpTools).toBe(1200)
    expect(result!.customAgents).toBe(500)
    expect(result!.memoryFiles).toBe(800)
    expect(result!.messages).toBe(40500)
    expect(result!.autocompactBuffer).toBe(45000)
  })

  it('parses total tokens and context window size', () => {
    const result = parseContextTable(validOutput)

    expect(result).not.toBeNull()
    expect(result!.totalTokens).toBe(63000)
    expect(result!.contextWindowSize).toBe(200000)
  })

  it('returns null for invalid content', () => {
    expect(parseContextTable('invalid content')).toBeNull()
    expect(parseContextTable('<local-command-stdout>no table</local-command-stdout>')).toBeNull()
  })

  it('returns null without local-command-stdout tags', () => {
    const withoutTags = validOutput.replace(/<\/?local-command-stdout>/g, '')
    expect(parseContextTable(withoutTags)).toBeNull()
  })

  it('handles missing optional categories', () => {
    const minimalOutput = `<local-command-stdout>## Context Usage

**Model:** claude-opus-4-5-20251101
**Tokens:** 20k / 200k (10%)

### Categories

| Category | Tokens | Percentage |
|----------|--------|------------|
| System prompt | 3k | 1.5% |
| System tools | 17k | 8.5% |
| Messages | 0 | 0% |
</local-command-stdout>`

    const result = parseContextTable(minimalOutput)

    expect(result).not.toBeNull()
    expect(result!.systemPrompt).toBe(3000)
    expect(result!.systemTools).toBe(17000)
    expect(result!.mcpTools).toBe(0)
    expect(result!.customAgents).toBe(0)
    expect(result!.memoryFiles).toBe(0)
    expect(result!.autocompactBuffer).toBe(0)
  })
})

describe('parseContextTable with real ANSI output', () => {
  // Real /context output from transcript with ANSI escape codes
  // Format: `⛁ System prompt: 3.2k tokens (1.6%)`
  const realAnsiOutput = `<local-command-stdout>\u001b[?2026h\u001b[?2026l\u001b[?2026h\u001b[?2026l\u001b[?2026h
 \u001b[1mContext Usage\u001b[22m
\u001b[38;2;153;153;153m⛁ ⛀ \u001b[38;2;102;102;102m⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ \u001b[39m  \u001b[38;2;102;102;102mclaude-opus-4-5-20251101 · 166k/200k tokens (83%)\u001b[39m
\u001b[38;2;102;102;102m⛁ \u001b[38;2;8;145;178m⛁ ⛀ \u001b[38;2;87;105;247m⛀ \u001b[38;2;215;119;87m⛁ \u001b[38;2;147;51;234m⛁ ⛁ ⛁ ⛁ ⛁ \u001b[39m
\u001b[38;2;147;51;234m⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ \u001b[39m  \u001b[38;2;153;153;153m⛁\u001b[39m System prompt: \u001b[38;2;102;102;102m3.2k tokens (1.6%)\u001b[39m
\u001b[38;2;147;51;234m⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ \u001b[39m  \u001b[38;2;102;102;102m⛁\u001b[39m System tools: \u001b[38;2;102;102;102m17.9k tokens (9.0%)\u001b[39m
\u001b[38;2;147;51;234m⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ \u001b[39m  \u001b[38;2;8;145;178m⛁\u001b[39m MCP tools: \u001b[38;2;102;102;102m3.2k tokens (1.6%)\u001b[39m
\u001b[38;2;147;51;234m⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ ⛁ \u001b[39m  \u001b[38;2;87;105;247m⛁\u001b[39m Custom agents: \u001b[38;2;102;102;102m15 tokens (0.0%)\u001b[39m
\u001b[38;2;147;51;234m⛁ ⛁ \u001b[38;2;102;102;102m⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ \u001b[39m  \u001b[38;2;215;119;87m⛁\u001b[39m Memory files: \u001b[38;2;102;102;102m2.1k tokens (1.1%)\u001b[39m
\u001b[38;2;102;102;102m⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛶ ⛝ ⛝ ⛝ \u001b[39m  \u001b[38;2;147;51;234m⛁\u001b[39m Messages: \u001b[38;2;102;102;102m94.3k tokens (47.1%)\u001b[39m
\u001b[38;2;102;102;102m⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ \u001b[39m  \u001b[38;2;102;102;102m⛶\u001b[39m Free space: \u001b[38;2;102;102;102m34k (17.2%)\u001b[39m
\u001b[38;2;102;102;102m⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ ⛝ \u001b[39m  \u001b[38;2;102;102;102m⛝ Autocompact buffer: 45.0k tokens (22.5%)\u001b[39m

\u001b[1mMCP tools\u001b[22m\u001b[38;2;102;102;102m · /mcp\u001b[39m
└ mcp__plugin_context7_context7__resolve-library-id: \u001b[38;2;102;102;102m1.0k tokens\u001b[39m
└ mcp__plugin_context7_context7__query-docs: \u001b[38;2;102;102;102m913 tokens\u001b[39m
└ mcp__ide__getDiagnostics: \u001b[38;2;102;102;102m611 tokens\u001b[39m
└ mcp__ide__executeCode: \u001b[38;2;102;102;102m682 tokens\u001b[39m

\u001b[1mCustom agents\u001b[22m\u001b[38;2;102;102;102m · /agents\u001b[39m

\u001b[38;2;102;102;102mPlugin\u001b[39m
└ superpowers:code-reviewer: \u001b[38;2;102;102;102m15 tokens\u001b[39m

\u001b[1mMemory files\u001b[22m\u001b[38;2;102;102;102m · /memory\u001b[39m
└ CLAUDE.md: \u001b[38;2;102;102;102m28 tokens\u001b[39m
└ AGENTS.md: \u001b[38;2;102;102;102m2.1k tokens\u001b[39m
\u001b[?2026l</local-command-stdout>`

  it('detects real ANSI /context output', () => {
    expect(isContextCommandOutput(realAnsiOutput)).toBe(true)
  })

  it('parses real ANSI /context output with visual format', () => {
    const result = parseContextTable(realAnsiOutput)

    expect(result).not.toBeNull()
    expect(result!.systemPrompt).toBe(3200)
    expect(result!.systemTools).toBe(17900)
    expect(result!.mcpTools).toBe(3200)
    expect(result!.customAgents).toBe(15)
    expect(result!.memoryFiles).toBe(2100)
    expect(result!.messages).toBe(94300)
    expect(result!.autocompactBuffer).toBe(45000)
  })

  it('parses total tokens from real ANSI output header', () => {
    const result = parseContextTable(realAnsiOutput)

    expect(result).not.toBeNull()
    expect(result!.totalTokens).toBe(166000)
    expect(result!.contextWindowSize).toBe(200000)
  })
})

describe('extractContextOutput', () => {
  const validContent = `<local-command-stdout>## Context Usage
**Tokens:** 63.0k / 200.0k (32%)
| System prompt | 2.9k | 1.4% |
| System tools | 15.1k | 7.6% |
</local-command-stdout>`

  it('extracts content from string', () => {
    expect(extractContextOutput(validContent)).toBe(validContent)
  })

  it('returns null for non-context content', () => {
    expect(extractContextOutput('just a regular message')).toBeNull()
    expect(extractContextOutput('')).toBeNull()
  })

  it('extracts content from object with content field', () => {
    const obj = { content: validContent }
    expect(extractContextOutput(obj)).toBe(validContent)
  })

  it('extracts content from object with nested message.content', () => {
    const obj = { message: { content: validContent } }
    expect(extractContextOutput(obj)).toBe(validContent)
  })

  it('returns null for non-context object content', () => {
    expect(extractContextOutput({ content: 'regular message' })).toBeNull()
    expect(extractContextOutput({ message: { content: 'regular message' } })).toBeNull()
  })

  it('handles null and undefined', () => {
    expect(extractContextOutput(null)).toBeNull()
    expect(extractContextOutput(undefined)).toBeNull()
  })
})
