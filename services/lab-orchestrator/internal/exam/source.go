// Package exam compiles exam simulations from content/curriculum.yaml into
// ExamTemplates, draws an attempt's tasks, builds the attempt's environment
// (one LabTemplate per environment, resolved per task) and scores the
// grading passes into a score report.
//
// Everything here is pure (no cluster access) so labctl, the controller and
// the tests share it.
package exam

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/labschema"
)

// Definition mirrors one entry of `exams` in content/curriculum.yaml
// (packages/lab-schema/schema/curriculum.schema.json#/$defs/exam).
type Definition struct {
	ID              string      `json:"id"`
	Title           string      `json:"title"`
	Domain          string      `json:"domain"`
	AlignsTo        []string    `json:"alignsTo"`
	Disclaimer      string      `json:"disclaimer"`
	Format          string      `json:"format"`
	SimulationNote  string      `json:"simulationNote,omitempty"`
	Description     string      `json:"description,omitempty"`
	DurationMinutes int32       `json:"durationMinutes"`
	PassMark        json.Number `json:"passMark"`
	PassMarkNote    string      `json:"passMarkNote,omitempty"`
	TaskCount       int32       `json:"taskCount"`
	EnvTier         string      `json:"envTier"`
	Environment     string      `json:"environment"`
	Blueprint       []Objective `json:"blueprint"`
	Rules           Rules       `json:"rules"`
	RetakePolicy    Retake      `json:"retakePolicy"`
	ScoreReport     ScoreConfig `json:"scoreReport"`
	Status          string      `json:"status"`
	Owner           string      `json:"owner"`
	Notes           string      `json:"notes,omitempty"`
}

// Objective is one blueprint line.
type Objective struct {
	Objective string      `json:"objective"`
	Weight    json.Number `json:"weight"`
	Tasks     int32       `json:"tasks"`
	Pool      []string    `json:"pool"`
}

// Rules of an exam.
type Rules struct {
	Hints             bool   `json:"hints"`
	Timer             string `json:"timer"`
	AnyOrder          bool   `json:"anyOrder"`
	FlagForReview     bool   `json:"flagForReview"`
	RebootBeforeGrade bool   `json:"rebootBeforeGrade"`
	IdempotencyRerun  bool   `json:"idempotencyRerun"`
	DocsAllowed       string `json:"docsAllowed,omitempty"`
	PartialCredit     string `json:"partialCredit,omitempty"`
	Notes             string `json:"notes,omitempty"`
}

// Retake policy of an exam.
type Retake struct {
	FreeRetakes          *int32 `json:"freeRetakes,omitempty"`
	CooldownHours        *int32 `json:"cooldownHours,omitempty"`
	MaxAttemptsPer30Days *int32 `json:"maxAttemptsPer30Days,omitempty"`
	FreshDraw            bool   `json:"freshDraw"`
	Notes                string `json:"notes,omitempty"`
}

// ScoreConfig is the score report configuration.
type ScoreConfig struct {
	Breakdown           []string `json:"breakdown"`
	ShowsExpectedValues bool     `json:"showsExpectedValues"`
	Includes            []string `json:"includes,omitempty"`
}

// LoadFile reads every exam of a curriculum file (or any YAML document with
// an `exams` list) and validates each against the curriculum exam schema.
// YAML anchors and aliases (used for shared rules) are resolved.
func LoadFile(path string) ([]Definition, []byte, error) {
	b, err := os.ReadFile(filepath.Clean(path))
	if err != nil {
		return nil, nil, err
	}
	defs, err := Parse(b)
	if err != nil {
		return nil, nil, fmt.Errorf("%s: %w", path, err)
	}
	return defs, b, nil
}

// Parse decodes and validates the `exams` list of a YAML document.
func Parse(data []byte) ([]Definition, error) {
	// YAML 1.2: the curriculum's envTier `N` must stay a string.
	js, err := compile.YAMLToJSON(data)
	if err != nil {
		return nil, fmt.Errorf("parse yaml: %w", err)
	}
	var doc struct {
		Exams []json.RawMessage `json:"exams"`
	}
	if err := json.Unmarshal(js, &doc); err != nil {
		return nil, fmt.Errorf("decode: %w", err)
	}
	if len(doc.Exams) == 0 {
		return nil, errors.New("no exams in document")
	}
	schema, err := labschema.ExamSchema()
	if err != nil {
		return nil, err
	}
	var out []Definition
	var errs []error
	for i, raw := range doc.Exams {
		inst, err := jsonschema.UnmarshalJSON(bytes.NewReader(raw))
		if err != nil {
			errs = append(errs, fmt.Errorf("exams[%d]: %w", i, err))
			continue
		}
		var d Definition
		dec := json.NewDecoder(bytes.NewReader(raw))
		dec.UseNumber()
		dec.DisallowUnknownFields()
		decErr := dec.Decode(&d)
		if err := schema.Validate(inst); err != nil {
			errs = append(errs, fmt.Errorf("exams[%d] %s: %v", i, d.ID, err))
			continue
		}
		if decErr != nil {
			errs = append(errs, fmt.Errorf("exams[%d] %s: %w", i, d.ID, decErr))
			continue
		}
		out = append(out, d)
	}
	return out, errors.Join(errs...)
}

// Find returns the exam with id.
func Find(defs []Definition, id string) (*Definition, error) {
	for i := range defs {
		if defs[i].ID == id {
			return &defs[i], nil
		}
	}
	ids := make([]string, 0, len(defs))
	for _, d := range defs {
		ids = append(ids, d.ID)
	}
	return nil, fmt.Errorf("exam %q not found (known: %v)", id, ids)
}
