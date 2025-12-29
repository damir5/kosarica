import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Settings, Users, Wrench } from 'lucide-react'
import { orpc } from '@/orpc/client'

export const Route = createFileRoute('/_admin/admin/')({
  component: AdminDashboard,
})

function AdminDashboard() {
  const { data, isLoading, error } = useQuery(orpc.admin.getConfigInfo.queryOptions({ input: {} }))

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-border border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div>
            <h1 className="font-semibold text-2xl text-foreground">Admin Dashboard</h1>
            <p className="mt-2 text-muted-foreground text-sm">
              Manage and monitor your application
            </p>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Status Card */}
        <div className="mb-8 rounded-lg border border-border bg-card p-6 shadow-sm">
          {isLoading && (
            <div className="text-foreground">
              <p>Loading admin status...</p>
            </div>
          )}
          {error && (
            <div className="text-destructive">
              <p>Error: {error.message}</p>
            </div>
          )}
          {data && (
            <>
              <div className="text-foreground text-lg">
                <p>Admin Dashboard Ready</p>
              </div>
              <div className="mt-2 text-muted-foreground text-sm">
                <p>Environment: {data.buildInfo.environment}</p>
                <p>Build: {data.buildInfo.gitCommit}</p>
              </div>
            </>
          )}
        </div>

        {/* Navigation Cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          <Link
            to="/admin/users"
            className="block rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md"
          >
            <Users className="mb-3 size-8 text-primary" />
            <h3 className="mb-2 font-semibold text-foreground text-lg">User Management</h3>
            <p className="text-muted-foreground text-sm">
              View, edit, and manage user accounts, roles, and permissions
            </p>
          </Link>
          <Link
            to="/admin/settings"
            className="block rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md"
          >
            <Settings className="mb-3 size-8 text-primary" />
            <h3 className="mb-2 font-semibold text-foreground text-lg">Settings</h3>
            <p className="text-muted-foreground text-sm">
              Configure app and authentication settings
            </p>
          </Link>
          <Link
            to="/admin/config"
            className="block rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md"
          >
            <Wrench className="mb-3 size-8 text-primary" />
            <h3 className="mb-2 font-semibold text-foreground text-lg">Configuration</h3>
            <p className="text-muted-foreground text-sm">
              View build information, client configuration, and server environment variables
            </p>
          </Link>
        </div>
      </div>
    </div>
  )
}
