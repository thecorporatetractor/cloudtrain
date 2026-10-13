package compile

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"

	yaml3 "sigs.k8s.io/yaml/goyaml.v3"
)

// yamlToJSON converts a single YAML document to JSON using YAML 1.2 scalar
// resolution. This matters: the lab schema uses `on:` as a key, which YAML 1.1
// parsers (goyaml.v2, and therefore sigs.k8s.io/yaml.YAMLToJSON) turn into the
// boolean true. Duplicate keys are rejected.
func yamlToJSON(data []byte) ([]byte, error) {
	dec := yaml3.NewDecoder(bytes.NewReader(data))
	var root yaml3.Node
	if err := dec.Decode(&root); err != nil {
		if errors.Is(err, io.EOF) {
			return []byte("null"), nil
		}
		return nil, err
	}
	if err := checkIntRange(&root); err != nil {
		return nil, err
	}
	var doc any
	if err := root.Decode(&doc); err != nil {
		return nil, err
	}
	var extra yaml3.Node
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

var intLiteralRe = regexp.MustCompile(`^[-+]?(0x[0-9a-fA-F_]+|0o[0-7_]+|0b[01_]+|[0-9_]+)$`)

// checkIntRange rejects integers that do not fit in 64 bits: the YAML decoder
// would silently turn them into rounded floats.
func checkIntRange(n *yaml3.Node) error {
	if n.Kind == yaml3.ScalarNode && (n.ShortTag() == "!!int" || n.ShortTag() == "!!float") && intLiteralRe.MatchString(n.Value) {
		var v any
		if err := n.Decode(&v); err != nil {
			return err
		}
		if _, isFloat := v.(float64); isFloat {
			return fmt.Errorf("line %d: integer %s is out of range", n.Line, n.Value)
		}
	}
	for _, c := range n.Content {
		if err := checkIntRange(c); err != nil {
			return err
		}
	}
	return nil
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
