package jsonb

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
)

// scanJSON is a generic helper for scanning JSON from database.
func scanJSON[T any](src interface{}, dest *T) error {
	if src == nil {
		return nil
	}
	switch v := src.(type) {
	case []byte:
		return json.Unmarshal(v, dest)
	case string:
		return json.Unmarshal([]byte(v), dest)
	}
	return fmt.Errorf("cannot scan %T into %T", src, dest)
}

// valueJSON is a generic helper for converting to driver value.
func valueJSON(v interface{}) (driver.Value, error) {
	return json.Marshal(v)
}

// Scan implements sql.Scanner for TaskQueuePayload.
func (t *TaskQueuePayload) Scan(src interface{}) error {
	return scanJSON(src, t)
}

// Value implements driver.Valuer for TaskQueuePayload.
func (t TaskQueuePayload) Value() (driver.Value, error) {
	return valueJSON(t)
}

// Scan implements sql.Scanner for ValidationErrors.
func (v *ValidationErrors) Scan(src interface{}) error {
	return scanJSON(src, v)
}

// Value implements driver.Valuer for ValidationErrors.
func (v ValidationErrors) Value() (driver.Value, error) {
	return valueJSON(v)
}

// Scan implements sql.Scanner for CronJobPayload.
func (c *CronJobPayload) Scan(src interface{}) error {
	if src == nil {
		return nil
	}

	// First unmarshal into the struct
	if err := scanJSON(src, c); err != nil {
		return err
	}

	// Then capture extra fields
	var raw map[string]interface{}
	switch v := src.(type) {
	case []byte:
		if err := json.Unmarshal(v, &raw); err != nil {
			return err
		}
	case string:
		if err := json.Unmarshal([]byte(v), &raw); err != nil {
			return err
		}
	}

	// Remove known fields and store extras
	delete(raw, "chainSlug")
	delete(raw, "taskType")
	if len(raw) > 0 {
		c.Extra = raw
	}

	return nil
}

// Value implements driver.Valuer for CronJobPayload.
func (c CronJobPayload) Value() (driver.Value, error) {
	// Merge extra fields back
	result := make(map[string]interface{})
	for k, v := range c.Extra {
		result[k] = v
	}
	if c.ChainSlug != nil {
		result["chainSlug"] = *c.ChainSlug
	}
	if c.TaskType != nil {
		result["taskType"] = *c.TaskType
	}
	return json.Marshal(result)
}

// Scan implements sql.Scanner for CronRunMetadata.
func (c *CronRunMetadata) Scan(src interface{}) error {
	if src == nil {
		return nil
	}

	// First unmarshal into the struct
	if err := scanJSON(src, c); err != nil {
		return err
	}

	// Then capture extra fields
	var raw map[string]interface{}
	switch v := src.(type) {
	case []byte:
		if err := json.Unmarshal(v, &raw); err != nil {
			return err
		}
	case string:
		if err := json.Unmarshal([]byte(v), &raw); err != nil {
			return err
		}
	}

	// Remove known fields and store extras
	delete(raw, "startedAt")
	delete(raw, "completedAt")
	delete(raw, "error")
	if len(raw) > 0 {
		c.Extra = raw
	}

	return nil
}

// Value implements driver.Valuer for CronRunMetadata.
func (c CronRunMetadata) Value() (driver.Value, error) {
	// Merge extra fields back
	result := make(map[string]interface{})
	for k, v := range c.Extra {
		result[k] = v
	}
	if c.StartedAt != nil {
		result["startedAt"] = *c.StartedAt
	}
	if c.CompletedAt != nil {
		result["completedAt"] = *c.CompletedAt
	}
	if c.Error != nil {
		result["error"] = *c.Error
	}
	return json.Marshal(result)
}

// Scan implements sql.Scanner for ArchiveMetadata.
func (a *ArchiveMetadata) Scan(src interface{}) error {
	if src == nil {
		return nil
	}

	// First unmarshal into the struct
	if err := scanJSON(src, a); err != nil {
		return err
	}

	// Then capture extra fields
	var raw map[string]interface{}
	switch v := src.(type) {
	case []byte:
		if err := json.Unmarshal(v, &raw); err != nil {
			return err
		}
	case string:
		if err := json.Unmarshal([]byte(v), &raw); err != nil {
			return err
		}
	}

	// Remove known fields and store extras
	delete(raw, "originalFilename")
	delete(raw, "encoding")
	delete(raw, "extractedFiles")
	if len(raw) > 0 {
		a.Extra = raw
	}

	return nil
}

// Value implements driver.Valuer for ArchiveMetadata.
func (a ArchiveMetadata) Value() (driver.Value, error) {
	// Merge extra fields back
	result := make(map[string]interface{})
	for k, v := range a.Extra {
		result[k] = v
	}
	if a.OriginalFilename != nil {
		result["originalFilename"] = *a.OriginalFilename
	}
	if a.Encoding != nil {
		result["encoding"] = *a.Encoding
	}
	if a.ExtractedFiles != nil {
		result["extractedFiles"] = a.ExtractedFiles
	}
	return json.Marshal(result)
}
