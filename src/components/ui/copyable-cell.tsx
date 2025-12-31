import { Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

interface CopyableCellProps {
  value: string
  displayValue?: string
  label?: string
  className?: string
  mono?: boolean
}

export function CopyableCell({
  value,
  displayValue,
  label = 'Value',
  className = '',
  mono = false,
}: CopyableCellProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success(`${label} copied to clipboard`)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`)
    }
  }

  return (
    <button
      type="button"
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm transition-colors hover:bg-muted/50',
        className
      )}
      onClick={handleCopy}
    >
      <span className={cn(mono && 'font-mono')}>{displayValue ?? value}</span>
      {copied ? (
        <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
      ) : (
        <Copy className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
      )}
    </button>
  )
}
