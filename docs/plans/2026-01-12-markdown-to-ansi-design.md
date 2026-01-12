# Markdown to ANSI Conversion for Statusline

**Date**: 2026-01-12
**Status**: Approved
**Scope**: `packages/feature-statusline`

## Overview

Add configurable markdown-to-ANSI conversion for statusline title and summary fields. This converts markdown formatting (`**bold**`, `*italic*`, `` `code` ``) into ANSI escape sequences for terminal display.

## Configuration Schema

Add `supportedMarkdown` under `theme` in `StatuslineConfigSchema`:

```typescript
theme: z.object({
  useNerdFonts: z.boolean().default(true),
  supportedMarkdown: z.object({
    bold: z.boolean().default(true),      // **text** → \x1b[1m
    italic: z.boolean().default(true),    // *text* or _text_ → \x1b[3m
    code: z.boolean().default(true),      // `text` → \x1b[2m (dim)
  }).default({ bold: true, italic: true, code: true }),
  colors: z.object({ ... })
})
```

Each flag defaults to `true`. Users can disable individual features for terminal compatibility:

```yaml
theme:
  supportedMarkdown:
    italic: false  # disable if terminal doesn't support
```

## Design Decisions

### Separation of Concerns

- **`useColors`**: Only controls color codes (blue, green, cyan, etc.)
- **`supportedMarkdown`**: Controls ANSI formatting codes (bold, italic, dim)

These are independent:

| useColors | supportedMarkdown.bold | Result for `**text**` |
|-----------|------------------------|----------------------|
| true | true | Colored + bold |
| false | true | Bold only (no color) |
| true | false | Colored, raw `**text**` |
| false | false | Raw `**text**` |

### Fields Converted

Both `title` and `summary` fields have markdown conversion applied. These are the most likely to contain LLM-generated content with markdown formatting (snarky comments, session titles).

### Pipeline Location

Conversion happens in `Formatter.format()` before colorizing:

```
viewModel.summary → convertMarkdown() → colorize() → output
```

This keeps raw values in viewModel (for JSON output) while applying formatting for terminal display.

## Implementation

### 1. ANSI Constants (formatter.ts)

Add to existing ANSI object:

```typescript
const ANSI = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',     // NEW
  italic: '\x1b[3m',   // NEW
  // ... existing colors unchanged
} as const
```

### 2. convertMarkdown Method (formatter.ts)

```typescript
private convertMarkdown(text: string): string {
  if (!text) return text

  let result = text
  const md = this.theme.supportedMarkdown

  // Bold: **text** → ANSI bold (process first to avoid conflict with italic)
  if (md.bold) {
    result = result.replace(/\*\*(.+?)\*\*/g, `${ANSI.bold}$1${ANSI.reset}`)
  }

  // Italic: *text* or _text_ → ANSI italic
  if (md.italic) {
    result = result.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, `${ANSI.italic}$1${ANSI.reset}`)
    result = result.replace(/(?<!_)_([^_]+)_(?!_)/g, `${ANSI.italic}$1${ANSI.reset}`)
  }

  // Code: `text` → ANSI dim
  if (md.code) {
    result = result.replace(/`([^`]+)`/g, `${ANSI.dim}$1${ANSI.reset}`)
  }

  return result
}
```

### 3. Integration in format() (formatter.ts)

```typescript
format(template: string, viewModel: StatuslineViewModel): string {
  // ... existing setup code ...

  // Convert markdown for title/summary before colorizing
  const convertedSummary = this.convertMarkdown(viewModel.summary)
  const convertedTitle = this.convertMarkdown(viewModel.title)

  const tokens: Record<string, string> = {
    // ... other tokens unchanged ...
    summary: this.colorize(convertedSummary, this.theme.colors.summary),
    title: this.colorize(convertedTitle, this.theme.colors.title),
    // ... rest unchanged ...
  }
  // ... rest of method unchanged ...
}
```

## Files to Modify

1. **`packages/feature-statusline/src/types.ts`**
   - Add `supportedMarkdown` schema under `theme`
   - Update `DEFAULT_STATUSLINE_CONFIG` (auto via Zod defaults)

2. **`packages/feature-statusline/src/formatter.ts`**
   - Add `bold` and `italic` to ANSI constants
   - Add `convertMarkdown()` private method
   - Update `format()` to convert title/summary

3. **`packages/feature-statusline/src/formatter.test.ts`**
   - Test bold conversion (`**text**`)
   - Test italic conversion (`*text*` and `_text_`)
   - Test code/dim conversion (`` `text` ``)
   - Test mixed markdown
   - Test disabled flags (each individually)
   - Test empty/null text handling
   - Test interaction with useColors

## Test Cases

```typescript
describe('convertMarkdown', () => {
  it('converts **bold** to ANSI bold')
  it('converts *italic* to ANSI italic')
  it('converts _italic_ to ANSI italic')
  it('converts `code` to ANSI dim')
  it('handles mixed markdown: **bold** and *italic*')
  it('leaves text unchanged when all flags disabled')
  it('respects individual flag settings')
  it('handles empty string')
  it('handles text without markdown')
  it('does not convert escaped or nested patterns incorrectly')
})
```

## Out of Scope

- Block-level markdown (headers, lists, code blocks)
- Links `[text](url)`
- Nested formatting (`***bold italic***`)
- Escape sequences (`\*not italic\*`)
