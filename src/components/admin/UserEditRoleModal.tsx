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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { User } from './UserTable'

interface UserEditRoleModalProps {
  user: User | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (userId: string, role: 'user' | 'superadmin') => Promise<void>
  isLoading?: boolean
}

export function UserEditRoleModal({
  user,
  open,
  onOpenChange,
  onSave,
  isLoading,
}: UserEditRoleModalProps) {
  const [role, setRole] = useState<'user' | 'superadmin'>(
    (user?.role as 'user' | 'superadmin') || 'user'
  )

  if (!user) return null

  const handleSave = async () => {
    await onSave(user.id, role)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Change User Role</DialogTitle>
          <DialogDescription>
            Update the role for {user.name}. This will affect their permissions.
          </DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <label className="text-sm font-medium">Role</label>
          <Select
            value={role}
            onValueChange={(value) => setRole(value as 'user' | 'superadmin')}
          >
            <SelectTrigger className="mt-2">
              <SelectValue placeholder="Select a role" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="user">User</SelectItem>
              <SelectItem value="superadmin">Superadmin</SelectItem>
            </SelectContent>
          </Select>
          {role === 'superadmin' && (
            <p className="mt-2 text-sm text-muted-foreground">
              Superadmins have full access to the admin dashboard and all settings.
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading ? 'Saving...' : 'Save Changes'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
