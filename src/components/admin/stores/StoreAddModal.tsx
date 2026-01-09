import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { MapPin } from 'lucide-react'
import { orpc } from '@/orpc/client'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { StoreForm, type StoreFormData } from './StoreForm'

interface StoreAddModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  chainSlug: string
  chainName: string
}

const initialFormData: StoreFormData = {
  name: '',
  address: '',
  city: '',
  latitude: '',
  longitude: '',
  pricingMode: 'inherited',
  priceSourceStoreId: '',
}

export function StoreAddModal({
  open,
  onOpenChange,
  chainSlug,
  chainName,
}: StoreAddModalProps) {
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<StoreFormData>(initialFormData)
  const [errors, setErrors] = useState<Partial<Record<keyof StoreFormData, string>>>({})

  const createMutation = useMutation({
    mutationFn: async (data: {
      chainSlug: string
      name: string
      address?: string
      city?: string
      latitude?: string
      longitude?: string
      priceSourceStoreId?: string
    }) => {
      return orpc.admin.stores.create.call(data)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stores'] })
      handleClose()
    },
  })

  const handleClose = () => {
    setFormData(initialFormData)
    setErrors({})
    createMutation.reset()
    onOpenChange(false)
  }

  const validate = (): boolean => {
    const newErrors: Partial<Record<keyof StoreFormData, string>> = {}

    if (!formData.name.trim()) {
      newErrors.name = 'Store name is required'
    }

    if (formData.pricingMode === 'inherited' && !formData.priceSourceStoreId) {
      newErrors.priceSourceStoreId = 'Please select a price source'
    }

    // Validate coordinates if provided
    if (formData.latitude && formData.longitude) {
      const lat = parseFloat(formData.latitude)
      const lng = parseFloat(formData.longitude)
      if (isNaN(lat) || lat < -90 || lat > 90) {
        newErrors.latitude = 'Invalid latitude'
      }
      if (isNaN(lng) || lng < -180 || lng > 180) {
        newErrors.longitude = 'Invalid longitude'
      }
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = () => {
    if (!validate()) return

    const payload: Parameters<typeof createMutation.mutate>[0] = {
      chainSlug,
      name: formData.name.trim(),
    }

    if (formData.address.trim()) {
      payload.address = formData.address.trim()
    }
    if (formData.city.trim()) {
      payload.city = formData.city.trim()
    }
    if (formData.latitude.trim()) {
      payload.latitude = formData.latitude.trim()
    }
    if (formData.longitude.trim()) {
      payload.longitude = formData.longitude.trim()
    }
    if (formData.pricingMode === 'inherited' && formData.priceSourceStoreId) {
      payload.priceSourceStoreId = formData.priceSourceStoreId
    }

    createMutation.mutate(payload)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Add New Physical Store
          </DialogTitle>
          <DialogDescription>
            Create a new physical store location for {chainName}.
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          <StoreForm
            chainSlug={chainSlug}
            chainName={chainName}
            data={formData}
            onChange={setFormData}
            errors={errors}
          />
        </div>

        {createMutation.isError && (
          <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">
            {createMutation.error?.message || 'Failed to create store'}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={createMutation.isPending}>
            {createMutation.isPending ? 'Saving...' : 'Save Store'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
