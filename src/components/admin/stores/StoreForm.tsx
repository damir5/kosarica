import { MapPin, ExternalLink } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { PriceSourceSelect } from './PriceSourceSelect'

export type PricingMode = 'independent' | 'inherited'

export interface StoreFormData {
  name: string
  address: string
  city: string
  latitude: string
  longitude: string
  pricingMode: PricingMode
  priceSourceStoreId: string
}

interface StoreFormProps {
  chainSlug: string
  chainName: string
  data: StoreFormData
  onChange: (data: StoreFormData) => void
  errors?: Partial<Record<keyof StoreFormData, string>>
}

export function StoreForm({
  chainSlug,
  chainName,
  data,
  onChange,
  errors = {},
}: StoreFormProps) {
  const updateField = <K extends keyof StoreFormData>(
    field: K,
    value: StoreFormData[K]
  ) => {
    onChange({ ...data, [field]: value })
  }

  const hasCoordinates = data.latitude && data.longitude

  const openInMap = () => {
    if (hasCoordinates) {
      window.open(
        `https://www.openstreetmap.org/?mlat=${data.latitude}&mlon=${data.longitude}&zoom=17`,
        '_blank'
      )
    }
  }

  return (
    <div className="space-y-6">
      {/* Section 1: Location Details */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            1
          </span>
          <h3 className="font-medium">Location Details</h3>
        </div>

        <div className="space-y-3 pl-8">
          {/* Name */}
          <div className="space-y-1.5">
            <label htmlFor="store-name" className="text-sm font-medium">
              Name
            </label>
            <Input
              id="store-name"
              value={data.name}
              onChange={(e) => updateField('name', e.target.value)}
              placeholder={`${chainName} Store Name`}
              className={errors.name ? 'border-destructive' : ''}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <label htmlFor="store-address" className="text-sm font-medium">
              Address
            </label>
            <Input
              id="store-address"
              value={data.address}
              onChange={(e) => updateField('address', e.target.value)}
              placeholder="Ul. Zrinsko Frankopanska 12"
            />
          </div>

          {/* City */}
          <div className="space-y-1.5">
            <label htmlFor="store-city" className="text-sm font-medium">
              City
            </label>
            <Input
              id="store-city"
              value={data.city}
              onChange={(e) => updateField('city', e.target.value)}
              placeholder="Zagreb"
            />
          </div>

          {/* Geo Coordinates */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Geo Coordinates</label>
            <div className="flex items-center gap-2">
              <Input
                value={data.latitude}
                onChange={(e) => updateField('latitude', e.target.value)}
                placeholder="45.8150"
                className="font-mono"
              />
              <span className="text-muted-foreground">,</span>
              <Input
                value={data.longitude}
                onChange={(e) => updateField('longitude', e.target.value)}
                placeholder="15.9819"
                className="font-mono"
              />
              <button
                type="button"
                onClick={openInMap}
                disabled={!hasCoordinates}
                className="inline-flex items-center gap-1 rounded-md border border-input bg-background px-3 py-2 text-sm font-medium shadow-sm transition-colors hover:bg-accent hover:text-accent-foreground disabled:cursor-not-allowed disabled:opacity-50"
              >
                <MapPin className="h-4 w-4" />
                <span className="hidden sm:inline">Pin on Map</span>
              </button>
            </div>
            {hasCoordinates && (
              <a
                href={`https://www.openstreetmap.org/?mlat=${data.latitude}&mlon=${data.longitude}&zoom=17`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                View on OpenStreetMap
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Section 2: Pricing Configuration */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-medium text-primary-foreground">
            2
          </span>
          <h3 className="font-medium">Pricing Configuration</h3>
        </div>

        <div className="space-y-4 pl-8">
          <p className="text-sm text-muted-foreground">
            How does this store get its prices?
          </p>

          {/* Radio Options */}
          <div className="space-y-3">
            {/* Independent Option */}
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-input p-3 transition-colors hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="pricing-mode"
                value="independent"
                checked={data.pricingMode === 'independent'}
                onChange={() => updateField('pricingMode', 'independent')}
                className="mt-0.5 h-4 w-4 border-input text-primary focus:ring-primary"
              />
              <div className="flex-1">
                <span className="block font-medium text-sm">Independent</span>
                <span className="block text-xs text-muted-foreground">
                  Has its own import files
                </span>
              </div>
            </label>

            {/* Inherited Option */}
            <label className="flex cursor-pointer items-start gap-3 rounded-md border border-input p-3 transition-colors hover:bg-accent/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5">
              <input
                type="radio"
                name="pricing-mode"
                value="inherited"
                checked={data.pricingMode === 'inherited'}
                onChange={() => updateField('pricingMode', 'inherited')}
                className="mt-0.5 h-4 w-4 border-input text-primary focus:ring-primary"
              />
              <div className="flex-1">
                <span className="block font-medium text-sm">Inherited</span>
                <span className="block text-xs text-muted-foreground">
                  Uses a Virtual Price Source
                </span>
              </div>
            </label>
          </div>

          {/* Price Source Select (only shown when inherited is selected) */}
          {data.pricingMode === 'inherited' && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Select Source</label>
              <PriceSourceSelect
                chainSlug={chainSlug}
                value={data.priceSourceStoreId}
                onValueChange={(value) => updateField('priceSourceStoreId', value)}
              />
              {errors.priceSourceStoreId && (
                <p className="text-xs text-destructive">
                  {errors.priceSourceStoreId}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
