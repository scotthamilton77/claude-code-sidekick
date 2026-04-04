// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { Collapsible } from '../Collapsible'

describe('Collapsible', () => {
  afterEach(() => cleanup())

  describe('uncontrolled mode', () => {
    it('renders collapsed by default', () => {
      render(
        <Collapsible label="Section">
          <p>Content</p>
        </Collapsible>
      )
      expect(screen.getByText('Section')).toBeInTheDocument()
      expect(screen.queryByText('Content')).toBeNull()
    })

    it('renders expanded when defaultOpen is true', () => {
      render(
        <Collapsible label="Section" defaultOpen>
          <p>Content</p>
        </Collapsible>
      )
      expect(screen.getByText('Content')).toBeInTheDocument()
    })

    it('toggles open and closed on button click', () => {
      render(
        <Collapsible label="Section">
          <p>Content</p>
        </Collapsible>
      )
      expect(screen.queryByText('Content')).toBeNull()
      fireEvent.click(screen.getByRole('button'))
      expect(screen.getByText('Content')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button'))
      expect(screen.queryByText('Content')).toBeNull()
    })
  })

  describe('controlled mode', () => {
    it('renders content when open is true', () => {
      const onToggle = vi.fn()
      render(
        <Collapsible label="Section" open={true} onToggle={onToggle}>
          <p>Content</p>
        </Collapsible>
      )
      expect(screen.getByText('Content')).toBeInTheDocument()
    })

    it('hides content when open is false', () => {
      const onToggle = vi.fn()
      render(
        <Collapsible label="Section" open={false} onToggle={onToggle}>
          <p>Content</p>
        </Collapsible>
      )
      expect(screen.queryByText('Content')).toBeNull()
    })

    it('calls onToggle when button is clicked', () => {
      const onToggle = vi.fn()
      render(
        <Collapsible label="Section" open={false} onToggle={onToggle}>
          <p>Content</p>
        </Collapsible>
      )
      fireEvent.click(screen.getByRole('button'))
      expect(onToggle).toHaveBeenCalledOnce()
    })
  })

  describe('accessibility', () => {
    it('renders a button with type="button"', () => {
      render(
        <Collapsible label="Section">
          <p>Content</p>
        </Collapsible>
      )
      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('type', 'button')
    })

    it('sets aria-expanded=false when collapsed', () => {
      render(
        <Collapsible label="Section">
          <p>Content</p>
        </Collapsible>
      )
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'false')
    })

    it('sets aria-expanded=true when expanded', () => {
      render(
        <Collapsible label="Section" defaultOpen>
          <p>Content</p>
        </Collapsible>
      )
      expect(screen.getByRole('button')).toHaveAttribute('aria-expanded', 'true')
    })
  })

  describe('labelClassName', () => {
    it('appends additional class to the label span', () => {
      render(
        <Collapsible label="Section" labelClassName="font-mono">
          <p>Content</p>
        </Collapsible>
      )
      const label = screen.getByText('Section')
      expect(label.className).toContain('font-mono')
      // Base classes are still present
      expect(label.className).toContain('text-slate-500')
    })

    it('renders without extra class when labelClassName is omitted', () => {
      render(
        <Collapsible label="Section">
          <p>Content</p>
        </Collapsible>
      )
      const label = screen.getByText('Section')
      expect(label.className).not.toContain('font-mono')
    })
  })

  describe('label display', () => {
    it('shows the label text', () => {
      render(
        <Collapsible label="My Label">
          <p>Content</p>
        </Collapsible>
      )
      expect(screen.getByText('My Label')).toBeInTheDocument()
    })
  })
})
