package gate

import (
	"context"
	"errors"
	"testing"
)

type fixed struct{ err error }

func (f *fixed) Err() error { return f.err }

func TestWith(t *testing.T) {
	ctx := context.Background()
	if Err(With(ctx, false, nil)) != nil {
		t.Error("dev profile without a gate: no gate")
	}
	if Err(With(ctx, true, nil)) == nil {
		t.Error("production without a gate must fail closed")
	}
	var typedNil *fixed
	if Err(With(ctx, true, typedNil)) == nil {
		t.Error("production with a typed nil gate must fail closed")
	}
	if Err(With(ctx, false, typedNil)) != nil {
		t.Error("dev profile with a typed nil gate: no gate")
	}
	closed := &fixed{err: errors.New("no engine")}
	if Err(With(ctx, false, closed)) == nil || Err(With(ctx, true, closed)) == nil {
		t.Error("a closed gate refuses in any profile it is given to")
	}
	if Err(With(ctx, true, &fixed{})) != nil {
		t.Error("an open gate lets creates through")
	}
}
