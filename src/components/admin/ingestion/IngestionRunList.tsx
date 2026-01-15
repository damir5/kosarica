import { Clock, CheckCircle, XCircle, Loader2, ChevronRight, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import type { IngestionRun } from './IngestionRunCard'

interface IngestionRunListProps {
  runs: IngestionRun[]
  isLoading: boolean
  onDelete?: (runId: string) => void
  deletingRunId?: string
}

type RunStatus = 'pending' | 'running' | 'completed' | 'failed'

const STATUS_ICONS: Record<RunStatus, typeof Clock> = {
  pending: Clock,
  running: Loader2,
  completed: CheckCircle,
  failed: XCircle,
}

const STATUS_COLORS: Record<RunStatus, 'secondary' | 'default' | 'destructive'> = {
  pending: 'secondary',
  running: 'default',
  completed: 'default',
  failed: 'destructive',
}

const SOURCE_LABELS: Record<string, string> = {
  cli: 'CLI',
  worker: 'Worker',
  scheduled: 'Scheduled',
}

export function IngestionRunList({ runs, isLoading, onDelete, deletingRunId }: IngestionRunListProps) {
  const formatTimeAgo = (date: Date | null) => {
    if (!date) return 'Never'
    const now = new Date()
    const diff = now.getTime() - new Date(date).getTime()
    const minutes = Math.floor(diff / (1000 * 60))
    const hours = Math.floor(minutes / 60)
    const days = Math.floor(hours / 24)
    if (days > 0) return `${days}d ago`
    if (hours > 0) return `${hours}h ago`
    if (minutes > 0) return `${minutes}m ago`
    return 'Just now'
  }

  const formatDuration = (start: Date | null, end: Date | null) => {
    if (!start) return '-'
    const startTime = new Date(start).getTime()
    const endTime = end ? new Date(end).getTime() : Date.now()
    const duration = endTime - startTime
    const seconds = Math.floor(duration / 1000)
    const minutes = Math.floor(seconds / 60)
    const hours = Math.floor(minutes / 60)
    if (hours > 0) return `${hours}h ${minutes % 60}m`
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`
    return `${seconds}s`
  }

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Chain</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Progress</TableHead>
              <TableHead>Errors</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead>Started</TableHead>
              <TableHead className="w-[50px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={7}>
                  <div className="h-8 bg-muted animate-pulse rounded" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (runs.length === 0) {
    return (
      <div className="rounded-md border py-12 text-center">
        <p className="text-muted-foreground">No ingestion runs found</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Chain</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Progress</TableHead>
            <TableHead>Errors</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>Started</TableHead>
            <TableHead className="w-[50px]"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {runs.map((run) => {
            const status = run.status as RunStatus
            const StatusIcon = STATUS_ICONS[status] || Clock
            const totalFiles = run.totalFiles ?? 0
            const processedFiles = run.processedFiles ?? 0
            const progress = totalFiles > 0 ? Math.round((processedFiles / totalFiles) * 100) : 0

            return (
              <TableRow key={run.id}>
                <TableCell>
                  <div>
                    <a
                      href={`/admin/ingestion/${run.id}`}
                      className="font-medium hover:underline"
                    >
                      {run.chainSlug}
                    </a>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="outline" className="text-xs">
                        {SOURCE_LABELS[run.source] || run.source}
                      </Badge>
                      {run.parentRunId && (
                        <span className="text-xs text-muted-foreground">(rerun)</span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={STATUS_COLORS[status] || 'secondary'}
                    className={status === 'running' ? 'animate-pulse' : ''}
                  >
                    <StatusIcon className={`mr-1 h-3 w-3 ${status === 'running' ? 'animate-spin' : ''}`} />
                    {status}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="w-32">
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{processedFiles}/{totalFiles}</span>
                      <span>{progress}%</span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          status === 'failed' ? 'bg-destructive' :
                          status === 'completed' ? 'bg-green-500' : 'bg-primary'
                        }`}
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className={`font-medium ${(run.errorCount ?? 0) > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                    {run.errorCount ?? 0}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {formatDuration(run.startedAt, run.completedAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {formatTimeAgo(run.createdAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {onDelete && (
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => {
                          if (window.confirm(`Delete run ${run.id}? This will also delete all associated files, chunks, and errors.`)) {
                            onDelete(run.id)
                          }
                        }}
                        disabled={deletingRunId === run.id}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        {deletingRunId === run.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </Button>
                    )}
                    <Button variant="ghost" size="icon" asChild>
                      <a href={`/admin/ingestion/${run.id}`}>
                        <ChevronRight className="h-4 w-4" />
                      </a>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}
