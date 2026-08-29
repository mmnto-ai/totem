package main

// ─── Comparator ──────────────────────────────────────────────────────────────
//
// A port of `src/compare.mts` to Go, deliberately keeping ITS semantics rather
// than inventing looser ones:
//
//   - a VERDICT is the violation MULTISET keyed on (rule_id, line_number, ordinal);
//   - the event stream is a multiset keyed on (kind, line_number);
//   - the shipped arm carries no ordinal, so one is DERIVED (regex ⇒ 0;
//     ast-grep ⇒ the index of the FactBundle astMatch the violation pairs with,
//     matched greedily by line number). An unpairable violation is a reported
//     problem, never a silent 0;
//   - the shipped event context's `line` is the line NUMBER, while the shipped
//     Violation's `line` is the matched TEXT — projecting the wrong one would
//     compare strings against integers and always diverge;
//   - `fired` and `matchCount` must DERIVE from the multiset, checked not assumed,
//     and checked on EVERY pair before any classification — an explained
//     divergence is not an excuse to stop looking at the derived fields;
//   - an ERROR ROW on either side is a divergence, never a clean zero;
//   - exactly ONE explanation class is registered: ORDINAL-DERIVATION-ONLY.
//
// The detector is exercised against synthetic mutants before any real row is
// compared (see selfTest), because an all-green report is worth exactly what its
// detector is worth.

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

type violation struct {
	RuleID     string `json:"rule_id"`
	LineNumber int64  `json:"line_number"`
	Ordinal    int64  `json:"ordinal"`
}

type event struct {
	Kind string `json:"kind"`
	Line int64  `json:"line"`
}

// normalRow is one arm's verdict for one (rule, fixture) pair, normalised.
type normalRow struct {
	Arm        string
	RuleID     string
	FixtureID  string
	Specimen   string
	Engine     string
	Violations []violation // nil ⇒ error row
	Events     []event     // nil ⇒ error row
	Fired      *bool
	MatchCount *int
	Error      string // "" ⇒ no error

	// Absent marks a row this arm did not produce AT ALL, as distinct from an
	// error row (which the arm produced deliberately). The distinction is
	// load-bearing: the malformed-facts control is EXPLAINED only when both arms
	// actually errored, so a missing row must not be able to satisfy it.
	Absent bool

	OrdinalDerivation string
}

type status string

const (
	statusMatch       status = "MATCH"
	statusExplained   status = "EXPLAINED-DIVERGENCE"
	statusUnexplained status = "UNEXPLAINED-DIVERGENCE"
)

type pairResult struct {
	RuleID    string `json:"ruleId"`
	FixtureID string `json:"fixtureId"`
	Specimen  string `json:"specimen"`

	// SeedEntry is the seed rule's hash8 for a `seed20` record and is ABSENT on the
	// `specimens` set, where records come from no seed entry at all.
	//
	// It is a POINTER, and deliberately carries no `omitempty`: the key must stay
	// PRESENT and serialise as JSON `null` (mmnto-ai/totem#2694 C4 — "`seedEntry`
	// absent ⇒ JSON `null` in every artifact, TS and Go alike"). A plain string
	// serialises the absent value as `""`, which reads as a seed entry whose id is
	// the empty string and disagrees with the TS comparator's `null` for the same
	// fact; `omitempty` would drop the key entirely, which reads as "this artifact
	// does not model seedEntry".
	SeedEntry *string `json:"seedEntry"`

	Engine      string         `json:"engine"`
	Left        string         `json:"left"`
	Right       string         `json:"right"`
	Status      status         `json:"status"`
	Explanation *string        `json:"explanation"`
	Detail      map[string]any `json:"detail"`
}

// ─── Multiset helpers ────────────────────────────────────────────────────────

func counts(keys []string) map[string]int {
	m := map[string]int{}
	for _, k := range keys {
		m[k]++
	}
	return m
}

func multisetEqual(a, b []string) bool {
	ca, cb := counts(a), counts(b)
	if len(ca) != len(cb) {
		return false
	}
	for k, n := range ca {
		if cb[k] != n {
			return false
		}
	}
	return true
}

func multisetDiff(a, b []string) map[string][]string {
	ca, cb := counts(a), counts(b)
	onlyA, onlyB := []string{}, []string{}
	for k, n := range ca {
		for i := 0; i < n-cb[k]; i++ {
			onlyA = append(onlyA, k)
		}
	}
	for k, n := range cb {
		for i := 0; i < n-ca[k]; i++ {
			onlyB = append(onlyB, k)
		}
	}
	sort.Strings(onlyA)
	sort.Strings(onlyB)
	return map[string][]string{"onlyA": onlyA, "onlyB": onlyB}
}

// strictKeys is the contract's key: (rule_id, line_number, ordinal).
func strictKeys(vs []violation) []string {
	out := make([]string, 0, len(vs))
	for _, v := range vs {
		out = append(out, fmt.Sprintf("%s|%d|%d", v.RuleID, v.LineNumber, v.Ordinal))
	}
	sort.Strings(out)
	return out
}

// lineKeys is the weaker key, used ONLY to name an ordinal-only divergence.
func lineKeys(vs []violation) []string {
	out := make([]string, 0, len(vs))
	for _, v := range vs {
		out = append(out, fmt.Sprintf("%s|%d", v.RuleID, v.LineNumber))
	}
	sort.Strings(out)
	return out
}

func eventKeys(es []event) []string {
	out := make([]string, 0, len(es))
	for _, e := range es {
		out = append(out, fmt.Sprintf("%s|%d", e.Kind, e.Line))
	}
	sort.Strings(out)
	return out
}

// ─── Ordinal derivation for the shipped arm ──────────────────────────────────

type shippedViolation struct {
	RuleID     string `json:"ruleId"`
	LineNumber int64  `json:"lineNumber"`
}

func deriveShippedOrdinals(engine, _ruleID string, vs []shippedViolation, astMatches []astMatch) ([]violation, string, []string) {
	problems := []string{}

	if engine == "regex" {
		perLine := map[int64]int{}
		for _, v := range vs {
			perLine[v.LineNumber]++
		}
		lines := make([]int64, 0, len(perLine))
		for l := range perLine {
			lines = append(lines, l)
		}
		sort.Slice(lines, func(i, j int) bool { return lines[i] < lines[j] })
		for _, l := range lines {
			if perLine[l] > 1 {
				problems = append(problems, fmt.Sprintf(
					"regex row emitted %d violations on line %d; § Lowering 1 says the shipped regex path emits at most one per line, so the ordinal is undefined here",
					perLine[l], l))
			}
		}
		out := make([]violation, 0, len(vs))
		for _, v := range vs {
			out = append(out, violation{RuleID: v.RuleID, LineNumber: v.LineNumber, Ordinal: 0})
		}
		return out, "regex: ordinal := 0 (§ Lowering 1 — the shipped regex path emits ≤1 violation per added line)", problems
	}

	used := map[int]bool{}
	out := []violation{}
	for _, v := range vs {
		idx := -1
		for i, m := range astMatches {
			if !used[i] && m.LineNumber == v.LineNumber {
				idx = i
				break
			}
		}
		if idx < 0 {
			at := make([]string, 0, len(astMatches))
			for _, m := range astMatches {
				at = append(at, fmt.Sprint(m.LineNumber))
			}
			problems = append(problems, fmt.Sprintf(
				"shipped violation at line %d pairs with no unused astMatch (bundle has %d matches at lines [%v])",
				v.LineNumber, len(astMatches), at))
			continue
		}
		used[idx] = true
		out = append(out, violation{RuleID: v.RuleID, LineNumber: v.LineNumber, Ordinal: int64(idx)})
	}
	return out, "ast-grep: ordinal := the index of the FactBundle `astMatches` entry this violation pairs with, matched greedily by lineNumber (§ Lowering 1 — \"the match index\")", problems
}

// ─── Pair comparison ─────────────────────────────────────────────────────────

const ordinalExplanation = "ORDINAL-DERIVATION ONLY — the (rule_id, line_number) violation multisets and the event streams are identical; the arms differ only on the ordinal, which the shipped side does not carry natively and which this comparator reconstructs from the FactBundle. Not a semantic divergence."

func explain(left, right normalRow) (string, map[string]any) {
	if left.Violations == nil || right.Violations == nil {
		return "", nil
	}
	sameLines := multisetEqual(lineKeys(left.Violations), lineKeys(right.Violations))
	sameEvents := multisetEqual(eventKeys(left.Events), eventKeys(right.Events))
	sameStrict := multisetEqual(strictKeys(left.Violations), strictKeys(right.Violations))
	if sameLines && sameEvents && !sameStrict {
		d := left.OrdinalDerivation
		if d == "" {
			d = right.OrdinalDerivation
		}
		return ordinalExplanation, map[string]any{
			"leftStrict":        strictKeys(left.Violations),
			"rightStrict":       strictKeys(right.Violations),
			"ordinalDerivation": d,
		}
	}
	return "", nil
}

// malformedFactsControlFixture is the K5b control bundle: a FactBundle carrying a
// non-string member in `lines[]`, so `facts_wellformed` is false, the entrypoint's
// `result` rule is UNDEFINED, and BOTH wasm arms must return an EMPTY RESULT SET —
// which `entrypointValue` turns into an error row on purpose.
//
// Its whole point is to make the strictness contract OBSERVABLE, so the comparator
// names the designed error instead of reporting it as a divergence
// (mmnto-ai/totem-strategy#1154 § G8 — the comparator "carves it out with a named
// explanation class (MALFORMED-FACTS-CONTROL) so it never renders as
// UNEXPLAINED-DIVERGENCE and never manufactures a parity-divergence").
//
// The carve-out is deliberately NARROW. It is keyed on this one fixture id, it
// fires only when BOTH arms actually errored, it requires each side's error to be
// ITS OWN arm's designed error (see matchesDesignedControlError), and it declines
// when either arm produced a clean verdict — a control that stopped controlling is
// a finding, not an explanation. Widening any of the four would launder a real
// divergence.
const malformedFactsControlFixture = "m3-malformed-lines"

// The DESIGNED error each arm produces on the malformed-facts control
// (mmnto-ai/totem#2694 round-1 fold, C2 — "each arm has ONE designed error for
// that bundle").
//
// They live HERE, in the non-test half, because the predicate they feed is
// production behaviour: a copy spelled out in probe_test.go would let the shipped
// texts drift from the pinned ones and the test would still pass.
//
// The two shapes differ because the two failures happen in different places. The
// shipped harness never evaluates a policy: it rejects the malformed bundle itself
// and its message BEGINS with the designed text. The wasm arms evaluate the policy
// and fail inside entrypointValue (main.go), whose message CONTAINS the designed
// text, so a runtime-supplied prefix cannot break the match.
const (
	shippedDesignedControlError = "MALFORMED FACTS"
	wasmDesignedControlError    = "EMPTY RESULT SET"
)

// designedControlError is one arm's designed error: the text, and whether the
// arm's message must BEGIN with it or merely CONTAIN it.
type designedControlError struct {
	text     string
	prefixed bool
}

// designedControlErrors is the ONE table the predicate and its description both
// read, so the two cannot drift into disagreeing about what an arm must say. An
// arm absent from it can never satisfy the carve-out.
var designedControlErrors = map[string]designedControlError{
	"shipped": {text: shippedDesignedControlError, prefixed: true},
	"opa":     {text: wasmDesignedControlError},
	"wazero":  {text: wasmDesignedControlError},
}

// matchesDesignedControlError reports whether `msg` is the error THIS arm is
// designed to produce on the malformed-facts control.
//
// The per-arm predicate is the whole point (the round-1 finding): "both rows carry
// SOME error" is satisfied by a wazero trap or a decode failure just as well as by
// the designed outcome, so an explanation keyed on that would hide a real
// divergence behind the control. Matching each side against its own arm's designed
// text keeps the carve-out to the outcome it was built to observe.
//
// An arm with no registered designed error can never be explained, and neither can
// an empty message. That is the safe direction: a new arm reaching this fixture
// reports UNEXPLAINED until its designed error is written down here.
func matchesDesignedControlError(arm, msg string) bool {
	d, ok := designedControlErrors[arm]
	if !ok {
		return false
	}
	if d.prefixed {
		return strings.HasPrefix(msg, d.text)
	}
	return strings.Contains(msg, d.text)
}

// designedControlErrorOf states, in one phrase, what an arm's error must look like
// to satisfy the control. It exists so an off-script pair REPORTS the bar it
// missed: a detail carrying two error strings and no statement of what was
// expected leaves the reader to rediscover the predicate.
func designedControlErrorOf(arm string) string {
	d, ok := designedControlErrors[arm]
	if !ok {
		return "no designed control error is registered for this arm, so it can never satisfy the carve-out"
	}
	if d.prefixed {
		return "begins " + d.text
	}
	return "contains " + d.text
}

const malformedFactsControlExplanation = "MALFORMED-FACTS-CONTROL — the K5b control bundle. Its `lines[]` carries a " +
	"non-string member: on the wasm arms (opa, wazero) `facts_wellformed` is false and the entrypoint's `result` rule is " +
	"UNDEFINED (an EMPTY RESULT SET error row); the shipped harness never evaluates a policy over it and refuses the bundle " +
	"(a MALFORMED FACTS error row). Each arm's error row is that arm's DESIGNED outcome of the strictness contract, not a " +
	"divergence between the runtimes — and only that designed error qualifies; any other error on either side is UNEXPLAINED."

const absentRowReason = "ABSENT ROW — an arm produced no row at all for this (ruleId, fixtureId). " +
	"This is not an error row: the arm did not decide and then fail, it never reached the fixture."

// compareControlPair classifies the malformed-facts control.
//
// It runs BEFORE every other branch, including the MATCH branch: if both arms
// returned a clean verdict for this fixture — even the same clean verdict — the
// control did not fire and the run must say so.
func compareControlPair(base pairResult, left, right normalRow) pairResult {
	switch {
	case left.Absent || right.Absent:
		base.Status = statusUnexplained
		base.Detail = map[string]any{
			"reason":      absentRowReason,
			"leftAbsent":  left.Absent,
			"rightAbsent": right.Absent,
			"control":     "the malformed-facts control cannot be satisfied by a MISSING row — an arm that never evaluated the control proves nothing about the strictness contract",
		}
	case left.Error != "" && right.Error != "":
		leftDesigned := matchesDesignedControlError(left.Arm, left.Error)
		rightDesigned := matchesDesignedControlError(right.Arm, right.Error)
		if leftDesigned && rightDesigned {
			ex := malformedFactsControlExplanation
			base.Status = statusExplained
			base.Explanation = &ex
			base.Detail = map[string]any{
				"reason":     "MALFORMED-FACTS-CONTROL",
				"leftError":  left.Error,
				"rightError": right.Error,
			}
			return base
		}
		base.Status = statusUnexplained
		base.Detail = map[string]any{
			"reason": "MALFORMED-FACTS-CONTROL ERRORED OFF-SCRIPT — both arms errored on the control bundle, but at " +
				"least one error is NOT the error its arm is designed to produce here. A trap or a decode failure is " +
				"also an error row, and explaining it away as the control would hide a real divergence, so this pair " +
				"carries both messages instead",
			"leftError":          left.Error,
			"rightError":         right.Error,
			"leftMatchesDesign":  leftDesigned,
			"rightMatchesDesign": rightDesigned,
			"designedErrors": map[string]string{
				left.Arm:  designedControlErrorOf(left.Arm),
				right.Arm: designedControlErrorOf(right.Arm),
			},
		}
	default:
		base.Status = statusUnexplained
		base.Detail = map[string]any{
			"reason": "MALFORMED-FACTS-CONTROL DID NOT FIRE — this bundle must produce an ERROR ROW on BOTH arms; " +
				"at least one arm returned a clean verdict, so the strictness contract the control exists to observe is not holding",
			"leftError":  left.Error,
			"rightError": right.Error,
		}
	}
	return base
}

func comparePair(left, right normalRow) pairResult {
	// Identity is taken from whichever side HAS it: one of the two rows may be a
	// synthesised absent row, and reading the specimen off it unconditionally
	// would file the pair under the empty specimen.
	pick := func(a, b string) string {
		if a != "" {
			return a
		}
		return b
	}
	base := pairResult{
		RuleID:    pick(left.RuleID, right.RuleID),
		FixtureID: pick(left.FixtureID, right.FixtureID),
		Specimen:  pick(left.Specimen, right.Specimen),
		Engine:    pick(left.Engine, right.Engine),
		Left:      left.Arm,
		Right:     right.Arm,
	}

	if base.FixtureID == malformedFactsControlFixture {
		return compareControlPair(base, left, right)
	}

	if left.Absent || right.Absent {
		base.Status = statusUnexplained
		base.Detail = map[string]any{
			"reason":      absentRowReason,
			"leftAbsent":  left.Absent,
			"rightAbsent": right.Absent,
		}
		return base
	}

	if left.Error != "" || right.Error != "" {
		base.Status = statusUnexplained
		base.Detail = map[string]any{
			"reason":     "ERROR ROW — an arm failed to produce a verdict",
			"leftError":  left.Error,
			"rightError": right.Error,
		}
		return base
	}

	// `fired` and `matchCount` must DERIVE from the violation multiset on BOTH
	// arms — checked HERE, before either classification branch, because it is a
	// property of each row on its own and not of the pair. Checking it only inside
	// the equal-multiset branch left the explanation branch able to wave through a
	// row whose derived fields were wrong: an ordinal-only divergence carrying an
	// invalid `matchCount` came back EXPLAINED-DIVERGENCE ("not a semantic
	// divergence") on the strength of a multiset comparison that never looked at
	// the field that was wrong.
	firedOK := left.Fired != nil && right.Fired != nil &&
		*left.Fired == (len(left.Violations) > 0) && *right.Fired == (len(right.Violations) > 0)
	countOK := left.MatchCount != nil && right.MatchCount != nil &&
		*left.MatchCount == len(left.Violations) && *right.MatchCount == len(right.Violations)
	if !firedOK || !countOK {
		base.Status = statusUnexplained
		base.Detail = map[string]any{
			"reason": "`fired`/`matchCount` do not DERIVE from the violation multiset on one of the arms (§ Differential units)",
			"left":   map[string]any{"fired": left.Fired, "matchCount": left.MatchCount, "violations": len(left.Violations)},
			"right":  map[string]any{"fired": right.Fired, "matchCount": right.MatchCount, "violations": len(right.Violations)},
		}
		return base
	}

	lv, rv := strictKeys(left.Violations), strictKeys(right.Violations)
	le, re := eventKeys(left.Events), eventKeys(right.Events)
	violationsEqual := multisetEqual(lv, rv)
	eventsEqual := multisetEqual(le, re)

	if violationsEqual && eventsEqual {
		base.Status = statusMatch
		return base
	}

	if ex, detail := explain(left, right); ex != "" {
		base.Status = statusExplained
		base.Explanation = &ex
		base.Detail = detail
		return base
	}

	base.Status = statusUnexplained
	detail := map[string]any{
		"leftViolations": lv, "rightViolations": rv,
		"leftEvents": le, "rightEvents": re,
	}
	if violationsEqual {
		detail["violations"] = "equal"
	} else {
		detail["violations"] = multisetDiff(lv, rv)
	}
	if eventsEqual {
		detail["events"] = "equal"
	} else {
		detail["events"] = multisetDiff(le, re)
	}
	base.Detail = detail
	return base
}

// ─── Detector self-test ──────────────────────────────────────────────────────

func boolPtr(b bool) *bool { return &b }
func intPtr(i int) *int    { return &i }

// selfTest perturbs one axis of a known-good pair at a time and asserts the
// status each mutant must produce. Ported from compare.mts's mutant table.
func selfTest(ck *checks) {
	base := func(mut func(*normalRow)) normalRow {
		r := normalRow{
			Arm: "wazero", RuleID: "d0815b6769304e26", FixtureID: "c-corpus-fail",
			Specimen: "c", Engine: "ast-grep",
			Violations: []violation{
				{"d0815b6769304e26", 2, 0},
				{"d0815b6769304e26", 3, 1},
			},
			Events:     []event{{"trigger", 2}, {"trigger", 3}},
			Fired:      boolPtr(true),
			MatchCount: intPtr(2),
		}
		if mut != nil {
			mut(&r)
		}
		return r
	}

	type mutant struct {
		name   string
		left   normalRow
		right  normalRow
		expect status
	}
	mutants := []mutant{
		{"IDENTITY — an unperturbed pair MATCHES (the detector is not stuck on \"divergent\")",
			base(nil), base(func(r *normalRow) { r.Arm = "shipped" }), statusMatch},
		{"MUTANT — a shifted line_number is UNEXPLAINED",
			base(nil), base(func(r *normalRow) {
				r.Arm = "shipped"
				r.Violations = []violation{{"d0815b6769304e26", 2, 0}, {"d0815b6769304e26", 9, 1}}
			}), statusUnexplained},
		{"MUTANT — a DROPPED violation is UNEXPLAINED (multiplicity, not just membership)",
			base(nil), base(func(r *normalRow) {
				r.Arm = "shipped"
				r.Violations = []violation{{"d0815b6769304e26", 2, 0}}
				r.MatchCount = intPtr(1)
			}), statusUnexplained},
		{"MUTANT — an identical violation multiset with a DIVERGENT event stream is UNEXPLAINED",
			base(nil), base(func(r *normalRow) {
				r.Arm = "shipped"
				r.Events = []event{{"trigger", 2}}
			}), statusUnexplained},
		{"MUTANT — a `suppress` event where the other arm emitted `trigger` is UNEXPLAINED (kind is compared, not just line)",
			base(nil), base(func(r *normalRow) {
				r.Arm = "shipped"
				r.Events = []event{{"trigger", 2}, {"suppress", 3}}
			}), statusUnexplained},
		{"MUTANT — an ERROR ROW is UNEXPLAINED, never a clean zero",
			base(nil), base(func(r *normalRow) {
				r.Arm = "shipped"
				r.Violations, r.Events, r.Fired, r.MatchCount, r.Error = nil, nil, nil, nil, "boom"
			}), statusUnexplained},
		{"MUTANT — `fired`/`matchCount` that do NOT derive from the violation multiset is UNEXPLAINED",
			base(nil), base(func(r *normalRow) {
				r.Arm = "shipped"
				r.Fired, r.MatchCount = boolPtr(false), intPtr(0)
			}), statusUnexplained},
		{"MUTANT — an ORDINAL-ONLY permutation is EXPLAINED (and only this one is)",
			base(nil), base(func(r *normalRow) {
				r.Arm = "shipped"
				r.Violations = []violation{{"d0815b6769304e26", 2, 1}, {"d0815b6769304e26", 3, 0}}
			}), statusExplained},
		// Two axes at once: the ONE divergence class this comparator is allowed to
		// explain away, carried by a row whose `matchCount` does not derive. The
		// explanation must not swallow the second defect — before the derivation
		// check was hoisted out of the equal-multiset branch, this mutant came back
		// EXPLAINED.
		{"MUTANT — an ORDINAL-ONLY permutation carrying a NON-DERIVING `matchCount` is UNEXPLAINED (the explanation branch does not skip the derivation check)",
			base(nil), base(func(r *normalRow) {
				r.Arm = "shipped"
				r.Violations = []violation{{"d0815b6769304e26", 2, 1}, {"d0815b6769304e26", 3, 0}}
				r.MatchCount = intPtr(7)
			}), statusUnexplained},
	}

	for _, m := range mutants {
		got := comparePair(m.left, m.right)
		ck.check("DETECTOR "+m.name, got.Status == m.expect,
			fmt.Sprintf("expected %s, got %s", m.expect, got.Status))
	}
}

// ─── Checks ──────────────────────────────────────────────────────────────────

type checkRow struct {
	Name   string `json:"name"`
	Passed bool   `json:"passed"`
	Detail string `json:"detail,omitempty"`
}

type checks struct{ Rows []checkRow }

func (c *checks) check(name string, ok bool, detail string) {
	r := checkRow{Name: name, Passed: ok}
	if !ok {
		r.Detail = detail
	}
	c.Rows = append(c.Rows, r)
}

// eq compares two values by their canonical JSON.
//
// A marshal failure FAILS the check rather than being discarded: `json.Marshal`
// returns an empty slice on error, so swallowing it would compare "" against ""
// and record `Passed: true` — a check that cannot fail, which is worse than no
// check at all in a falsifier whose whole value is that its assertions can fail.
func (c *checks) eq(name string, got, want any) {
	g, err := json.Marshal(got)
	if err != nil {
		c.check(name, false, fmt.Sprintf("the `got` value could not be marshalled, so this check could not be evaluated: %v", err))
		return
	}
	w, err := json.Marshal(want)
	if err != nil {
		c.check(name, false, fmt.Sprintf("the `want` value could not be marshalled, so this check could not be evaluated: %v", err))
		return
	}
	c.check(name, string(g) == string(w), fmt.Sprintf("got %s, want %s", g, w))
}

func (c *checks) failed() []checkRow {
	var out []checkRow
	for _, r := range c.Rows {
		if !r.Passed {
			out = append(out, r)
		}
	}
	return out
}
