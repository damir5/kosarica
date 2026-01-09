import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import {
  Store,
  Search,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Building2,
  ExternalLink,
  Link2,
  Unlink,
  Plus,
} from 'lucide-react'
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { StoreAddModal } from '@/components/admin/stores'

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

type PhysicalStore = {
  id: string
  chainSlug: string
  name: string
  address: string | null
  city: string | null
  postalCode: string | null
  latitude: string | null
  longitude: string | null
  isVirtual: boolean | null
  priceSourceStoreId: string | null
  status: string | null
  createdAt: Date | null
  updatedAt: Date | null
  priceSourceName: string | null
}

function StoresPage() {
  const queryClient = useQueryClient()

  // Search and filter state
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [chainFilter, setChainFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [linkedStatusFilter, setLinkedStatusFilter] = useState<string>('all')
  const [physicalPage, setPhysicalPage] = useState(1)

  // Modal state
  const [linkModalStore, setLinkModalStore] = useState<PhysicalStore | null>(null)
  const [unlinkModalStore, setUnlinkModalStore] = useState<PhysicalStore | null>(null)
  const [selectedPriceSource, setSelectedPriceSource] = useState<string>('')
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [addModalChain, setAddModalChain] = useState<{ slug: string; name: string } | null>(null)

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search)
      setPhysicalPage(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [search])

  // Query virtual stores
  const { data: virtualData, isLoading: virtualLoading } = useQuery(
    orpc.admin.stores.listVirtual.queryOptions({
      input: {
        chainSlug: chainFilter !== 'all' ? chainFilter : undefined,
        status: statusFilter !== 'all' ? (statusFilter as 'active' | 'pending') : undefined,
        search: debouncedSearch || undefined,
      },
    }),
  )

  // Query physical stores
  const { data: physicalData, isLoading: physicalLoading } = useQuery(
    orpc.admin.stores.listPhysical.queryOptions({
      input: {
        page: physicalPage,
        pageSize: 20,
        chainSlug: chainFilter !== 'all' ? chainFilter : undefined,
        status: statusFilter !== 'all' ? (statusFilter as 'active' | 'pending') : undefined,
        linkedStatus: linkedStatusFilter !== 'all' ? (linkedStatusFilter as 'linked' | 'unlinked') : undefined,
        search: debouncedSearch || undefined,
      },
    }),
  )

  // Query virtual stores for linking modal
  const { data: linkingOptions } = useQuery(
    orpc.admin.stores.getVirtualStoresForLinking.queryOptions({
      input: { chainSlug: linkModalStore?.chainSlug || '' },
    }),
  )

  // Mutations
  const linkMutation = useMutation({
    mutationFn: async ({ storeId, priceSourceStoreId }: { storeId: string; priceSourceStoreId: string }) => {
      return orpc.admin.stores.linkPriceSource.call({ storeId, priceSourceStoreId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stores'] })
      setLinkModalStore(null)
      setSelectedPriceSource('')
    },
  })

  const unlinkMutation = useMutation({
    mutationFn: async (storeId: string) => {
      return orpc.admin.stores.unlinkPriceSource.call({ storeId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stores'] })
      setUnlinkModalStore(null)
    },
  })

  const formatTimeAgo = (date: Date | null) => {
    if (!date) return 'Never'
    const now = new Date()
    const diff = now.getTime() - new Date(date).getTime()
    const hours = Math.floor(diff / (1000 * 60 * 60))
    const days = Math.floor(hours / 24)
    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    return 'Just now'
  }

  const isLoading = virtualLoading || physicalLoading

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-border border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Store className="h-8 w-8 text-primary" />
            <div>
              <h1 className="font-semibold text-2xl text-foreground">Stores & Chains</h1>
              <p className="mt-1 text-muted-foreground text-sm">
                Manage virtual price sources and physical store locations
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
            <Select value={chainFilter} onValueChange={(value) => { setChainFilter(value); setPhysicalPage(1) }}>
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
            <Select value={statusFilter} onValueChange={(value) => { setStatusFilter(value); setPhysicalPage(1) }}>
              <SelectTrigger className="w-[130px]">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
              </SelectContent>
            </Select>
            <Select value={linkedStatusFilter} onValueChange={(value) => { setLinkedStatusFilter(value); setPhysicalPage(1) }}>
              <SelectTrigger className="w-[140px]">
                <SelectValue placeholder="Link Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="linked">Linked</SelectItem>
                <SelectItem value="unlinked">Unlinked</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading stores...</p>
          </div>
        )}

        {!isLoading && (
          <div className="space-y-8">
            {/* Virtual Price Sources Section */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Virtual Price Sources
                </CardTitle>
                <CardDescription>
                  These stores are created automatically by your ingestion pipeline. Physical locations inherit prices from these sources.
                </CardDescription>
              </CardHeader>
              <CardContent>
                {virtualData && virtualData.stores.length > 0 ? (
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Name (Identifier)</TableHead>
                          <TableHead>Chain</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead>Last Update</TableHead>
                          <TableHead>Linked Physical Stores</TableHead>
                          <TableHead className="w-[100px]">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {virtualData.stores.map((store) => (
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
                              <Badge variant={store.status === 'active' ? 'default' : 'secondary'}>
                                {store.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <span className="text-sm text-muted-foreground">
                                {formatTimeAgo(store.updatedAt)}
                              </span>
                            </TableCell>
                            <TableCell>
                              <Badge variant="secondary">
                                {store.linkedPhysicalCount} Location{store.linkedPhysicalCount !== 1 ? 's' : ''} (Inheriting)
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
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="py-8 text-center text-muted-foreground">
                    No virtual price sources found
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Physical Locations Section */}
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <MapPin className="h-5 w-5" />
                      Physical Locations
                    </CardTitle>
                    <CardDescription>
                      Real-world store addresses. They inherit prices from a virtual source or have their own.
                    </CardDescription>
                  </div>
                  <Select
                    value=""
                    onValueChange={(chainSlug) => {
                      const chain = CHAINS.find((c) => c.slug === chainSlug)
                      if (chain) {
                        setAddModalChain({ slug: chain.slug, name: chain.name })
                        setAddModalOpen(true)
                      }
                    }}
                  >
                    <SelectTrigger className="w-auto">
                      <span className="flex items-center gap-2">
                        <Plus className="h-4 w-4" />
                        Add Physical Location
                      </span>
                    </SelectTrigger>
                    <SelectContent>
                      {CHAINS.map((chain) => (
                        <SelectItem key={chain.slug} value={chain.slug}>
                          {chain.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardHeader>
              <CardContent>
                {physicalData && physicalData.stores.length > 0 ? (
                  <>
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Store Name</TableHead>
                            <TableHead>Chain</TableHead>
                            <TableHead>City</TableHead>
                            <TableHead>Price Source</TableHead>
                            <TableHead className="w-[150px]">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {physicalData.stores.map((store) => (
                            <TableRow key={store.id}>
                              <TableCell>
                                <div>
                                  <p className="font-medium">{store.name}</p>
                                  {store.address && (
                                    <p className="text-sm text-muted-foreground">{store.address}</p>
                                  )}
                                </div>
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{store.chainSlug}</Badge>
                              </TableCell>
                              <TableCell>
                                <span className="text-sm">{store.city || '-'}</span>
                              </TableCell>
                              <TableCell>
                                {store.priceSourceName ? (
                                  <Badge variant="secondary">
                                    <Link2 className="mr-1 h-3 w-3" />
                                    {store.priceSourceName}
                                  </Badge>
                                ) : (
                                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                                    No Price Source
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex items-center gap-1">
                                  <Button variant="ghost" size="sm" asChild>
                                    <Link to="/admin/stores/$storeId" params={{ storeId: store.id }}>
                                      <ExternalLink className="h-4 w-4" />
                                    </Link>
                                  </Button>
                                  {store.priceSourceStoreId ? (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setUnlinkModalStore(store as PhysicalStore)}
                                    >
                                      <Unlink className="h-4 w-4" />
                                    </Button>
                                  ) : (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => setLinkModalStore(store as PhysicalStore)}
                                    >
                                      <Link2 className="h-4 w-4" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>

                    {/* Pagination */}
                    <div className="mt-4 flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        Showing {(physicalPage - 1) * 20 + 1} to {Math.min(physicalPage * 20, physicalData.total)} of{' '}
                        {physicalData.total} stores
                      </p>
                      <div className="flex items-center gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPhysicalPage((p) => Math.max(1, p - 1))}
                          disabled={physicalPage === 1}
                        >
                          <ChevronLeft className="h-4 w-4" />
                          Previous
                        </Button>
                        <span className="text-sm">
                          Page {physicalPage} of {physicalData.totalPages || 1}
                        </span>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPhysicalPage((p) => p + 1)}
                          disabled={physicalPage >= (physicalData.totalPages || 1)}
                        >
                          Next
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center text-muted-foreground">
                    No physical locations found
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Link Price Source Modal */}
      <Dialog open={!!linkModalStore} onOpenChange={(open) => !open && setLinkModalStore(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Link Price Source</DialogTitle>
            <DialogDescription>
              Select a virtual price source to link to "{linkModalStore?.name}". This store will inherit prices from the selected source.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={selectedPriceSource} onValueChange={setSelectedPriceSource}>
              <SelectTrigger>
                <SelectValue placeholder="Select a price source..." />
              </SelectTrigger>
              <SelectContent>
                {linkingOptions?.stores.map((vs) => (
                  <SelectItem key={vs.id} value={vs.id}>
                    {vs.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {linkingOptions?.stores.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                No virtual price sources available for this chain.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinkModalStore(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (linkModalStore && selectedPriceSource) {
                  linkMutation.mutate({
                    storeId: linkModalStore.id,
                    priceSourceStoreId: selectedPriceSource,
                  })
                }
              }}
              disabled={!selectedPriceSource || linkMutation.isPending}
            >
              {linkMutation.isPending ? 'Linking...' : 'Link'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Unlink Price Source Modal */}
      <Dialog open={!!unlinkModalStore} onOpenChange={(open) => !open && setUnlinkModalStore(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unlink Price Source</DialogTitle>
            <DialogDescription>
              Are you sure you want to unlink "{unlinkModalStore?.name}" from its price source "{unlinkModalStore?.priceSourceName}"? This store will no longer inherit prices.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnlinkModalStore(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (unlinkModalStore) {
                  unlinkMutation.mutate(unlinkModalStore.id)
                }
              }}
              disabled={unlinkMutation.isPending}
            >
              {unlinkMutation.isPending ? 'Unlinking...' : 'Unlink'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Physical Store Modal */}
      {addModalChain && (
        <StoreAddModal
          open={addModalOpen}
          onOpenChange={(open) => {
            setAddModalOpen(open)
            if (!open) {
              setAddModalChain(null)
            }
          }}
          chainSlug={addModalChain.slug}
          chainName={addModalChain.name}
        />
      )}
    </div>
  )
}
