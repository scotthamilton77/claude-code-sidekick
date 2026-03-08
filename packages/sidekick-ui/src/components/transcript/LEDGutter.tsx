import { useState, useCallback, type MouseEvent } from 'react'
import type { LEDState } from '../../types'

interface LEDGutterProps {
  ledState: LEDState
}

const LED_CONFIG: { key: keyof LEDState; label: string; letter: string; litColor: string }[] = [
  { key: 'vcBuild', label: 'Build', letter: 'B', litColor: 'bg-blue-500' },
  { key: 'vcTypecheck', label: 'Typecheck', letter: 'T', litColor: 'bg-cyan-500' },
  { key: 'vcTest', label: 'Test', letter: 't', litColor: 'bg-emerald-500' },
  { key: 'vcLint', label: 'Lint', letter: 'L', litColor: 'bg-amber-500' },
  { key: 'verifyCompletion', label: 'Verify', letter: 'V', litColor: 'bg-red-500' },
  { key: 'pauseAndReflect', label: 'Pause', letter: 'P', litColor: 'bg-orange-500' },
]

const CONFIDENCE_COLORS: Record<string, string> = {
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  green: 'bg-emerald-500',
}

// Total LED count including confidence
const TOTAL_LEDS = LED_CONFIG.length + 1

// Dock magnification: compute scale for each LED based on mouse proximity
function getDockScale(mouseX: number, containerLeft: number, containerWidth: number, index: number): number {
  const ledSpacing = containerWidth / TOTAL_LEDS
  const ledCenter = containerLeft + ledSpacing * (index + 0.5)
  const distance = Math.abs(mouseX - ledCenter)
  const maxDistance = ledSpacing * 2.5
  if (distance > maxDistance) return 1
  const proximity = 1 - distance / maxDistance
  return 1 + proximity * 1.8 // peak scale ~2.8x
}

export function LEDGutter({ ledState }: LEDGutterProps) {
  const [mouseX, setMouseX] = useState<number | null>(null)
  const [containerRect, setContainerRect] = useState<{ left: number; width: number } | null>(null)

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setMouseX(e.clientX)
    setContainerRect({ left: rect.left, width: rect.width })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setMouseX(null)
    setContainerRect(null)
  }, [])

  return (
    <div
      className="flex items-end gap-[3px] px-1 flex-shrink-0 h-[20px]"
      style={{ width: '56px' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {LED_CONFIG.map(({ key, label, litColor }, i) => {
        const isLit = ledState[key] as boolean
        const scale = mouseX != null && containerRect
          ? getDockScale(mouseX, containerRect.left, containerRect.width, i)
          : 1
        return (
          <div
            key={key}
            className={`w-[6px] h-[6px] rounded-full transition-transform duration-150 ${
              isLit ? litColor : 'bg-slate-300 dark:bg-slate-700'
            }`}
            style={{ transform: `scale(${scale})`, transformOrigin: 'center bottom' }}
            title={`${label}: ${isLit ? 'ON' : 'off'}`}
          />
        )
      })}
      {/* Confidence — square, no rounding */}
      {(() => {
        const scale = mouseX != null && containerRect
          ? getDockScale(mouseX, containerRect.left, containerRect.width, LED_CONFIG.length)
          : 1
        return (
          <div
            className={`w-[6px] h-[6px] transition-transform duration-150 ${CONFIDENCE_COLORS[ledState.titleConfidence]}`}
            style={{ transform: `scale(${scale})`, transformOrigin: 'center bottom' }}
            title={`Title Confidence: ${ledState.titleConfidencePct}%`}
          />
        )
      })()}
    </div>
  )
}
