import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  Database,
  Activity,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Play,
} from 'lucide-react'
import { orpc } from '@/orpc/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  IngestionStatsCards,
  IngestionRunList,
  ErrorCategoryView,
} from '@/components/admin/ingestion'

export const Route = createFileRoute('/_admin/admin/ingestion' as any)({
  component: IngestionDashboard,
})

type TimeRange = '24h' | '7d' | '30d'
type RunStatus = 'pending' | 'running' | 'completed' | 'failed'

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

function IngestionDashboard() {
  const queryClient = useQueryClient()

  // Filter state
  const [timeRange, setTimeRange] = useState<TimeRange>('24h')
  const [chainFilter, setChainFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const pageSize = 20

  // Stats query
  const { data: stats, isLoading: statsLoading } = useQuery(
    orpc.admin.ingestion.getStats.queryOptions({
      input: { timeRange },
    }),
  )

  // Runs query
  const { data: runsData, isLoading: runsLoading } = useQuery(
    orpc.admin.ingestion.listRuns.queryOptions({
      input: {
        chainSlug: chainFilter !== 'all' ? chainFilter : undefined,
        status: statusFilter !== 'all' ? (statusFilter as RunStatus) : undefined,
        page,
        pageSize,
      },
    }),
  )

  // Trigger chain mutation
  const triggerMutation = useMutation({
    mutationFn: async (chainSlug: string) => {
      return orpc.admin.ingestion.triggerChain.call({ chainSlug })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion'] })
    },
  })

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion'] })
  }

  return (
    <>
      {/* Header */}
      <div className="border-border border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8 text-primary" />
              <div>
                <h1 className="font-semibold text-2xl text-foreground">Ingestion Dashboard</h1>
                <p className="mt-1 text-muted-foreground text-sm">
                  Monitor data ingestion runs, files, and errors
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={timeRange}
                onValueChange={(value) => setTimeRange(value as TimeRange)}
              >
                <SelectTrigger className="w-[120px]">
                  <SelectValue placeholder="Time Range" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="24h">Last 24h</SelectItem>
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="icon" onClick={handleRefresh}>
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-8">
        {/* Stats Cards */}
        <IngestionStatsCards stats={stats} isLoading={statsLoading} />

        {/* Error Categories */}
        {stats && stats.errors.total > 0 && (
          <ErrorCategoryView errors={stats.errors} isLoading={statsLoading} />
        )}

        {/* Run List Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Activity className="h-5 w-5" />
                  Ingestion Runs
                </CardTitle>
                <CardDescription>
                  Recent ingestion runs with status and progress
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Select
                  value={chainFilter}
                  onValueChange={(value) => {
                    setChainFilter(value)
                    setPage(1)
                  }}
                >
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
                <Select
                  value={statusFilter}
                  onValueChange={(value) => {
                    setStatusFilter(value)
                    setPage(1)
                  }}
                >
                  <SelectTrigger className="w-[130px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="running">Running</SelectItem>
                    <SelectItem value="completed">Completed</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <IngestionRunList
              runs={runsData?.runs ?? []}
              isLoading={runsLoading}
            />

            {/* Pagination */}
            {runsData && runsData.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1} to{' '}
                  {Math.min(page * pageSize, runsData.total)} of {runsData.total} runs
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
                    Page {page} of {runsData.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= runsData.totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quick Trigger Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Play className="h-5 w-5" />
              Trigger Ingestion
            </CardTitle>
            <CardDescription>
              Manually trigger an ingestion run for a specific chain
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {CHAINS.map((chain) => (
                <Button
                  key={chain.slug}
                  variant="outline"
                  size="sm"
                  onClick={() => triggerMutation.mutate(chain.slug)}
                  disabled={triggerMutation.isPending}
                >
                  {chain.name}
                  {triggerMutation.isPending && triggerMutation.variables === chain.slug && (
                    <RefreshCw className="ml-2 h-3 w-3 animate-spin" />
                  )}
                </Button>
              ))}
            </div>
            {triggerMutation.isSuccess && (
              <div className="mt-3 p-3 rounded-md bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm">
                Successfully triggered ingestion. Run ID:{' '}
                <Badge variant="outline" className="font-mono ml-1">
                  {triggerMutation.data?.runId}
                </Badge>
              </div>
            )}
            {triggerMutation.isError && (
              <div className="mt-3 p-3 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
                Failed to trigger ingestion: {triggerMutation.error?.message}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}
