import { type ColumnDef } from '@tanstack/react-table'
import { MoreHorizontal, Eye, UserCog, Trash2, Ban, CheckCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CopyableCell } from '@/components/ui/copyable-cell'
import { DataTable } from '@/components/ui/data-table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export interface User {
  id: string
  name: string
  email: string
  emailVerified: boolean
  image: string | null
  role: string | null
  banned: boolean | null
  bannedAt: Date | null
  bannedReason: string | null
  createdAt: Date
  updatedAt: Date
}

interface UserTableProps {
  users: User[]
  currentUserId: string
  onViewUser: (user: User) => void
  onEditRole: (user: User) => void
  onDeleteUser: (user: User) => void
  onBanUser: (user: User) => void
}

function getUserColumns({
  currentUserId,
  onViewUser,
  onEditRole,
  onDeleteUser,
  onBanUser,
}: {
  currentUserId: string
  onViewUser: (user: User) => void
  onEditRole: (user: User) => void
  onDeleteUser: (user: User) => void
  onBanUser: (user: User) => void
}): ColumnDef<User>[] {
  return [
    {
      accessorKey: 'name',
      header: 'Name',
      size: 180,
      minSize: 100,
      maxSize: 300,
      cell: ({ row }) => (
        <CopyableCell
          value={row.getValue('name')}
          label="Name"
          className="-ml-2 font-medium"
        />
      ),
    },
    {
      accessorKey: 'email',
      header: 'Email',
      size: 250,
      minSize: 150,
      maxSize: 400,
      cell: ({ row }) => (
        <CopyableCell
          value={row.getValue('email')}
          label="Email"
          className="-ml-2 text-muted-foreground"
        />
      ),
    },
    {
      accessorKey: 'role',
      header: 'Role',
      size: 120,
      minSize: 80,
      maxSize: 160,
      cell: ({ row }) => {
        const role = row.getValue('role') as string
        return (
          <Badge variant={role === 'superadmin' ? 'default' : 'secondary'}>
            {role || 'user'}
          </Badge>
        )
      },
    },
    {
      accessorKey: 'banned',
      header: 'Status',
      size: 100,
      minSize: 80,
      maxSize: 140,
      cell: ({ row }) => {
        const banned = row.getValue('banned') as boolean
        return banned ? (
          <Badge variant="destructive">Banned</Badge>
        ) : (
          <Badge variant="outline">Active</Badge>
        )
      },
    },
    {
      accessorKey: 'createdAt',
      header: 'Created',
      size: 120,
      minSize: 100,
      maxSize: 180,
      cell: ({ row }) => {
        const date = row.getValue('createdAt') as Date
        return (
          <div className="text-sm text-muted-foreground">
            {new Date(date).toLocaleDateString()}
          </div>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      size: 60,
      minSize: 60,
      maxSize: 60,
      enableResizing: false,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => {
        const user = row.original
        const isCurrentUser = user.id === currentUserId

        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
                <span className="sr-only">Open menu</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => onViewUser(user)}>
                <Eye className="mr-2 h-4 w-4" />
                View Details
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onEditRole(user)}
                disabled={isCurrentUser}
              >
                <UserCog className="mr-2 h-4 w-4" />
                Change Role
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => onBanUser(user)}
                disabled={isCurrentUser}
              >
                {user.banned ? (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Unban User
                  </>
                ) : (
                  <>
                    <Ban className="mr-2 h-4 w-4" />
                    Ban User
                  </>
                )}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => onDeleteUser(user)}
                disabled={isCurrentUser}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete User
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]
}

export function UserTable({
  users,
  currentUserId,
  onViewUser,
  onEditRole,
  onDeleteUser,
  onBanUser,
}: UserTableProps) {
  const columns = getUserColumns({
    currentUserId,
    onViewUser,
    onEditRole,
    onDeleteUser,
    onBanUser,
  })

  return (
    <DataTable
      columns={columns}
      data={users}
      storageKey="admin-users-table"
      enableColumnResizing
      enableColumnOrdering
      enableColumnVisibility
      enableSorting
      // Pagination and global filter are handled externally by the page
      enablePagination={false}
      enableGlobalFilter={false}
      enableColumnFilters={false}
      emptyMessage="No users found."
    />
  )
}
