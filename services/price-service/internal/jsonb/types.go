// Package jsonb provides typed JSONB types for database operations.
// These types are designed to match the Zod schemas in src/db/jsonb-schemas.ts
package jsonb

import "encoding/json"

// TaskQueuePayload represents a discriminated union of task payloads.
// The Type field determines which fields are valid.
type TaskQueuePayload struct {
	Type string `json:"type"`

	// Common ingestion task fields
	ChainSlug  string  `json:"chainSlug,omitempty"`
	RunID      *string `json:"runId,omitempty"`
	TargetDate *string `json:"targetDate,omitempty"`
	SourceURL  *string `json:"sourceUrl,omitempty"`
	ArchiveID  *string `json:"archiveId,omitempty"`

	// Fetch_parse task fields
	FileURL    *string `json:"fileUrl,omitempty"`
	Filename   *string `json:"filename,omitempty"`
	FileType   *string `json:"fileType,omitempty"`
	FileIndex  *int    `json:"fileIndex,omitempty"`
	TotalFiles *int    `json:"totalFiles,omitempty"`

	// Rerun task fields
	OriginalRunID *string `json:"originalRunId,omitempty"`
	RerunType     *string `json:"rerunType,omitempty"` // "file" | "chunk" | "entry"
	TargetID      *string `json:"targetId,omitempty"`

	// Cleanup task fields
	DaysToKeep *int `json:"daysToKeep,omitempty"`

	// Extra allows additional properties
	Extra map[string]interface{} `json:"-"`
}

// IsRerun returns true if this is a rerun task payload.
func (p TaskQueuePayload) IsRerun() bool {
	return p.Type == "rerun"
}

// IsCleanup returns true if this is a cleanup task payload.
func (p TaskQueuePayload) IsCleanup() bool {
	return p.Type == "cleanup"
}

// UnmarshalJSON captures extra fields on TaskQueuePayload.
func (p *TaskQueuePayload) UnmarshalJSON(data []byte) error {
	type payloadAlias TaskQueuePayload
	var alias payloadAlias
	if err := json.Unmarshal(data, &alias); err != nil {
		return err
	}

	*p = TaskQueuePayload(alias)

	var raw map[string]interface{}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	for _, key := range []string{
		"type",
		"chainSlug",
		"runId",
		"targetDate",
		"sourceUrl",
		"archiveId",
		"fileUrl",
		"filename",
		"fileType",
		"fileIndex",
		"totalFiles",
		"originalRunId",
		"rerunType",
		"targetId",
		"daysToKeep",
	} {
		delete(raw, key)
	}

	if len(raw) > 0 {
		p.Extra = raw
	}

	return nil
}

// MarshalJSON merges extra fields back into the payload.
func (p TaskQueuePayload) MarshalJSON() ([]byte, error) {
	result := make(map[string]interface{})
	for key, value := range p.Extra {
		result[key] = value
	}

	if p.Type != "" {
		result["type"] = p.Type
	}
	if p.ChainSlug != "" {
		result["chainSlug"] = p.ChainSlug
	}
	if p.RunID != nil {
		result["runId"] = *p.RunID
	}
	if p.TargetDate != nil {
		result["targetDate"] = *p.TargetDate
	}
	if p.SourceURL != nil {
		result["sourceUrl"] = *p.SourceURL
	}
	if p.ArchiveID != nil {
		result["archiveId"] = *p.ArchiveID
	}
	if p.FileURL != nil {
		result["fileUrl"] = *p.FileURL
	}
	if p.Filename != nil {
		result["filename"] = *p.Filename
	}
	if p.FileType != nil {
		result["fileType"] = *p.FileType
	}
	if p.FileIndex != nil {
		result["fileIndex"] = *p.FileIndex
	}
	if p.TotalFiles != nil {
		result["totalFiles"] = *p.TotalFiles
	}
	if p.OriginalRunID != nil {
		result["originalRunId"] = *p.OriginalRunID
	}
	if p.RerunType != nil {
		result["rerunType"] = *p.RerunType
	}
	if p.TargetID != nil {
		result["targetId"] = *p.TargetID
	}
	if p.DaysToKeep != nil {
		result["daysToKeep"] = *p.DaysToKeep
	}

	return json.Marshal(result)
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
	ContentType      *string  `json:"contentType,omitempty"`
	FileType         *string  `json:"fileType,omitempty"` // csv, xml, json, xlsx, zip

	// Extra allows additional properties
	Extra map[string]interface{} `json:"-"`
}

// ============================================================================
// Ingestion Task Payloads (Parent-Child Architecture)
// ============================================================================

// DiscoverPayload is the payload for ingestion_discover tasks.
// Discovery tasks create runs and spawn fetch_parse subtasks.
type DiscoverPayload struct {
	Type       string `json:"type"` // "ingestion_discover"
	ChainSlug  string `json:"chainSlug"`
	TargetDate string `json:"targetDate"`
	RunID      string `json:"runId,omitempty"`
	IsForced   bool   `json:"isForced,omitempty"`
}

// IsDiscover returns true if this is a discover task payload.
func (p DiscoverPayload) IsDiscover() bool {
	return p.Type == "ingestion_discover"
}

// FetchParsePayload is the payload for ingestion_fetch_parse tasks.
// Fetch+parse tasks download files, parse them, and write to intermediate storage.
type FetchParsePayload struct {
	Type        string `json:"type"` // "ingestion_fetch_parse"
	ChainSlug   string `json:"chainSlug"`
	RunID       string `json:"runId"`
	FileURL     string `json:"fileUrl"`
	Filename    string `json:"filename"`
	FileType    string `json:"fileType"` // "csv" or "zip"
	FileIndex   int    `json:"fileIndex,omitempty"`
	TotalFiles  int    `json:"totalFiles,omitempty"`
}

// IsFetchParse returns true if this is a fetch+parse task payload.
func (p FetchParsePayload) IsFetchParse() bool {
	return p.Type == "ingestion_fetch_parse"
}

// ClusterPayload is the payload for ingestion_cluster tasks.
// Cluster tasks read all parsed data, compute price tiers, and write to DB.
type ClusterPayload struct {
	Type      string `json:"type"` // "ingestion_cluster"
	ChainSlug string `json:"chainSlug"`
	RunID     string `json:"runId"`
}

// IsCluster returns true if this is a cluster task payload.
func (p ClusterPayload) IsCluster() bool {
	return p.Type == "ingestion_cluster"
}

// FinalizePayload is the payload for ingestion_finalize tasks.
// Finalize tasks update run status, trigger cache refresh, and cleanup.
type FinalizePayload struct {
	Type      string `json:"type"` // "ingestion_finalize"
	ChainSlug string `json:"chainSlug"`
	RunID     string `json:"runId"`
}

// IsFinalize returns true if this is a finalize task payload.
func (p FinalizePayload) IsFinalize() bool {
	return p.Type == "ingestion_finalize"
}
