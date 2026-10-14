package exam

import (
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"math/big"
	"strconv"

	labsv1 "github.com/cloudtrain/cloudtrain/services/lab-orchestrator/api/v1alpha1"
)

// Drawn is one task of an attempt.
type Drawn struct {
	// Index is 1-based, in blueprint order.
	Index       int32
	Objective   string
	ID          string
	TemplateRef string
	// Seed resolves the task's params.
	Seed int64
	// Weight is the task's share of the total score in percent.
	Weight float64
	// Reused is true when the task was in the avoid list (pool too small).
	Reused bool
}

// Draw picks each objective's tasks from its pool, deterministically from
// seed. With freshDraw, tasks in avoid are taken only when the pool has too
// few others (then the fewest needed, also seeded). Task seeds are derived
// from (seed, task id), so a task's params do not depend on what else was
// drawn.
func Draw(spec *labsv1.ExamTemplateSpec, seed int64, avoid []string) ([]Drawn, error) {
	avoidSet := map[string]bool{}
	if spec.RetakePolicy.FreshDraw {
		for _, id := range avoid {
			avoidSet[id] = true
		}
	}
	weights := ObjectiveWeights(spec)
	var out []Drawn
	idx := int32(0)
	for _, o := range spec.Objectives {
		if o.Tasks <= 0 {
			continue
		}
		if int(o.Tasks) > len(o.Pool) {
			return nil, fmt.Errorf("objective %s draws %d task(s) from a pool of %d", o.ID, o.Tasks, len(o.Pool))
		}
		var fresh, reused []labsv1.ExamPoolTask
		for _, t := range o.Pool {
			if avoidSet[t.ID] {
				reused = append(reused, t)
			} else {
				fresh = append(fresh, t)
			}
		}
		st := &stream{key: fmt.Sprintf("draw|%d|%s", seed, o.ID)}
		st.shuffle(fresh)
		st.shuffle(reused)
		pick := append(append([]labsv1.ExamPoolTask{}, fresh...), reused...)[:o.Tasks]
		per := weights[o.ID] / float64(o.Tasks)
		for i, t := range pick {
			idx++
			out = append(out, Drawn{
				Index: idx, Objective: o.ID, ID: t.ID, TemplateRef: t.TemplateRef.Name,
				Seed: TaskSeed(seed, t.ID), Weight: per, Reused: i >= len(fresh),
			})
		}
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("the blueprint draws no tasks")
	}
	return out, nil
}

// ObjectiveWeights normalises objective weights to percent over the
// objectives that draw at least one task.
func ObjectiveWeights(spec *labsv1.ExamTemplateSpec) map[string]float64 {
	sum := 0.0
	raw := map[string]float64{}
	for _, o := range spec.Objectives {
		if o.Tasks <= 0 {
			continue
		}
		w, err := strconv.ParseFloat(o.Weight, 64)
		if err != nil || w < 0 {
			w = 0
		}
		raw[o.ID] = w
		sum += w
	}
	out := map[string]float64{}
	n := float64(len(raw))
	for id, w := range raw {
		if sum > 0 {
			out[id] = 100 * w / sum
		} else {
			out[id] = 100 / n
		}
	}
	return out
}

// TaskSeed derives a task's param seed from the attempt seed and the task
// id (positive, stable across platforms).
func TaskSeed(seed int64, taskID string) int64 {
	h := sha256.Sum256([]byte(fmt.Sprintf("cloudtrain/exam/v1|task|%d|%s", seed, taskID)))
	return int64(binary.BigEndian.Uint64(h[:8]) &^ (1 << 63))
}

// stream is a deterministic PRNG keyed by a string (SHA-256 counter mode).
type stream struct {
	key     string
	counter uint64
}

func (s *stream) intn(n int) int {
	h := sha256.Sum256([]byte(fmt.Sprintf("cloudtrain/exam/v1|%s|%d", s.key, s.counter)))
	s.counter++
	v := new(big.Int).SetBytes(h[:])
	return int(v.Mod(v, big.NewInt(int64(n))).Int64())
}

// shuffle is a seeded Fisher-Yates shuffle.
func (s *stream) shuffle(xs []labsv1.ExamPoolTask) {
	for i := len(xs) - 1; i > 0; i-- {
		j := s.intn(i + 1)
		xs[i], xs[j] = xs[j], xs[i]
	}
}
