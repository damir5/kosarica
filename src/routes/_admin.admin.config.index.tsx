import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { AlertTriangle, CheckCircle2, Globe, Info, Server, Settings } from 'lucide-react'
import { useEffect, useState } from 'react'
import { MetricCard } from '@/components/admin/MetricCard'
import { clientConfig } from '@/config/clientConfig'
import { orpc } from '@/orpc/client'

export const Route = createFileRoute('/_admin/admin/config/')({
  component: AdminConfigPage,
})

function AdminConfigPage() {
  const { data, isLoading, error } = useQuery(orpc.admin.getConfigInfo.queryOptions({ input: {} }))
  const [clientRuntimeConfig, setClientRuntimeConfig] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const config: Record<string, string> = {}
      Object.keys(clientConfig)
        .sort()
        .forEach((key) => {
          config[key] = (clientConfig as Record<string, string>)[key] || 'Not set'
        })
      setClientRuntimeConfig(config)
    }
  }, [])

  return (
    <div className="min-h-screen bg-background">
      <div className="border-border border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <Settings className="h-8 w-8 text-primary" />
            <h1 className="font-semibold text-2xl text-foreground">Configuration</h1>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading configuration...</p>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-destructive bg-destructive/10 p-6">
            <p className="text-destructive">Error loading configuration: {error.message}</p>
          </div>
        )}

        {data && (
          <div className="space-y-8">
            <section>
              <div className="mb-4 flex items-center gap-2">
                <Info className="h-5 w-5 text-muted-foreground" />
                <h2 className="font-semibold text-foreground text-xl">Build Information</h2>
              </div>
              <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                <MetricCard
                  title="Build Time"
                  value={data.buildInfo.buildTime}
                  description="When the app was built"
                  icon={<Info className="h-4 w-4" />}
                />
                <MetricCard
                  title="Git Commit"
                  value={data.buildInfo.gitCommit}
                  description="Source code version"
                  icon={<Info className="h-4 w-4" />}
                />
                <MetricCard
                  title="Environment"
                  value={data.buildInfo.environment}
                  description="Deployment environment"
                  icon={<Globe className="h-4 w-4" />}
                />
              </div>
            </section>

            <ConfigComparison
              clientRuntimeConfig={clientRuntimeConfig}
              serverSideClientConfig={data.serverSideClientConfig}
            />

            <section>
              <div className="mb-4 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Server className="h-5 w-5 text-muted-foreground" />
                  <h2 className="font-semibold text-foreground text-xl">Server Configuration</h2>
                  <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-destructive text-xs">
                    Private (Sensitive values masked)
                  </span>
                </div>
                <p className="text-muted-foreground text-sm">
                  Server-only environment variables.
                </p>
              </div>
              <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
                <div className="space-y-3">
                  {Object.entries(data.serverConfig)
                    .sort(([keyA], [keyB]) => keyA.localeCompare(keyB))
                    .map(([key, value]) => (
                      <div key={key} className="flex flex-col gap-1 border-border border-b pb-3 last:border-b-0">
                        <div className="font-medium text-foreground text-sm">{key}</div>
                        <div className="break-all font-mono text-muted-foreground text-xs">{value}</div>
                      </div>
                    ))}
                </div>
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function ConfigComparison({
  clientRuntimeConfig,
  serverSideClientConfig,
}: {
  clientRuntimeConfig: Record<string, string> | null
  serverSideClientConfig: Record<string, string>
}) {
  if (!clientRuntimeConfig) return null

  const allKeys = new Set([
    ...Object.keys(clientRuntimeConfig),
    ...Object.keys(serverSideClientConfig),
  ])
  const sortedKeys = Array.from(allKeys).sort()

  return (
    <section>
      <div className="mb-4 flex items-center gap-2">
        <Globe className="h-5 w-5 text-muted-foreground" />
        <h2 className="font-semibold text-foreground text-xl">
          Client/Server Config Comparison
        </h2>
        <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-blue-600 text-xs">
          VITE_ Variables
        </span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Globe className="h-4 w-4 text-blue-600" />
            <h3 className="font-semibold text-foreground text-sm">Client Config (Browser)</h3>
          </div>
          <div className="space-y-3">
            {sortedKeys.map((key) => {
              const clientValue = clientRuntimeConfig[key] || 'Not set'
              const serverValue = serverSideClientConfig[key] || 'Not set'
              const matches = clientValue === serverValue
              return (
                <div
                  key={key}
                  className={`flex flex-col gap-1 border-border border-b pb-3 last:border-b-0 ${matches ? '' : 'bg-yellow-500/5'}`}
                >
                  <div className="flex items-center gap-2">
                    {matches ? (
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-yellow-600" />
                    )}
                    <div className="font-medium text-foreground text-sm">{key}</div>
                  </div>
                  <div className="break-all pl-6 font-mono text-muted-foreground text-xs">
                    {clientValue}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card p-6 shadow-sm">
          <div className="mb-4 flex items-center gap-2">
            <Server className="h-4 w-4 text-purple-600" />
            <h3 className="font-semibold text-foreground text-sm">Server Config (Worker)</h3>
          </div>
          <div className="space-y-3">
            {sortedKeys.map((key) => {
              const clientValue = clientRuntimeConfig[key] || 'Not set'
              const serverValue = serverSideClientConfig[key] || 'Not set'
              const matches = clientValue === serverValue
              return (
                <div
                  key={key}
                  className={`flex flex-col gap-1 border-border border-b pb-3 last:border-b-0 ${matches ? '' : 'bg-yellow-500/5'}`}
                >
                  <div className="flex items-center gap-2">
                    {matches ? (
                      <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
                    ) : (
                      <AlertTriangle className="h-4 w-4 flex-shrink-0 text-yellow-600" />
                    )}
                    <div className="font-medium text-foreground text-sm">{key}</div>
                  </div>
                  <div className="break-all pl-6 font-mono text-muted-foreground text-xs">
                    {serverValue}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </section>
  )
}
