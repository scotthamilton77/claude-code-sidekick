import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'

interface CollapsibleControlledProps {
  label: string
  labelClassName?: string
  open: boolean
  onToggle: () => void
  children: ReactNode
}

interface CollapsibleUncontrolledProps {
  label: string
  labelClassName?: string
  defaultOpen?: boolean
  children: ReactNode
}

export type CollapsibleProps = CollapsibleControlledProps | CollapsibleUncontrolledProps

function isControlled(props: CollapsibleProps): props is CollapsibleControlledProps {
  return 'onToggle' in props
}

export function Collapsible(props: CollapsibleProps): ReactNode {
  const { label, labelClassName, children } = props

  const controlled = isControlled(props)
  const [internalOpen, setInternalOpen] = useState(controlled ? false : (props.defaultOpen ?? false))

  const open = controlled ? props.open : internalOpen
  const toggle = controlled ? props.onToggle : () => setInternalOpen((v) => !v)

  const Chevron = open ? ChevronDown : ChevronRight
  const labelClass = ['text-[10px] font-medium text-slate-500', labelClassName].filter(Boolean).join(' ')

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-1 w-full px-2 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        <Chevron size={12} className="text-slate-400" />
        <span className={labelClass}>{label}</span>
      </button>
      {open && (
        <div className="px-2 py-1.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-auto max-h-[300px]">
          {children}
        </div>
      )}
    </div>
  )
}
