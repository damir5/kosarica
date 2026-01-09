import { FileText, Clock, CheckCircle, XCircle, Loader2, ChevronRight } from 'lucide-react'
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
import { RerunButton } from './RerunButton'

export interface IngestionFile {
  id: string
  runId: string
  filename: string
  fileType: string
  fileSize: number | null
  fileHash: string | null
  status: string // 'pending' | 'processing' | 'completed' | 'failed'
  entryCount: number | null
  processedAt: Date | null
  metadata: string | null
  totalChunks: number | null
  processedChunks: number | null
  chunkSize: number | null
  createdAt: Date | null
}

interface IngestionFileListProps {
  files: IngestionFile[]
  runId: string
  isLoading: boolean
  onRerunFile?: (fileId: string) => void
  isRerunning?: boolean
  rerunningFileId?: string | null
}

type FileStatus = 'pending' | 'processing' | 'completed' | 'failed'

const STATUS_ICONS: Record<FileStatus, typeof Clock> = {
  pending: Clock,
  processing: Loader2,
  completed: CheckCircle,
  failed: XCircle,
}

const STATUS_COLORS: Record<FileStatus, 'secondary' | 'default' | 'destructive'> = {
  pending: 'secondary',
  processing: 'default',
  completed: 'default',
  failed: 'destructive',
}

const FILE_TYPE_COLORS: Record<string, string> = {
  csv: 'bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300',
  xml: 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300',
  xlsx: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300',
  zip: 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300',
  json: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300',
}

export function IngestionFileList({
  files,
  runId,
  isLoading,
  onRerunFile,
  isRerunning,
  rerunningFileId
}: IngestionFileListProps) {
  const formatFileSize = (bytes: number | null) => {
    if (bytes === null || bytes === undefined) return '-'
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
  }

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

  if (isLoading) {
    return (
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Filename</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Size</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Chunks</TableHead>
              <TableHead>Entries</TableHead>
              <TableHead>Processed</TableHead>
              <TableHead className="w-[100px]">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {[...Array(5)].map((_, i) => (
              <TableRow key={i}>
                <TableCell colSpan={8}>
                  <div className="h-8 bg-muted animate-pulse rounded" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )
  }

  if (files.length === 0) {
    return (
      <div className="rounded-md border py-12 text-center">
        <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No files found for this run</p>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Filename</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Chunks</TableHead>
            <TableHead>Entries</TableHead>
            <TableHead>Processed</TableHead>
            <TableHead className="w-[100px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {files.map((file) => {
            const status = file.status as FileStatus
            const StatusIcon = STATUS_ICONS[status] || Clock
            const totalChunks = file.totalChunks ?? 0
            const processedChunks = file.processedChunks ?? 0
            const chunkProgress = totalChunks > 0 ? Math.round((processedChunks / totalChunks) * 100) : 0

            return (
              <TableRow key={file.id}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <a
                        href={`/admin/ingestion/${runId}/${file.id}`}
                        className="font-medium hover:underline truncate max-w-[200px] block"
                        title={file.filename}
                      >
                        {file.filename}
                      </a>
                      <span className="text-xs text-muted-foreground font-mono">{file.id}</span>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${FILE_TYPE_COLORS[file.fileType.toLowerCase()] || 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'}`}>
                    {file.fileType.toUpperCase()}
                  </span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {formatFileSize(file.fileSize)}
                  </span>
                </TableCell>
                <TableCell>
                  <Badge
                    variant={STATUS_COLORS[status] || 'secondary'}
                    className={status === 'processing' ? 'animate-pulse' : ''}
                  >
                    <StatusIcon className={`mr-1 h-3 w-3 ${status === 'processing' ? 'animate-spin' : ''}`} />
                    {status}
                  </Badge>
                </TableCell>
                <TableCell>
                  {totalChunks > 0 ? (
                    <div className="w-20">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1">
                        <span>{processedChunks}/{totalChunks}</span>
                      </div>
                      <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                        <div
                          className={`h-full transition-all duration-300 ${
                            status === 'failed' ? 'bg-destructive' :
                            status === 'completed' ? 'bg-green-500' : 'bg-primary'
                          }`}
                          style={{ width: `${chunkProgress}%` }}
                        />
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="font-medium">{(file.entryCount ?? 0).toLocaleString()}</span>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">
                    {formatTimeAgo(file.processedAt)}
                  </span>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1">
                    {onRerunFile && (status === 'completed' || status === 'failed') && (
                      <RerunButton
                        onRerun={() => onRerunFile(file.id)}
                        isLoading={isRerunning && rerunningFileId === file.id}
                        size="sm"
                      />
                    )}
                    <Button variant="ghost" size="icon" asChild>
                      <a href={`/admin/ingestion/${runId}/${file.id}`}>
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
