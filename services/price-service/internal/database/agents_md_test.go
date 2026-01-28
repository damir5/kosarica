package database

import (
	"os"
	"strings"
	"testing"
)

// TestAgentsMdSqlcDocumentation verifies that AGENTS.md contains the required
// sqlc-only documentation sections as specified in Phase 5 Task 1.
func TestAgentsMdSqlcDocumentation(t *testing.T) {
	// Read AGENTS.md
	content, err := os.ReadFile("../../AGENTS.md")
	if err != nil {
		t.Fatalf("Failed to read AGENTS.md: %v", err)
	}
	agentsMd := string(content)

	t.Run("has database access rules section", func(t *testing.T) {
		if !strings.Contains(agentsMd, "## Database Access Rules") {
			t.Error("AGENTS.md must contain '## Database Access Rules' section")
		}
	})

	t.Run("has required sqlc rule", func(t *testing.T) {
		if !strings.Contains(agentsMd, "### REQUIRED: Use sqlc for ALL queries") {
			t.Error("AGENTS.md must contain '### REQUIRED: Use sqlc for ALL queries' section")
		}
	})

	t.Run("shows correct sqlc usage example", func(t *testing.T) {
		if !strings.Contains(agentsMd, "queries.CreateStore(ctx, sqlcgen.CreateStoreParams") {
			t.Error("AGENTS.md must show correct sqlc usage example with CreateStore")
		}
	})

	t.Run("shows forbidden raw SQL example", func(t *testing.T) {
		if !strings.Contains(agentsMd, "// FORBIDDEN") {
			t.Error("AGENTS.md must mark raw SQL as FORBIDDEN")
		}
		if !strings.Contains(agentsMd, "pool.Exec(ctx,") {
			t.Error("AGENTS.md must show forbidden pool.Exec example")
		}
	})

	t.Run("has adding new queries section", func(t *testing.T) {
		if !strings.Contains(agentsMd, "### Adding New Queries") {
			t.Error("AGENTS.md must contain '### Adding New Queries' section")
		}
	})

	t.Run("documents query file location", func(t *testing.T) {
		if !strings.Contains(agentsMd, "internal/database/queries/*.sql") {
			t.Error("AGENTS.md must document query file location")
		}
	})

	t.Run("documents sqlc generate command", func(t *testing.T) {
		if !strings.Contains(agentsMd, "mise run sqlc-generate") {
			t.Error("AGENTS.md must document 'mise run sqlc-generate' command")
		}
	})

	t.Run("documents generated code location", func(t *testing.T) {
		if !strings.Contains(agentsMd, "internal/database/sqlcgen/") {
			t.Error("AGENTS.md must document sqlcgen output location")
		}
	})

	t.Run("has why section explaining benefits", func(t *testing.T) {
		if !strings.Contains(agentsMd, "### Why?") {
			t.Error("AGENTS.md must contain '### Why?' section")
		}
	})

	t.Run("explains compile-time validation benefit", func(t *testing.T) {
		if !strings.Contains(agentsMd, "compile time") {
			t.Error("AGENTS.md must explain compile-time validation benefit")
		}
	})

	t.Run("explains runtime error problem", func(t *testing.T) {
		if !strings.Contains(agentsMd, "runtime") {
			t.Error("AGENTS.md must explain runtime error problem with raw SQL")
		}
	})

	t.Run("has exceptions section for stored procedures", func(t *testing.T) {
		if !strings.Contains(agentsMd, "### Exceptions") {
			t.Error("AGENTS.md must contain '### Exceptions' section for stored procedures")
		}
	})

	t.Run("documents stored procedure exceptions", func(t *testing.T) {
		storedProcs := []string{
			"claim_tasks()",
			"complete_task()",
			"fail_task()",
			"cleanup_old_tasks()",
			"recover_orphaned_tasks()",
		}
		for _, proc := range storedProcs {
			if !strings.Contains(agentsMd, proc) {
				t.Errorf("AGENTS.md must document %s as an exception", proc)
			}
		}
	})
}
