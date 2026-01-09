import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Sparkles, MapPin, FileCheck, Brain, Loader2 } from 'lucide-react'
import { orpc } from '@/orpc/client'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { EnrichmentTaskCard, type EnrichmentTask } from './EnrichmentTaskCard'
import { VerifyLocationModal } from './VerifyLocationModal'

interface StoreEnrichmentSectionProps {
  storeId: string
  store: {
    id: string
    name: string
    address: string | null
    city: string | null
    postalCode: string | null
    latitude: string | null
    longitude: string | null
    [key: string]: unknown // Allow additional properties from the API
  }
}

export function StoreEnrichmentSection({ storeId, store }: StoreEnrichmentSectionProps) {
  const queryClient = useQueryClient()
  const [selectedTask, setSelectedTask] = useState<EnrichmentTask | null>(null)
  const [verifyModalOpen, setVerifyModalOpen] = useState(false)

  // Fetch enrichment tasks
  const { data: tasksData, isLoading: isLoadingTasks } = useQuery(
    orpc.admin.stores.getEnrichmentTasks.queryOptions({
      input: { storeId },
    }),
  )

  // Trigger enrichment mutation
  const triggerMutation = useMutation({
    mutationFn: async (type: 'geocode' | 'verify_address' | 'ai_categorize') => {
      return orpc.admin.stores.triggerEnrichment.call({
        storeId,
        type,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stores', 'getEnrichmentTasks'] })
    },
  })

  // Verify enrichment mutation
  const verifyMutation = useMutation({
    mutationFn: async ({
      taskId,
      accepted,
      corrections,
    }: {
      taskId: string
      accepted: boolean
      corrections?: Record<string, unknown>
    }) => {
      return orpc.admin.stores.verifyEnrichment.call({
        taskId,
        accepted,
        corrections,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'stores'] })
      setVerifyModalOpen(false)
      setSelectedTask(null)
    },
  })

  const handleTriggerEnrichment = (type: 'geocode' | 'verify_address' | 'ai_categorize') => {
    triggerMutation.mutate(type)
  }

  const handleVerify = (task: EnrichmentTask) => {
    setSelectedTask(task)
    setVerifyModalOpen(true)
  }

  const handleAccept = async (taskId: string, corrections?: Record<string, unknown>) => {
    await verifyMutation.mutateAsync({
      taskId,
      accepted: true,
      corrections,
    })
  }

  const handleReject = async (taskId: string) => {
    await verifyMutation.mutateAsync({
      taskId,
      accepted: false,
    })
  }

  const tasks = tasksData?.tasks || []

  // Check if there's an active geocoding task (pending or processing)
  const hasActiveGeocode = tasks.some(
    (t) => t.type === 'geocode' && (t.status === 'pending' || t.status === 'processing'),
  )
  const hasActiveVerifyAddress = tasks.some(
    (t) => t.type === 'verify_address' && (t.status === 'pending' || t.status === 'processing'),
  )
  const hasActiveAiCategorize = tasks.some(
    (t) => t.type === 'ai_categorize' && (t.status === 'pending' || t.status === 'processing'),
  )

  // Check if store already has coordinates
  const hasCoordinates = store.latitude && store.longitude

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Data Enrichment
          </CardTitle>
          <CardDescription>
            Automatically enhance store data with geocoding and AI-powered verification
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Quick Actions */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => handleTriggerEnrichment('geocode')}
              disabled={triggerMutation.isPending || hasActiveGeocode}
            >
              {triggerMutation.isPending && triggerMutation.variables === 'geocode' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <MapPin className="mr-2 h-4 w-4" />
              )}
              {hasCoordinates ? 'Re-geocode Address' : 'Geocode Address'}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleTriggerEnrichment('verify_address')}
              disabled={triggerMutation.isPending || hasActiveVerifyAddress}
            >
              {triggerMutation.isPending && triggerMutation.variables === 'verify_address' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileCheck className="mr-2 h-4 w-4" />
              )}
              Verify Address
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => handleTriggerEnrichment('ai_categorize')}
              disabled={triggerMutation.isPending || hasActiveAiCategorize}
            >
              {triggerMutation.isPending && triggerMutation.variables === 'ai_categorize' ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Brain className="mr-2 h-4 w-4" />
              )}
              AI Categorize
            </Button>
          </div>

          {/* Enrichment Tasks */}
          <div className="space-y-4">
            <h4 className="text-sm font-medium text-muted-foreground">
              Enrichment Tasks
              {isLoadingTasks && <Loader2 className="ml-2 inline h-3 w-3 animate-spin" />}
            </h4>

            {tasks.length === 0 && !isLoadingTasks ? (
              <div className="rounded-md bg-muted p-4 text-center text-sm text-muted-foreground">
                No enrichment tasks yet. Click a button above to start enriching this store's data.
              </div>
            ) : (
              <div className="space-y-4">
                {tasks.map((task) => (
                  <EnrichmentTaskCard
                    key={task.id}
                    task={task as EnrichmentTask}
                    onVerify={handleVerify}
                  />
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Verify Location Modal */}
      <VerifyLocationModal
        task={selectedTask}
        open={verifyModalOpen}
        onOpenChange={setVerifyModalOpen}
        onAccept={handleAccept}
        onReject={handleReject}
        isLoading={verifyMutation.isPending}
      />
    </>
  )
}
