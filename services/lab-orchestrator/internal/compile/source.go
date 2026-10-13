package compile

import (
	"bytes"
	"encoding/json"
)

// Source types mirror lab.schema.json one-to-one for decoding. They are
// converted into api/v1alpha1 types (with defaults applied) by Compile.

type sourceLab struct {
	APIVersion string         `json:"apiVersion"`
	Kind       string         `json:"kind"`
	Metadata   sourceMetadata `json:"metadata"`
	Spec       sourceSpec     `json:"spec"`
}

type sourceMetadata struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	Domain           string   `json:"domain"`
	Frameworks       []string `json:"frameworks"`
	Difficulty       string   `json:"difficulty"`
	EstimatedMinutes int32    `json:"estimatedMinutes"`
	Tags             []string `json:"tags"`
	Version          *int32   `json:"version"`
}

type sourceSpec struct {
	Description    string                 `json:"description"`
	Objectives     []string               `json:"objectives"`
	Params         map[string]sourceParam `json:"params"`
	Topology       sourceTopology         `json:"topology"`
	Setup          []sourceAction         `json:"setup"`
	Teardown       []sourceAction         `json:"teardown"`
	Checks         []sourceCheck          `json:"checks"`
	Hints          []sourceHint           `json:"hints"`
	Misconceptions []sourceMisconception  `json:"misconceptions"`
	Solution       sourceSolution         `json:"solution"`
}

type sourceParam struct {
	Type    string `json:"type"`
	Values  []any  `json:"values"`
	Min     *int64 `json:"min"`
	Max     *int64 `json:"max"`
	Prefix  string `json:"prefix"`
	Default any    `json:"default"`
}

// UnmarshalJSON decodes numbers in values/default as json.Number (exact), and
// tolerates extra keys such as description: the shared schema allows them on
// params, so the decoder must not be stricter than the schema.
func (p *sourceParam) UnmarshalJSON(b []byte) error {
	type plain sourceParam
	dec := json.NewDecoder(bytes.NewReader(b))
	dec.UseNumber()
	var v plain
	if err := dec.Decode(&v); err != nil {
		return err
	}
	*p = sourceParam(v)
	return nil
}

type sourceTopology struct {
	Entry string       `json:"entry"`
	Nodes []sourceNode `json:"nodes"`
	Links []sourceLink `json:"links"`
}

type sourceNode struct {
	Name      string           `json:"name"`
	Driver    string           `json:"driver"`
	Image     string           `json:"image"`
	Resources *sourceResources `json:"resources"`
	Access    []string         `json:"access"`
	Cluster   *sourceCluster   `json:"cluster"`
}

type sourceResources struct {
	CPU       *float64 `json:"cpu"`
	MemoryMiB *int64   `json:"memoryMiB"`
	Disks     []string `json:"disks"`
}

type sourceCluster struct {
	Mode    string              `json:"mode"`
	Version string              `json:"version"`
	Context string              `json:"context"`
	Nodes   []sourceClusterNode `json:"nodes"`
}

type sourceClusterNode struct {
	Name   string            `json:"name"`
	Role   string            `json:"role"`
	Taints []string          `json:"taints"`
	Labels map[string]string `json:"labels"`
	State  string            `json:"state"`
}

type sourceLink struct {
	A      string        `json:"a"`
	B      string        `json:"b"`
	Subnet string        `json:"subnet"`
	Impair *sourceImpair `json:"impair"`
}

type sourceImpair struct {
	LatencyMs *int32   `json:"latencyMs"`
	LossPct   *float64 `json:"lossPct"`
	MTU       *int32   `json:"mtu"`
}

type sourceAction struct {
	On         string      `json:"on"`
	As         string      `json:"as"`
	Run        *string     `json:"run"`
	Apply      *string     `json:"apply"`
	File       *sourceFile `json:"file"`
	Config     *string     `json:"config"`
	TimeoutSec *int32      `json:"timeoutSec"`
}

type sourceFile struct {
	Path    string `json:"path"`
	Content string `json:"content"`
	Source  string `json:"source"`
	Mode    string `json:"mode"`
}

type sourceCheck struct {
	ID          string        `json:"id"`
	Description string        `json:"description"`
	Skills      []string      `json:"skills"`
	Weight      *float64      `json:"weight"`
	Type        string        `json:"type"`
	On          string        `json:"on"`
	Command     string        `json:"command"`
	Query       *sourceQuery  `json:"query"`
	Target      string        `json:"target"`
	Port        *int32        `json:"port"`
	Expect      *sourceExpect `json:"expect"`
	TimeoutSec  *int32        `json:"timeoutSec"`
}

type sourceQuery struct {
	Cluster   string `json:"cluster"`
	Resource  string `json:"resource"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	JSONPath  string `json:"jsonpath"`
	Verb      string `json:"verb"`
	As        string `json:"as"`
}

type sourceExpect struct {
	Match string `json:"match"`
	Value string `json:"value"`
}

type sourceHint struct {
	Title   string `json:"title"`
	Body    string `json:"body"`
	Command string `json:"command"`
	Cost    *int32 `json:"cost"`
}

type sourceMisconception struct {
	ID          string        `json:"id"`
	Description string        `json:"description"`
	Mutation    *sourceAction `json:"mutation"`
	ExpectFail  []string      `json:"expectFail"`
	Feedback    string        `json:"feedback"`
}

type sourceSolution struct {
	Explanation  string              `json:"explanation"`
	Steps        []sourceAction      `json:"steps"`
	Alternatives []sourceAlternative `json:"alternatives"`
}

type sourceAlternative struct {
	ID          string         `json:"id"`
	Description string         `json:"description"`
	Steps       []sourceAction `json:"steps"`
}
