import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import type { User } from './UserTable'

interface UserViewModalProps {
  user: User | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserViewModal({ user, open, onOpenChange }: UserViewModalProps) {
  if (!user) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>User Details</DialogTitle>
          <DialogDescription>
            View complete information about this user.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                ID
              </label>
              <p className="mt-1 font-mono text-sm">{user.id}</p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Role
              </label>
              <p className="mt-1">
                <Badge variant={user.role === 'superadmin' ? 'default' : 'secondary'}>
                  {user.role || 'user'}
                </Badge>
              </p>
            </div>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Name
            </label>
            <p className="mt-1">{user.name}</p>
          </div>

          <div>
            <label className="text-sm font-medium text-muted-foreground">
              Email
            </label>
            <p className="mt-1">{user.email}</p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Email Verified
              </label>
              <p className="mt-1">
                <Badge variant={user.emailVerified ? 'default' : 'outline'}>
                  {user.emailVerified ? 'Verified' : 'Not Verified'}
                </Badge>
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Status
              </label>
              <p className="mt-1">
                {user.banned ? (
                  <Badge variant="destructive">Banned</Badge>
                ) : (
                  <Badge variant="outline">Active</Badge>
                )}
              </p>
            </div>
          </div>

          {user.banned && user.bannedReason && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Ban Reason
              </label>
              <p className="mt-1 text-sm text-destructive">{user.bannedReason}</p>
            </div>
          )}

          {user.banned && user.bannedAt && (
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Banned At
              </label>
              <p className="mt-1 text-sm">
                {new Date(user.bannedAt).toLocaleString()}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Created At
              </label>
              <p className="mt-1 text-sm">
                {new Date(user.createdAt).toLocaleString()}
              </p>
            </div>
            <div>
              <label className="text-sm font-medium text-muted-foreground">
                Updated At
              </label>
              <p className="mt-1 text-sm">
                {new Date(user.updatedAt).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
