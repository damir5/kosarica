import { RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface RerunButtonProps {
  onRerun: () => void
  isLoading?: boolean
  label?: string
  size?: 'default' | 'sm' | 'lg' | 'icon'
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link'
}

export function RerunButton({
  onRerun,
  isLoading = false,
  label,
  size = 'default',
  variant = 'outline',
}: RerunButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      onClick={onRerun}
      disabled={isLoading}
    >
      <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''} ${label ? 'mr-2' : ''}`} />
      {label && (isLoading ? 'Rerunning...' : label)}
    </Button>
  )
}
