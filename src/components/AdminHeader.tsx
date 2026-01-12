import { Link, useRouterState } from '@tanstack/react-router'
import {
  Database,
  Home,
  Settings,
  Shield,
  Store,
  Users,
  Wrench,
  Clock,
} from 'lucide-react'

const adminNavItems = [
  { to: '/admin', label: 'Dashboard', icon: Home, exact: true },
  { to: '/admin/users', label: 'Users', icon: Users },
  { to: '/admin/stores', label: 'Stores', icon: Store },
  { to: '/admin/stores/pending', label: 'Pending Stores', icon: Clock },
  { to: '/admin/ingestion', label: 'Ingestion', icon: Database },
  { to: '/admin/settings', label: 'Settings', icon: Settings },
  { to: '/admin/config', label: 'Config', icon: Wrench },
]

export default function AdminHeader() {
  const routerState = useRouterState()
  const currentPath = routerState.location.pathname

  const isActive = (to: string, exact?: boolean) => {
    if (exact) {
      return currentPath === to
    }
    return currentPath.startsWith(to)
  }

  return (
    <header className="border-border border-b bg-card">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Logo/Brand */}
          <div className="flex items-center gap-3">
            <Shield className="size-6 text-primary" />
            <Link to="/admin" className="font-semibold text-foreground text-lg">
              Admin
            </Link>
          </div>

          {/* Navigation */}
          <nav className="flex items-center gap-1">
            {adminNavItems.map((item) => {
              const Icon = item.icon
              const active = isActive(item.to, item.exact)
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  <Icon className="size-4" />
                  <span>{item.label}</span>
                </Link>
              )
            })}
          </nav>

          {/* Back to main app */}
          <Link
            to="/"
            className="text-muted-foreground text-sm hover:text-foreground"
          >
            Back to App
          </Link>
        </div>
      </div>
    </header>
  )
}
