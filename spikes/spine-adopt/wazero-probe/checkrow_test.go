package main

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestCheckRowPublishesOkNotPassed pins C8 (mmnto-ai/totem#2694): this arm's
// `checks[]` rows are `{ name, ok, detail }`, the same grammar the TS harness
// writes (`src/lib/spike-env.mts:299`).
//
// The assertion is on the SERIALISED bytes, not on the Go field: the whole
// finding was that a scorer reading `checks[]` across the two comparators had to
// know which language wrote the artifact, and only the JSON key says that.
func TestCheckRowPublishesOkNotPassed(t *testing.T) {
	ck := &checks{}
	ck.check("a passing check", true, "detail that must not be recorded on a pass")
	ck.check("a failing check", false, "the reason it failed")
	ck.eq("an eq check", []int{1}, []int{1})

	b, err := json.Marshal(ck.Rows)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	text := string(b)

	if strings.Contains(text, `"passed"`) {
		t.Errorf("a check row still publishes `passed`; C8 renames the key to `ok`: %s", text)
	}
	if n := strings.Count(text, `"ok":`); n != 3 {
		t.Errorf("%d of 3 rows publish an `ok` key: %s", n, text)
	}
	if !strings.Contains(text, `"ok":true`) || !strings.Contains(text, `"ok":false`) {
		t.Errorf("the `ok` key does not carry both outcomes: %s", text)
	}

	// `detail` keeps its `omitempty`: recorded on a FAILING check, absent on a
	// passing one. A passing row that carried the detail string would publish a
	// reason for a failure that did not happen.
	if n := strings.Count(text, `"detail":`); n != 1 {
		t.Errorf("%d rows carry a `detail`; only the failing one should: %s", n, text)
	}
	if !strings.Contains(text, `"detail":"the reason it failed"`) {
		t.Errorf("the failing row lost its detail: %s", text)
	}
	if strings.Contains(text, "must not be recorded") {
		t.Errorf("a passing check recorded its detail: %s", text)
	}

	// The Go-side reader must follow the same field, or a failing run would exit
	// zero while the artifact said `ok: false`.
	f := ck.failed()
	if len(f) != 1 || f[0].Name != "a failing check" {
		t.Errorf("failed() = %+v; want exactly the failing row", f)
	}
}
