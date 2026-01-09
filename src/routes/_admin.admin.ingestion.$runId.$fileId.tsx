import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import {
  ArrowLeft,
  FileText,
  ChevronLeft,
  ChevronRight,
  Clock,
  CheckCircle,
  XCircle,
  Loader2,
  AlertTriangle,
  Package,
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
import { IngestionChunkList, RerunButton } from '@/components/admin/ingestion'

// @ts-expect-error - Route will be auto-generated
export const Route = createFileRoute('/_admin/admin/ingestion/$runId/$fileId')({
  component: FileDetailPage,
})

type ChunkStatus = 'pending' | 'processing' | 'completed' | 'failed'

const STATUS_ICONS = {
  pending: Clock,
  processing: Loader2,
  completed: CheckCircle,
  failed: XCircle,
}

const STATUS_COLORS = {
  pending: 'secondary',
  processing: 'default',
  completed: 'default',
  failed: 'destructive',
} as const

const FILE_TYPE_COLORS: Record<string, string> = {
  csv: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  xml: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  xlsx: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  zip: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  json: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
}

function FileDetailPage() {
  const { runId, fileId } = Route.useParams() as { runId: string; fileId: string }
  const queryClient = useQueryClient()

  // Filter state
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [page, setPage] = useState(1)
  const pageSize = 20

  // File query
  const { data: file, isLoading: fileLoading, error: fileError } = useQuery(
    orpc.admin.ingestion.getFile.queryOptions({
      input: { fileId },
    }),
  )

  // Chunks query
  const { data: chunksData, isLoading: chunksLoading } = useQuery(
    orpc.admin.ingestion.listChunks.queryOptions({
      input: {
        fileId,
        status: statusFilter !== 'all' ? (statusFilter as ChunkStatus) : undefined,
        page,
        pageSize,
      },
    }),
  )

  // Errors query
  const { data: errorsData } = useQuery(
    orpc.admin.ingestion.listErrors.queryOptions({
      input: {
        fileId,
        page: 1,
        pageSize: 10,
      },
    }),
  )

  // Rerun mutations
  const rerunFileMutation = useMutation({
    mutationFn: async () => {
      return orpc.admin.ingestion.rerunFile.call({ fileId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion'] })
    },
  })

  const [rerunningChunkId, setRerunningChunkId] = useState<string | null>(null)

  const rerunChunkMutation = useMutation({
    mutationFn: async (chunkId: string) => {
      setRerunningChunkId(chunkId)
      return orpc.admin.ingestion.rerunChunk.call({ chunkId })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'ingestion'] })
      setRerunningChunkId(null)
    },
    onError: () => {
      setRerunningChunkId(null)
    },
  })

  const formatDate = (date: Date | null) => {
    if (!date) return 'N/A'
    return new Date(date).toLocaleString()
  }

  const formatFileSize = (bytes: number | null) => {
    if (bytes === null || bytes === undefined) return 'Unknown'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

  if (fileLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center justify-center py-12">
            <p className="text-muted-foreground">Loading file details...</p>
          </div>
        </div>
      </div>
    )
  }

  if (fileError || !file) {
    return (
      <div className="min-h-screen bg-background">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">
              Error: {fileError?.message || 'File not found'}
            </p>
          </div>
          <Button variant="outline" className="mt-4" asChild>
            <a href={`/admin/ingestion/${runId}`}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Run
            </a>
          </Button>
        </div>
      </div>
    )
  }

  const StatusIcon = STATUS_ICONS[file.status as keyof typeof STATUS_ICONS] || Clock
  const totalChunks = file.totalChunks ?? 0
  const processedChunks = file.processedChunks ?? 0
  const chunkProgress = totalChunks > 0 ? Math.round((processedChunks / totalChunks) * 100) : 0

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-border border-b bg-card">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" asChild>
              <a href={`/admin/ingestion/${runId}`}>
                <ArrowLeft className="h-5 w-5" />
              </a>
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <FileText className="h-8 w-8 text-primary" />
                <div>
                  <h1 className="font-semibold text-2xl text-foreground truncate max-w-[500px]" title={file.filename}>
                    {file.filename}
                  </h1>
                  <p className="mt-1 text-muted-foreground text-sm font-mono">{file.id}</p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-1 rounded text-xs font-medium ${FILE_TYPE_COLORS[file.fileType.toLowerCase()] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                {file.fileType.toUpperCase()}
              </span>
              <Badge
                variant={STATUS_COLORS[file.status as keyof typeof STATUS_COLORS] || 'secondary'}
                className={file.status === 'processing' ? 'animate-pulse' : ''}
              >
                <StatusIcon className={`mr-1 h-3 w-3 ${file.status === 'processing' ? 'animate-spin' : ''}`} />
                {file.status}
              </Badge>
              {(file.status === 'completed' || file.status === 'failed') && (
                <RerunButton
                  onRerun={() => rerunFileMutation.mutate()}
                  isLoading={rerunFileMutation.isPending}
                  label="Rerun File"
                />
              )}
            </div>
          </div>
          {/* Breadcrumb */}
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <a href="/admin/ingestion" className="hover:text-foreground">
              Ingestion
            </a>
            <span>/</span>
            <a href={`/admin/ingestion/${runId}`} className="hover:text-foreground font-mono">
              {runId.slice(0, 12)}...
            </a>
            <span>/</span>
            <span className="text-foreground">{file.filename}</span>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {/* File Overview */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Chunk Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{chunkProgress}%</div>
              <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    file.status === 'failed' ? 'bg-destructive' :
                    file.status === 'completed' ? 'bg-green-500' : 'bg-primary'
                  }`}
                  style={{ width: `${chunkProgress}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {processedChunks} of {totalChunks} chunks
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Entries</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {(file.entryCount ?? 0).toLocaleString()}
              </div>
              <p className="text-xs text-muted-foreground">
                rows in this file
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">File Size</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {formatFileSize(file.fileSize)}
              </div>
              <p className="text-xs text-muted-foreground font-mono">
                {file.fileHash ? file.fileHash.slice(0, 16) + '...' : 'No hash'}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium">Chunk Size</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {file.chunkSize ? file.chunkSize.toLocaleString() : 'N/A'}
              </div>
              <p className="text-xs text-muted-foreground">
                rows per chunk
              </p>
            </CardContent>
          </Card>
        </div>

        {/* File Details */}
        <Card>
          <CardHeader>
            <CardTitle>File Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div>
                <label className="text-sm font-medium text-muted-foreground">Filename</label>
                <p className="mt-1 font-medium truncate" title={file.filename}>{file.filename}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">File Type</label>
                <p className="mt-1 font-medium uppercase">{file.fileType}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Created At</label>
                <p className="mt-1">{formatDate(file.createdAt)}</p>
              </div>
              <div>
                <label className="text-sm font-medium text-muted-foreground">Processed At</label>
                <p className="mt-1">{formatDate(file.processedAt)}</p>
              </div>
              {file.fileHash && (
                <div className="sm:col-span-2">
                  <label className="text-sm font-medium text-muted-foreground">File Hash</label>
                  <p className="mt-1 font-mono text-sm break-all">{file.fileHash}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Errors */}
        {errorsData && errorsData.errors.length > 0 && (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <AlertTriangle className="h-5 w-5" />
                File Errors
              </CardTitle>
              <CardDescription>
                Errors encountered while processing this file
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {errorsData.errors.map((error) => (
                  <div
                    key={error.id}
                    className="p-3 rounded-lg border bg-destructive/5 border-destructive/20"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-xs">
                            {error.errorType}
                          </Badge>
                          <Badge
                            variant={error.severity === 'critical' ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {error.severity}
                          </Badge>
                          {error.chunkId && (
                            <span className="text-xs text-muted-foreground font-mono">
                              Chunk: {error.chunkId.slice(0, 12)}...
                            </span>
                          )}
                        </div>
                        <p className="mt-1 text-sm">{error.errorMessage}</p>
                      </div>
                      <span className="text-xs text-muted-foreground">
                        {error.createdAt ? new Date(error.createdAt).toLocaleTimeString() : ''}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Chunks List */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Package className="h-5 w-5" />
                  Chunks
                </CardTitle>
                <CardDescription>
                  Data chunks processed from this file
                </CardDescription>
              </div>
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
                  <SelectItem value="processing">Processing</SelectItem>
                  <SelectItem value="completed">Completed</SelectItem>
                  <SelectItem value="failed">Failed</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <IngestionChunkList
              chunks={chunksData?.chunks ?? []}
              isLoading={chunksLoading}
              onRerunChunk={(chunkId) => rerunChunkMutation.mutate(chunkId)}
              isRerunning={rerunChunkMutation.isPending}
              rerunningChunkId={rerunningChunkId}
            />

            {/* Pagination */}
            {chunksData && chunksData.totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Showing {(page - 1) * pageSize + 1} to{' '}
                  {Math.min(page * pageSize, chunksData.total)} of {chunksData.total} chunks
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
                    Page {page} of {chunksData.totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => p + 1)}
                    disabled={page >= chunksData.totalPages}
                  >
                    Next
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
