import { LucideProps } from 'lucide-react'
import dynamicIconImports from 'lucide-react/dynamicIconImports'
import { lazy, Suspense, useMemo } from 'react'

interface IconProps extends LucideProps {
  name: keyof typeof dynamicIconImports
}

const Icon = ({ name, ...props }: IconProps) => {
  const LucideIcon = useMemo(() => lazy(dynamicIconImports[name]), [name])

  return (
    <Suspense fallback={<div style={{ width: props.size || 24, height: props.size || 24 }} />}>
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <LucideIcon {...(props as any)} />
    </Suspense>
  )
}

export default Icon
