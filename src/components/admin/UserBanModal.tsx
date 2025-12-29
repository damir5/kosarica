import { useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { User } from './UserTable'

interface UserBanModalProps {
  user: User | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (userId: string, banned: boolean, reason?: string) => Promise<void>
  isLoading?: boolean
}

export function UserBanModal({
  user,
  open,
  onOpenChange,
  onConfirm,
  isLoading,
}: UserBanModalProps) {
  const [reason, setReason] = useState('')

  if (!user) return null

  const isBanning = !user.banned

  const handleConfirm = async () => {
    await onConfirm(user.id, isBanning, isBanning ? reason : undefined)
    setReason('')
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isBanning ? 'Ban User' : 'Unban User'}</DialogTitle>
          <DialogDescription>
            {isBanning
              ? 'This will prevent the user from accessing the application.'
              : 'This will restore the user\'s access to the application.'}
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <div className="rounded-lg border p-4">
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>

          {isBanning && (
            <div className="mt-4">
              <label className="text-sm font-medium">
                Reason (optional)
              </label>
              <Input
                className="mt-2"
                placeholder="Enter a reason for banning this user"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}

          {!isBanning && user.bannedReason && (
            <div className="mt-4">
              <label className="text-sm font-medium text-muted-foreground">
                Previous Ban Reason
              </label>
              <p className="mt-1 text-sm">{user.bannedReason}</p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={isBanning ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={isLoading}
          >
            {isLoading
              ? isBanning
                ? 'Banning...'
                : 'Unbanning...'
              : isBanning
                ? 'Ban User'
                : 'Unban User'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
