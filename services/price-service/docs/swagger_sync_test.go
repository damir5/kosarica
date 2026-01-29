package docs

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func TestSwaggerJSONMatchesGenerated(t *testing.T) {
	root, err := findServiceRoot()
	if err != nil {
		t.Fatal(err)
	}

	outputDir := t.TempDir()
	cmd := exec.Command(
		"go",
		"run",
		"github.com/swaggo/swag/cmd/swag@v1.16.4",
		"init",
		"-g",
		"cmd/server/main.go",
		"-o",
		outputDir,
		"--outputTypes",
		"json",
	)
	cmd.Dir = root
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("swag init failed: %v\n%s", err, string(out))
	}

	generatedPath := filepath.Join(outputDir, "swagger.json")
	checkedInPath := filepath.Join(root, "docs", "swagger.json")

	generated, err := readCanonicalJSON(generatedPath)
	if err != nil {
		t.Fatalf("failed to read generated swagger.json: %v", err)
	}

	checkedIn, err := readCanonicalJSON(checkedInPath)
	if err != nil {
		t.Fatalf("failed to read checked-in swagger.json: %v", err)
	}

	if !bytes.Equal(generated, checkedIn) {
		t.Fatalf("docs/swagger.json is out of sync with swag output; run `mise run swag`")
	}
}

func readCanonicalJSON(path string) ([]byte, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var payload interface{}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, err
	}
	return json.Marshal(payload)
}

func findServiceRoot() (string, error) {
	cwd, err := os.Getwd()
	if err != nil {
		return "", err
	}

	dir := cwd
	for i := 0; i < 8; i++ {
		if fileExists(filepath.Join(dir, "go.mod")) && fileExists(filepath.Join(dir, "cmd", "server", "main.go")) {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return "", fmt.Errorf("price-service root not found from %s", cwd)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
