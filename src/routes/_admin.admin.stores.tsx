import { useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { Store, Search, ChevronLeft, ChevronRight, MapPin, Building2, ExternalLink } from 'lucide-react'
import { orpc } from '@/orpc/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export const Route = createFileRoute('/_admin/admin/stores')({
  component: StoresPage,
})

// Chain options for the filter
const CHAINS = [
  { slug: 'konzum', name: 'Konzum' },
  { slug: 'lidl', name: 'Lidl' },
  { slug: 'plodine', name: 'Plodine' },
  { slug: 'interspar', name: 'Interspar' },
  { slug: 'kaufland', name: 'Kaufland' },
  { slug: 'ktc', name: 'KTC' },
  { slug: 'eurospin', name: 'Eurospin' },
  { slug: 'dm', name: 'DM' },
  { slug: 'metro', name: 'Metro' },
  { slug: 'studenac', name: 'Studenac' },
  { slug: 'trgocentar', name: 'Trgocentar' },
]

function StoresPage() {
  // Search and filter state
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [chainFilter, setChainFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [virtualFilter, setVirtualFilter] = useState<string>('all')
  const [page, setPage] = useState(1)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Query stores
  const { data, isLoading, error } = useQuery(
    orpc.admin.stores.list.queryOptions({
      input: {
        page,
        pageSize: 20,
        search: debouncedSearch || undefined,
        chainSlug: chainFilter !== 'all' ? chainFilter : undefined,
        status: statusFilter !== 'all' ? (statusFilter as 'active' | 'pending') : undefined,
        isVirtual: virtualFilter !== 'all' ? virtualFilter === 'virtual' : undefined,
      },
    }),
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-border border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Store className="h-8 w-8 text-primary" />
            <div>
              <h1 className="font-semibold text-2xl text-foreground">Store Management</h1>
              <p className="mt-1 text-muted-foreground text-sm">
                View and manage store locations, geocoding, and data enrichment
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Filters */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search by name, address, or city..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Select value={chainFilter} onValueChange={(value) => { setChainFilter(value); setPage(1) }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Chain" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Chains</SelectItem>
                {CHAINS.map((chain) => (
                  <SelectItem key={chain.slug} value={chain.slug}>
                    {chain.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPage(1) }}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Select value={virtualFilter} onValueChange={(value) => { setVirtualFilter(value); setPage(1) }}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="physical">Physical</SelectItem>
                <SelectItem value="virtual">Virtual</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">Error: {error.message}</p>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading stores...</p>
          </div>
        )}

        {/* Stores Table */}
        {data && !isLoading && (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Store</TableHead>
                    <TableHead>Chain</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Coordinates</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="w-[100px]">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.stores.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="py-8 text-center text-muted-foreground">
                        No stores found
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.stores.map((store) => (
                      <TableRow key={store.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{store.name}</p>
                            <p className="text-sm text-muted-foreground font-mono">{store.id}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{store.chainSlug}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-start gap-1">
                            <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                            <div className="text-sm">
                              {store.address && <p>{store.address}</p>}
                              <p className="text-muted-foreground">
                                {[store.postalCode, store.city].filter(Boolean).join(' ')}
                              </p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {store.latitude && store.longitude ? (
                            <div className="text-sm font-mono">
                              <span className="text-muted-foreground">
                                {Number(store.latitude).toFixed(4)}, {Number(store.longitude).toFixed(4)}
                              </span>
                            </div>
                          ) : (
                            <Badge variant="secondary">No coordinates</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          {store.isVirtual ? (
                            <Badge variant="secondary">
                              <Building2 className="mr-1 h-3 w-3" />
                              Virtual
                            </Badge>
                          ) : (
                            <Badge variant="outline">Physical</Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={store.status === 'active' ? 'default' : 'secondary'}
                          >
                            {store.status}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="sm" asChild>
                            <Link to="/admin/stores/$storeId" params={{ storeId: store.id }}>
                              <ExternalLink className="h-4 w-4" />
                              View
                            </Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Pagination */}
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Showing {(page - 1) * 20 + 1} to {Math.min(page * 20, data.total)} of{' '}
                {data.total} stores
              </p>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                  Previous
                </Button>
                <span className="text-sm">
                  Page {page} of {data.totalPages || 1}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={page >= (data.totalPages || 1)}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
