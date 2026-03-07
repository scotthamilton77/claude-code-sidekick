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

export function LEDGutter({ ledState }: LEDGutterProps) {
  return (
    <div className="flex items-center gap-[3px] px-1 flex-shrink-0" style={{ width: '56px' }}>
      {LED_CONFIG.map(({ key, label, litColor }) => {
        const isLit = ledState[key] as boolean
        return (
          <div
            key={key}
            className={`w-[6px] h-[6px] rounded-full transition-colors ${
              isLit ? litColor : 'bg-slate-300 dark:bg-slate-700'
            }`}
            title={`${label}: ${isLit ? 'ON' : 'off'}`}
          />
        )
      })}
      {/* Confidence square */}
      <div
        className={`w-[6px] h-[6px] rounded-sm transition-colors ${CONFIDENCE_COLORS[ledState.titleConfidence]}`}
        title={`Confidence: ${ledState.titleConfidence}`}
      />
    </div>
  )
}
