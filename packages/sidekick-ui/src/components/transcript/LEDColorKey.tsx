import { useState } from 'react'
import { Info, ChevronDown, ChevronRight } from 'lucide-react'

const KEY_ITEMS = [
  { letter: 'B', color: 'bg-blue-500', label: 'Build pending' },
  { letter: 'T', color: 'bg-cyan-500', label: 'Typecheck pending' },
  { letter: 't', color: 'bg-emerald-500', label: 'Test pending' },
  { letter: 'L', color: 'bg-amber-500', label: 'Lint pending' },
  { letter: 'V', color: 'bg-red-500', label: 'Verify completion' },
  { letter: 'P', color: 'bg-orange-500', label: 'Pause & reflect' },
  { letter: '■', color: 'bg-emerald-500', label: 'Title confidence' },
]

export function LEDColorKey() {
  const [open, setOpen] = useState(false)

  return (
    <div className="border-b border-slate-200 dark:border-slate-700">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 px-2 py-1 text-[10px] text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 w-full"
      >
        <Info size={10} />
        <span>LED Key</span>
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
      </button>
      {open && (
        <div className="px-2 pb-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5">
          {KEY_ITEMS.map(({ letter, color, label }) => (
            <div key={letter} className="flex items-center gap-1.5">
              <div className={`w-[6px] h-[6px] ${letter === '■' ? 'rounded-sm' : 'rounded-full'} ${color}`} />
              <span className="text-[10px] text-slate-500 dark:text-slate-400">
                <span className="font-mono font-medium">{letter}</span> {label}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
