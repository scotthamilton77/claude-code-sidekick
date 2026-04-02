// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { CollapsibleContent } from '../CollapsibleContent'

describe('CollapsibleContent', () => {
  afterEach(() => cleanup())

  describe('basic rendering', () => {
    it('renders short content without expand button', () => {
      render(<CollapsibleContent content="short text" />)
      expect(screen.getByText('short text')).toBeInTheDocument()
      expect(screen.queryByText(/Show more/)).toBeNull()
    })

    it('renders long content with expand button', () => {
      const longContent = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n')
      render(<CollapsibleContent content={longContent} previewLines={3} />)
      expect(screen.getByText(/Show more/)).toBeInTheDocument()
    })

    it('expands and collapses on button click', () => {
      const longContent = Array.from({ length: 10 }, (_, i) => `Line ${i}`).join('\n')
      render(<CollapsibleContent content={longContent} previewLines={3} />)
      fireEvent.click(screen.getByText(/Show more/))
      expect(screen.getByText(/Show less/)).toBeInTheDocument()
      fireEvent.click(screen.getByText(/Show less/))
      expect(screen.getByText(/Show more/)).toBeInTheDocument()
    })
  })

  describe('JSON syntax highlighting', () => {
    it('renders JSON keys with cyan styling when highlight="json"', () => {
      const json = '{\n  "name": "test"\n}'
      render(<CollapsibleContent content={json} highlight="json" />)
      const keySpan = screen.getByText('"name"')
      expect(keySpan.tagName).toBe('SPAN')
      expect(keySpan.className).toContain('cyan')
    })

    it('renders JSON string values with green styling', () => {
      const json = '{\n  "name": "test"\n}'
      render(<CollapsibleContent content={json} highlight="json" />)
      const valueSpan = screen.getByText('"test"')
      expect(valueSpan.tagName).toBe('SPAN')
      expect(valueSpan.className).toContain('green')
    })

    it('renders JSON numbers with amber styling', () => {
      const json = '{\n  "count": 42\n}'
      render(<CollapsibleContent content={json} highlight="json" />)
      const numSpan = screen.getByText('42')
      expect(numSpan.tagName).toBe('SPAN')
      expect(numSpan.className).toContain('amber')
    })

    it('renders JSON booleans with purple styling', () => {
      const json = '{\n  "active": true\n}'
      render(<CollapsibleContent content={json} highlight="json" />)
      const boolSpan = screen.getByText('true')
      expect(boolSpan.tagName).toBe('SPAN')
      expect(boolSpan.className).toContain('purple')
    })

    it('renders JSON null with purple styling', () => {
      const json = '{\n  "value": null\n}'
      render(<CollapsibleContent content={json} highlight="json" />)
      const nullSpan = screen.getByText('null')
      expect(nullSpan.tagName).toBe('SPAN')
      expect(nullSpan.className).toContain('purple')
    })

    it('does not highlight when highlight prop is not set', () => {
      const json = '{\n  "name": "test"\n}'
      const { container } = render(<CollapsibleContent content={json} />)
      // No colored spans — content rendered as plain text
      const spans = container.querySelectorAll('span[class*="cyan"]')
      expect(spans.length).toBe(0)
    })
  })
})
