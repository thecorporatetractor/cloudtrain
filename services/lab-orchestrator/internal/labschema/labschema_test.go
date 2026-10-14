package labschema

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultCompiles(t *testing.T) {
	if _, err := Default(); err != nil {
		t.Fatal(err)
	}
}

func TestEmbeddedSchemaInSync(t *testing.T) {
	canonical := filepath.Join("..", "..", "..", "..", "packages", "lab-schema", "schema", "lab.schema.json")
	b, err := os.ReadFile(canonical)
	if os.IsNotExist(err) {
		t.Skipf("canonical schema not found at %s (module built outside monorepo)", canonical)
	}
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(b, embedded) {
		t.Fatalf("embedded schema differs from %s; run `make generate`", canonical)
	}
}

func TestExamSchemaCompiles(t *testing.T) {
	if _, err := ExamSchema(); err != nil {
		t.Fatal(err)
	}
}

func TestEmbeddedCurriculumSchemaInSync(t *testing.T) {
	canonical := filepath.Join("..", "..", "..", "..", "packages", "lab-schema", "schema", "curriculum.schema.json")
	b, err := os.ReadFile(canonical)
	if os.IsNotExist(err) {
		t.Skipf("canonical schema not found at %s (module built outside monorepo)", canonical)
	}
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(b, embeddedCurriculum) {
		t.Fatalf("embedded curriculum schema differs from %s; run `make generate`", canonical)
	}
}
