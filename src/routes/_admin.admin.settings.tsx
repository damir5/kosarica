import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { Settings } from 'lucide-react'
import { orpc } from '@/orpc/client'
import { AppSettingsForm } from '@/components/admin/AppSettingsForm'
import { AuthSettingsForm } from '@/components/admin/AuthSettingsForm'

export const Route = createFileRoute('/_admin/admin/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const queryClient = useQueryClient()

  // Query settings
  const { data: settings, isLoading, error } = useQuery(
    orpc.admin.settings.get.queryOptions({
      input: {},
    })
  )

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (input: {
      appName?: string
      requireEmailVerification?: boolean
      minPasswordLength?: number
      maxPasswordLength?: number
      passkeyEnabled?: boolean
    }) => {
      return orpc.admin.settings.update.call(input)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'settings'] })
    },
  })

  return (
    <>
      {/* Header */}
      <div className="border-border border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Settings className="h-8 w-8 text-primary" />
            <div>
              <h1 className="font-semibold text-2xl text-foreground">Settings</h1>
              <p className="mt-1 text-muted-foreground text-sm">
                Configure app and authentication settings
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Error State */}
        {error && (
          <div className="mb-6 rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">Error: {error.message}</p>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading settings...</p>
          </div>
        )}

        {/* Settings Forms */}
        {settings && !isLoading && (
          <div className="space-y-8">
            <AppSettingsForm
              settings={settings}
              onSave={async (data) => {
                await updateMutation.mutateAsync(data)
              }}
              isLoading={updateMutation.isPending}
            />

            <AuthSettingsForm
              settings={settings}
              onSave={async (data) => {
                await updateMutation.mutateAsync(data)
              }}
              isLoading={updateMutation.isPending}
            />
          </div>
        )}
      </div>
    </>
  )
}
