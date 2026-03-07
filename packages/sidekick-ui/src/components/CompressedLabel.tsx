interface CompressedLabelProps {
  text: string
  onClick?: () => void
}

export function CompressedLabel({ text, onClick }: CompressedLabelProps) {
  return (
    <button
      onClick={onClick}
      className="h-full w-full flex items-center justify-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      title={text}
    >
      <span className="text-vertical text-xs font-medium text-slate-600 dark:text-slate-400 select-none tracking-wide">
        {text}
      </span>
    </button>
  )
}
