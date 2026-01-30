// Package jsonb provides typed JSONB types for database operations.
// These types are designed to match the Zod schemas in src/db/jsonb-schemas.ts
package jsonb

// TaskQueuePayload represents a discriminated union of task payloads.
// The Type field determines which fields are valid.
type TaskQueuePayload struct {
	Type string `json:"type"`

	// Ingestion task fields
	ChainSlug string  `json:"chainSlug,omitempty"`
	SourceURL *string `json:"sourceUrl,omitempty"`
	ArchiveID *string `json:"archiveId,omitempty"`

	// Rerun task fields
	OriginalRunID *string `json:"originalRunId,omitempty"`
	RerunType     *string `json:"rerunType,omitempty"` // "file" | "chunk" | "entry"
	TargetID      *string `json:"targetId,omitempty"`

	// Cleanup task fields
	DaysToKeep *int `json:"daysToKeep,omitempty"`
}

// IsIngestion returns true if this is an ingestion task payload.
func (p TaskQueuePayload) IsIngestion() bool {
	return p.Type == "ingestion"
}

// IsRerun returns true if this is a rerun task payload.
func (p TaskQueuePayload) IsRerun() bool {
	return p.Type == "rerun"
}

// IsCleanup returns true if this is a cleanup task payload.
func (p TaskQueuePayload) IsCleanup() bool {
	return p.Type == "cleanup"
}

// ValidationError represents a single validation error.
type ValidationError struct {
	Field   *string     `json:"field,omitempty"`
	Message string      `json:"message"`
	Code    *string     `json:"code,omitempty"`
	Value   interface{} `json:"value,omitempty"`
}

// ValidationErrors is a slice of validation errors.
type ValidationErrors []ValidationError

// CronJobPayload represents the payload for a cron job.
// This is a loose object that allows additional properties.
type CronJobPayload struct {
	ChainSlug *string `json:"chainSlug,omitempty"`
	TaskType  *string `json:"taskType,omitempty"`

	// Extra allows additional properties
	Extra map[string]interface{} `json:"-"`
}

// CronRunMetadata represents metadata for a cron run.
// This is a loose object that allows additional properties.
type CronRunMetadata struct {
	StartedAt   *string `json:"startedAt,omitempty"`
	CompletedAt *string `json:"completedAt,omitempty"`
	Error       *string `json:"error,omitempty"`

	// Extra allows additional properties
	Extra map[string]interface{} `json:"-"`
}

// ArchiveMetadata represents metadata for an archive.
// This is a loose object that allows additional properties.
type ArchiveMetadata struct {
	OriginalFilename *string  `json:"originalFilename,omitempty"`
	Encoding         *string  `json:"encoding,omitempty"`
	ExtractedFiles   []string `json:"extractedFiles,omitempty"`

	// Extra allows additional properties
	Extra map[string]interface{} `json:"-"`
}
