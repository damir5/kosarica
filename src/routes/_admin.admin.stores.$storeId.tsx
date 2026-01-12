import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, MapPin, Building2, Store as StoreIcon } from 'lucide-react'
import { orpc } from '@/orpc/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StoreEnrichmentSection } from '@/components/admin/stores/StoreEnrichmentSection'

export const Route = createFileRoute('/_admin/admin/stores/$storeId')({
  component: StoreDetailPage,
})

type StoreData = {
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
}

function StoreDetailPage() {
  const { storeId } = Route.useParams()

  const { data, isLoading, error } = useQuery(
    orpc.admin.stores.get.queryOptions({
      input: { storeId },
    }),
  )

  const store = data as StoreData | undefined

  if (isLoading) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex items-center justify-center py-12">
          <p className="text-muted-foreground">Loading store details...</p>
        </div>
      </div>
    )
  }

  if (error || !store) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
          <p className="text-sm text-destructive">
            Error: {error?.message || 'Store not found'}
          </p>
        </div>
        <Button variant="outline" className="mt-4" asChild>
          <Link to="/admin/stores">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to Stores
          </Link>
        </Button>
      </div>
    )
  }

  return (
    <>
      {/* Header */}
      <div className="border-border border-b bg-card">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <Link to="/admin/stores">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <StoreIcon className="h-8 w-8 text-primary" />
                <div>
                  <h1 className="font-semibold text-2xl text-foreground">{store.name}</h1>
                  <p className="mt-1 text-muted-foreground text-sm font-mono">{store.id}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{store.chainSlug}</Badge>
              <Badge variant={store.status === 'active' ? 'default' : 'secondary'}>
                {store.status}
              </Badge>
              {store.isVirtual && (
                <Badge variant="secondary">
                  <Building2 className="mr-1 h-3 w-3" />
                  Virtual
                </Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {/* Location Card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MapPin className="h-5 w-5" />
              Location Information
            </CardTitle>
            <CardDescription>
              Store address and geographic coordinates
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Address</label>
                <p className="mt-1">{store.address || 'Not set'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">City</label>
                <p className="mt-1">{store.city || 'Not set'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Postal Code</label>
                <p className="mt-1">{store.postalCode || 'Not set'}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Coordinates</label>
                <p className="mt-1 font-mono">
                  {store.latitude && store.longitude ? (
                    <>
                      {Number(store.latitude).toFixed(6)}, {Number(store.longitude).toFixed(6)}
                    </>
                  ) : (
                    <span className="text-muted-foreground">Not geocoded</span>
                  )}
                </p>
              </div>
            </div>

            {/* Map Preview (if coordinates exist) */}
            {store.latitude && store.longitude && (
              <div className="mt-4">
                <a
                  href={`https://www.openstreetmap.org/?mlat=${store.latitude}&mlon=${store.longitude}&zoom=17`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  View on OpenStreetMap
                  <MapPin className="h-3 w-3" />
                </a>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Enrichment Section */}
        <StoreEnrichmentSection storeId={store.id} store={store} />
      </div>
    </>
  )
}
