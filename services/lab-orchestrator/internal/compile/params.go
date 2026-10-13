package compile

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"sort"
	"strconv"
	"strings"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// ResolveOptions tune param resolution.
type ResolveOptions struct {
	// UseDefaults resolves params that declare a default to that default
	// instead of a seeded random value (useful for authoring and previews).
	UseDefaults bool
}

// ResolveParams derives a value for every param from seed.
//
// Each param draws from its own stream keyed by (seed, param name), so the
// value of one param does not change when others are added or removed, and
// the derivation is stable across Go versions and platforms (SHA-256 based).
func ResolveParams(params map[string]labsv1.ParamSpec, seed int64, opts ResolveOptions) (map[string]string, error) {
	names := make([]string, 0, len(params))
	for n := range params {
		names = append(names, n)
	}
	sort.Strings(names)
	out := make(map[string]string, len(params))
	for _, name := range names {
		p := params[name]
		if opts.UseDefaults && p.Default != nil {
			out[name] = *p.Default
			continue
		}
		st := &stream{seed: seed, name: name}
		switch p.Type {
		case labsv1.ParamChoice:
			if len(p.Values) == 0 {
				return nil, fmt.Errorf("param %s: no values", name)
			}
			out[name] = p.Values[st.intn(uint64(len(p.Values)))]
		case labsv1.ParamInt:
			if p.Min == nil || p.Max == nil || *p.Min > *p.Max {
				return nil, fmt.Errorf("param %s: invalid min/max", name)
			}
			span := uint64(*p.Max-*p.Min) + 1
			out[name] = strconv.FormatInt(*p.Min+int64(st.intn(span)), 10)
		case labsv1.ParamName:
			out[name] = st.randomName(p.Prefix)
		default:
			return nil, fmt.Errorf("param %s: unknown type %q", name, p.Type)
		}
	}
	return out, nil
}

// Resolve returns a copy of spec with every {{param}} replaced by its value
// derived from seed, plus the resolved values.
func Resolve(spec *labsv1.LabTemplateSpec, seed int64, opts ResolveOptions) (*labsv1.LabTemplateSpec, map[string]string, error) {
	values, err := ResolveParams(spec.Params, seed, opts)
	if err != nil {
		return nil, nil, err
	}
	resolved, err := Substitute(spec, values)
	if err != nil {
		return nil, nil, err
	}
	return resolved, values, nil
}

// Substitute replaces {{name}} placeholders using values. Unknown names are
// an error.
func Substitute(spec *labsv1.LabTemplateSpec, values map[string]string) (*labsv1.LabTemplateSpec, error) {
	var missing []string
	out, err := walkStrings(spec, func(path, v string) string {
		return placeholderRe.ReplaceAllStringFunc(v, func(m string) string {
			name := placeholderRe.FindStringSubmatch(m)[1]
			val, ok := values[name]
			if !ok {
				missing = append(missing, path+": {{"+name+"}}")
				return m
			}
			return val
		})
	})
	if err != nil {
		return nil, err
	}
	if len(missing) > 0 {
		return nil, fmt.Errorf("unresolved params: %s", strings.Join(missing, ", "))
	}
	out.Source = spec.Source
	out.Params = spec.Params
	return out, nil
}

// stream is a deterministic PRNG keyed by (seed, name).
type stream struct {
	seed    int64
	name    string
	counter uint64
}

func (s *stream) next() uint64 {
	h := sha256.Sum256([]byte(fmt.Sprintf("cloudtrain/params/v1|%d|%s|%d", s.seed, s.name, s.counter)))
	s.counter++
	return binary.BigEndian.Uint64(h[:8])
}

// intn returns a uniform value in [0, n) using rejection sampling.
func (s *stream) intn(n uint64) uint64 {
	if n == 0 {
		return 0
	}
	limit := ^uint64(0) - (^uint64(0) % n)
	for {
		if v := s.next(); v < limit {
			return v % n
		}
	}
}

const (
	nameLetters = "abcdefghijklmnopqrstuvwxyz"
	nameAlnum   = "abcdefghijklmnopqrstuvwxyz0123456789"
)

// randomName produces a DNS-label-safe random name: "<prefix>-xxxxx" or, without a
// prefix, a 6-character name starting with a letter.
func (s *stream) randomName(prefix string) string {
	var b strings.Builder
	if prefix != "" {
		b.WriteString(prefix)
		b.WriteByte('-')
	} else {
		b.WriteByte(nameLetters[s.intn(uint64(len(nameLetters)))])
	}
	for b.Len() < len(prefix)+6 {
		b.WriteByte(nameAlnum[s.intn(uint64(len(nameAlnum)))])
	}
	return b.String()
}
