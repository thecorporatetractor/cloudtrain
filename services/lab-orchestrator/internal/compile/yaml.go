package compile

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	yaml3 "sigs.k8s.io/yaml/goyaml.v3"
)

// yamlToJSON converts a single YAML document to JSON using YAML 1.2 scalar
// resolution. This matters: the lab schema uses `on:` as a key, which YAML 1.1
// parsers (goyaml.v2, and therefore sigs.k8s.io/yaml.YAMLToJSON) turn into the
// boolean true. Duplicate keys are rejected.
func yamlToJSON(data []byte) ([]byte, error) {
	dec := yaml3.NewDecoder(bytes.NewReader(data))
	var doc any
	if err := dec.Decode(&doc); err != nil {
		if errors.Is(err, io.EOF) {
			return []byte("null"), nil
		}
		return nil, err
	}
	var extra any
	if err := dec.Decode(&extra); !errors.Is(err, io.EOF) {
		if err != nil {
			return nil, err
		}
		return nil, fmt.Errorf("expected a single YAML document")
	}
	norm, err := normalize(doc)
	if err != nil {
		return nil, err
	}
	return json.Marshal(norm)
}

// normalize turns map[any]any (non-string keys) into map[string]any.
func normalize(v any) (any, error) {
	switch x := v.(type) {
	case map[string]any:
		for k, e := range x {
			n, err := normalize(e)
			if err != nil {
				return nil, err
			}
			x[k] = n
		}
		return x, nil
	case map[any]any:
		out := make(map[string]any, len(x))
		for k, e := range x {
			n, err := normalize(e)
			if err != nil {
				return nil, err
			}
			out[fmt.Sprint(k)] = n
		}
		return out, nil
	case []any:
		for i, e := range x {
			n, err := normalize(e)
			if err != nil {
				return nil, err
			}
			x[i] = n
		}
		return x, nil
	default:
		return v, nil
	}
}
