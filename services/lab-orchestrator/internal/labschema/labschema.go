// Package labschema embeds and compiles the CloudTrain v3 lab JSON schema.
//
// The canonical schema lives in packages/lab-schema/schema/lab.schema.json at
// the monorepo root. Go's embed cannot reach outside the module, so `make
// generate` copies it here; TestEmbeddedSchemaInSync fails when the copy drifts.
package labschema

import (
	"bytes"
	_ "embed"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// SchemaURL is the $id of the v3 lab schema.
const SchemaURL = "https://cloudtrain.dev/schema/lab/v3"

//go:embed lab.schema.json
var embedded []byte

// Embedded returns the raw embedded schema document.
func Embedded() []byte { return bytes.Clone(embedded) }

var (
	defaultOnce   sync.Once
	defaultSchema *jsonschema.Schema
	defaultErr    error
)

// Default returns the compiled embedded schema (compiled once).
func Default() (*jsonschema.Schema, error) {
	defaultOnce.Do(func() { defaultSchema, defaultErr = Compile(embedded) })
	return defaultSchema, defaultErr
}

// FromFile compiles a schema from a path on disk (e.g. a newer checkout of
// packages/lab-schema), bypassing the embedded copy.
func FromFile(path string) (*jsonschema.Schema, error) {
	b, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return nil, err
	}
	return Compile(b)
}

// Compile compiles a raw schema document. No network access is performed:
// only the bundled 2020-12 meta-schema is used.
func Compile(raw []byte) (*jsonschema.Schema, error) {
	doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
	if err != nil {
		return nil, fmt.Errorf("parse lab schema: %w", err)
	}
	c := jsonschema.NewCompiler()
	if err := c.AddResource(SchemaURL, doc); err != nil {
		return nil, fmt.Errorf("add lab schema: %w", err)
	}
	s, err := c.Compile(SchemaURL)
	if err != nil {
		return nil, fmt.Errorf("compile lab schema: %w", err)
	}
	return s, nil
}
