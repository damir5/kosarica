import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Settings, Users, Wrench, Store, Database } from 'lucide-react'
import { orpc } from '@/orpc/client'

export const Route = createFileRoute('/_admin/admin/')({
  component: AdminDashboard,
})

function AdminDashboard() {
  const { data, isLoading, error } = useQuery(orpc.admin.getConfigInfo.queryOptions({ input: {} }))

  return (
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
          <Link
            to="/admin/stores"
            className="block rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md"
          >
            <Store className="mb-3 size-8 text-primary" />
            <h3 className="mb-2 font-semibold text-foreground text-lg">Store Management</h3>
            <p className="text-muted-foreground text-sm">
              View and manage store locations, geocoding, and data enrichment
            </p>
          </Link>
          <Link
            to="/admin/ingestion"
            className="block rounded-lg border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md"
          >
            <Database className="mb-3 size-8 text-primary" />
            <h3 className="mb-2 font-semibold text-foreground text-lg">Ingestion Monitor</h3>
            <p className="text-muted-foreground text-sm">
              Monitor data ingestion runs, files, and errors
            </p>
          </Link>
        </div>
    </div>
  )
}
