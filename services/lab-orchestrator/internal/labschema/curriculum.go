package labschema

import (
	"bytes"
	_ "embed"
	"fmt"
	"sync"

	"github.com/santhosh-tekuri/jsonschema/v6"
)

// CurriculumSchemaURL is the $id of the curriculum schema.
const CurriculumSchemaURL = "https://cloudtrain.dev/schema/curriculum/v1"

//go:embed curriculum.schema.json
var embeddedCurriculum []byte

var (
	examOnce   sync.Once
	examSchema *jsonschema.Schema
	examErr    error
)

// ExamSchema returns the compiled `$defs/exam` subschema of the embedded
// curriculum schema: the shape of one entry of `exams` in
// content/curriculum.yaml. Exams are validated one by one, so a test exam
// file only needs an `exams` list.
func ExamSchema() (*jsonschema.Schema, error) {
	examOnce.Do(func() {
		doc, err := jsonschema.UnmarshalJSON(bytes.NewReader(embeddedCurriculum))
		if err != nil {
			examErr = fmt.Errorf("parse curriculum schema: %w", err)
			return
		}
		c := jsonschema.NewCompiler()
		if err := c.AddResource(CurriculumSchemaURL, doc); err != nil {
			examErr = fmt.Errorf("add curriculum schema: %w", err)
			return
		}
		examSchema, examErr = c.Compile(CurriculumSchemaURL + "#/$defs/exam")
	})
	return examSchema, examErr
}
