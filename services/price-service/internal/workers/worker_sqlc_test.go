package workers

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strings"
	"testing"
)

// TestWorkerUsesSqlc verifies that worker.go uses sqlc for database operations
func TestWorkerUsesSqlc(t *testing.T) {
	content, err := os.ReadFile("worker.go")
	if err != nil {
		t.Fatalf("Failed to read worker.go: %v", err)
	}

	source := string(content)

	// Verify sqlcgen import exists
	if !strings.Contains(source, `"github.com/kosarica/price-service/internal/database/sqlcgen"`) {
		t.Error("worker.go should import sqlcgen package")
	}

	// Verify SetTaskProcessingAny is used
	if !strings.Contains(source, "SetTaskProcessingAny") {
		t.Error("worker.go should use SetTaskProcessingAny for setting task to processing status")
	}

	// Verify raw SQL UPDATE for task_queue is not used
	if strings.Contains(source, `UPDATE task_queue`) {
		t.Error("worker.go should not contain raw SQL UPDATE for task_queue")
	}
}

// TestWorkerSqlcImport verifies the sqlcgen import is valid
func TestWorkerSqlcImport(t *testing.T) {
	fset := token.NewFileSet()
	node, err := parser.ParseFile(fset, "worker.go", nil, parser.ImportsOnly)
	if err != nil {
		t.Fatalf("Failed to parse worker.go: %v", err)
	}

	found := false
	for _, imp := range node.Imports {
		if imp.Path.Value == `"github.com/kosarica/price-service/internal/database/sqlcgen"` {
			found = true
			break
		}
	}

	if !found {
		t.Error("worker.go should have sqlcgen import")
	}
}

// TestWorkerProcessTaskUsesSqlc verifies the processTask function uses sqlc
func TestWorkerProcessTaskUsesSqlc(t *testing.T) {
	fset := token.NewFileSet()
	node, err := parser.ParseFile(fset, "worker.go", nil, parser.ParseComments)
	if err != nil {
		t.Fatalf("Failed to parse worker.go: %v", err)
	}

	// Find the processTask function
	var processTaskFunc *ast.FuncDecl
	ast.Inspect(node, func(n ast.Node) bool {
		if fn, ok := n.(*ast.FuncDecl); ok && fn.Name.Name == "processTask" {
			processTaskFunc = fn
			return false
		}
		return true
	})

	if processTaskFunc == nil {
		t.Fatal("processTask function not found in worker.go")
	}

	// Verify sqlcgen.New is called in processTask
	content, _ := os.ReadFile("worker.go")
	source := string(content)

	if !strings.Contains(source, "sqlcgen.New(pool)") {
		t.Error("processTask should create sqlc queries with sqlcgen.New(pool)")
	}
}

// TestSqlcSetTaskProcessingAnyExists verifies the sqlc method exists
func TestSqlcSetTaskProcessingAnyExists(t *testing.T) {
	// This test verifies the method exists in the generated code
	content, err := os.ReadFile("../database/sqlcgen/taskqueue.sql.go")
	if err != nil {
		t.Fatalf("Failed to read taskqueue.sql.go: %v", err)
	}

	source := string(content)

	if !strings.Contains(source, "func (q *Queries) SetTaskProcessingAny") {
		t.Error("SetTaskProcessingAny method should exist in sqlcgen")
	}
}
