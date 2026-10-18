// Command labctl compiles and validates CloudTrain v3 labs.
//
//	labctl compile [--seed N] [--defaults] [--namespace NS] [--schema FILE] <lab.yaml>
//	labctl validate [--schema FILE] <dir>...
//	labctl verify [--context C] [--parallel N] [--only ID] [--keep] <lab dir|lab.yaml>...
//	labctl exam compile|draw|run [flags] <exam-id>
//	labctl catalog check|publishable|overlay [flags]
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"sort"

	"github.com/santhosh-tekuri/jsonschema/v6"
	"sigs.k8s.io/yaml"

	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/compile"
	"github.com/cloudtrain/cloudtrain/services/lab-orchestrator/internal/labschema"
)

const usage = `labctl - CloudTrain lab compiler

Usage:
  labctl compile [flags] <lab.yaml>   print the compiled LabTemplate as YAML
  labctl validate [flags] <dir>...    validate every lab.yaml under the directories
  labctl verify [flags] <lab>...      run the verifier cycle on a live cluster (see docs/k8s-readiness.md)
  labctl exam compile|draw|run ...    exam simulations (see 'labctl exam help')
  labctl catalog check|publishable|overlay ...  image catalog release tooling (see 'labctl catalog help')

Run 'labctl <command> -h' for command flags.
`

func main() {
	os.Exit(run(os.Args[1:], os.Stdout, os.Stderr))
}

func run(args []string, stdout, stderr io.Writer) int {
	if len(args) == 0 {
		fmt.Fprint(stderr, usage)
		return 2
	}
	switch args[0] {
	case "compile":
		return cmdCompile(args[1:], stdout, stderr)
	case "validate":
		return cmdValidate(args[1:], stdout, stderr)
	case "verify":
		return cmdVerify(args[1:], stdout, stderr)
	case "exam":
		return cmdExam(args[1:], stdout, stderr)
	case "catalog":
		return cmdCatalog(args[1:], stdout, stderr)
	case "-h", "--help", "help":
		fmt.Fprint(stdout, usage)
		return 0
	default:
		fmt.Fprintf(stderr, "unknown command %q\n\n%s", args[0], usage)
		return 2
	}
}

func loadSchema(path string) (*jsonschema.Schema, error) {
	if path == "" {
		return nil, nil // compile uses the embedded schema
	}
	return labschema.FromFile(path)
}

func cmdCompile(args []string, stdout, stderr io.Writer) int {
	fl := flag.NewFlagSet("compile", flag.ContinueOnError)
	fl.SetOutput(stderr)
	seed := fl.Int64("seed", 0, "resolve {{params}} with this seed and print the resolved spec")
	resolve := fl.Bool("resolve", false, "resolve {{params}} (implied by --seed)")
	defaults := fl.Bool("defaults", false, "when resolving, use param defaults where declared")
	namespace := fl.String("namespace", "", "namespace for the LabTemplate")
	schemaPath := fl.String("schema", "", "lab schema JSON file (default: embedded copy)")
	if err := fl.Parse(args); err != nil {
		return 2
	}
	if fl.NArg() != 1 {
		fmt.Fprintln(stderr, "usage: labctl compile [flags] <lab.yaml>")
		return 2
	}
	fl.Visit(func(f *flag.Flag) {
		if f.Name == "seed" {
			*resolve = true
		}
	})
	schema, err := loadSchema(*schemaPath)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	lt, err := compile.CompileFile(fl.Arg(0), compile.Options{Schema: schema, Namespace: *namespace})
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	if *resolve {
		spec, values, err := compile.Resolve(&lt.Spec, *seed, compile.ResolveOptions{UseDefaults: *defaults})
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
		lt.Spec = *spec
		if lt.Annotations == nil {
			lt.Annotations = map[string]string{}
		}
		lt.Annotations["labs.cloudtrain.dev/resolved-seed"] = fmt.Sprint(*seed)
		keys := make([]string, 0, len(values))
		for k := range values {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		for _, k := range keys {
			lt.Annotations["labs.cloudtrain.dev/param."+k] = values[k]
		}
	}
	out, err := yaml.Marshal(lt)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	_, _ = stdout.Write(out)
	return 0
}

func cmdValidate(args []string, stdout, stderr io.Writer) int {
	fl := flag.NewFlagSet("validate", flag.ContinueOnError)
	fl.SetOutput(stderr)
	schemaPath := fl.String("schema", "", "lab schema JSON file (default: embedded copy)")
	if err := fl.Parse(args); err != nil {
		return 2
	}
	if fl.NArg() == 0 {
		fmt.Fprintln(stderr, "usage: labctl validate [flags] <dir>...")
		return 2
	}
	schema, err := loadSchema(*schemaPath)
	if err != nil {
		fmt.Fprintln(stderr, err)
		return 1
	}
	var files []string
	for _, root := range fl.Args() {
		err := filepath.WalkDir(root, func(p string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() && (d.Name() == "lab.yaml" || d.Name() == "lab.yml") {
				files = append(files, p)
			}
			return nil
		})
		if err != nil {
			fmt.Fprintln(stderr, err)
			return 1
		}
	}
	if len(files) == 0 {
		fmt.Fprintln(stderr, "no lab.yaml files found")
		return 1
	}
	failed := 0
	for _, f := range files {
		data, err := os.ReadFile(f)
		if err == nil {
			err = compile.Validate(data, compile.Options{Schema: schema, BaseDir: filepath.Dir(f)})
		}
		if err != nil {
			failed++
			var ve *compile.ValidationError
			if errors.As(err, &ve) {
				fmt.Fprintf(stdout, "FAIL %s\n", f)
				for _, is := range ve.Issues {
					fmt.Fprintf(stdout, "     %s\n", is)
				}
			} else {
				fmt.Fprintf(stdout, "FAIL %s: %v\n", f, err)
			}
			continue
		}
		fmt.Fprintf(stdout, "ok   %s\n", f)
	}
	fmt.Fprintf(stdout, "%d lab(s), %d failed\n", len(files), failed)
	if failed > 0 {
		return 1
	}
	return 0
}
