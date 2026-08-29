package main

// ─── Whole-run ERROR ROW accounting (C7) ─────────────────────────────────────
//
// "0 outside K5b" is only a claim if the K5b control bundle is subtracted
// EXPLICITLY and the remainder is asserted to be zero. A bare count of error rows
// cannot say that: it collapses "one designed error row from the control" and
// "one undesigned error row from a real record" into the same number.
//
// The grammar here is the TS comparator's, key for key
// (`src/compare.mts:935-957`), because the scorer reads ONE errorRows shape across
// `differential-report.json` and `wazero-report.json`
// (mmnto-ai/totem#2694 C7). Nothing about it is Go-flavoured: same keys, same
// sort orders, same `contract` sentence, same `[]`-never-`null` discipline.
//
// The rows counted are the arms' OWN normalised rows, so the number is the hosts'
// report and not the comparator's opinion, and the error predicate is C3's
// (a NON-EMPTY error string) on every arm.

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// armWazero is this probe's arm name — the one key `perArm` carries here, where
// the TS comparator carries `shipped`, `opa` and `regorus`. Named so the
// accounting, the checks and the tests cannot spell it three ways.
const armWazero = "wazero"

// errorRowsContract is the `contract` string both comparators publish, verbatim.
// Named here so the Go artifact cannot drift from the TS one by a word.
const errorRowsContract = "spec `.totem/specs/seed20-apparatus.md` § G8 — the whole-run errorRows count EXCLUDES exactly the malformed-facts control bundle when the summary says \"0 outside K5b\"."

// armErrorRows is one arm's accounting. Every field is present on every arm; an
// arm with nothing to report publishes zeroes and an empty list, never an absent
// key, because the reader is counting.
type armErrorRows struct {
	Total                int      `json:"total"`
	FromK5bControl       int      `json:"fromK5bControl"`
	OutsideK5b           int      `json:"outsideK5b"`
	OutsideK5bFixtureIDs []string `json:"outsideK5bFixtureIds"`
}

// errorRowAccounting is `wazero-report.json.errorRows`.
type errorRowAccounting struct {
	Contract             string                  `json:"contract"`
	K5bControlFixtureIDs []string                `json:"k5bControlFixtureIds"`
	PerArm               map[string]armErrorRows `json:"perArm"`
}

// armRowSet pairs an arm with the rows it produced, mirroring the TS side's
// `armRows` list so the two accountings are built from the same shape.
type armRowSet struct {
	Arm  string
	Rows []normalRow
}

// accountErrorRows builds the accounting for the given arms.
//
// `controlFixtureIDs` is the set of K5b control fixture ids PRESENT in this run's
// corpus — empty on a record set that carries no control bundle, exactly as the
// TS side's `malformedFactsControls` set is. It is a parameter rather than the
// module-level constant so the presence gate below is a property of the corpus,
// not an assumption about it.
func accountErrorRows(controlFixtureIDs []string, arms []armRowSet) errorRowAccounting {
	control := map[string]bool{}
	ids := []string{}
	for _, id := range controlFixtureIDs {
		if control[id] {
			continue
		}
		control[id] = true
		ids = append(ids, id)
	}
	sort.Strings(ids)

	perArm := map[string]armErrorRows{}
	for _, a := range arms {
		row := armErrorRows{OutsideK5bFixtureIDs: []string{}}
		for _, r := range a.Rows {
			// C3: an error row is a NON-EMPTY error string. normalRow already
			// carries "" for "no error", so this is the same predicate the
			// normalisers and the comparator use.
			if r.Error == "" {
				continue
			}
			row.Total++
			if control[r.FixtureID] {
				row.FromK5bControl++
				continue
			}
			row.OutsideK5b++
			row.OutsideK5bFixtureIDs = append(row.OutsideK5bFixtureIDs, r.FixtureID)
		}
		sort.Strings(row.OutsideK5bFixtureIDs)
		perArm[a.Arm] = row
	}

	return errorRowAccounting{
		Contract:             errorRowsContract,
		K5bControlFixtureIDs: ids,
		PerArm:               perArm,
	}
}

// outsideK5bKeys is the check's `got` value: every error row outside the control,
// as `<arm>/<fixtureId>`, sorted — the TS side's
// `outsideK5b.map(r => `${r.arm}/${r.fixtureId}`).sort()`.
//
// Never nil: the check compares it against `[]string{}`, and a nil slice marshals
// to `null`, which would read as "not computed" where the check claims "none".
func (a errorRowAccounting) outsideK5bKeys() []string {
	out := []string{}
	for arm, rows := range a.PerArm {
		for _, id := range rows.OutsideK5bFixtureIDs {
			out = append(out, arm+"/"+id)
		}
	}
	sort.Strings(out)
	return out
}

// controlRowCounts is the second check's `got` value: `<arm>:<n>` per arm, sorted
// by arm — the TS side's `${arm}:${count}` list. A clean zero fails it just as a
// missing row does, which is the point: the control exists to make the arm error.
func (a errorRowAccounting) controlRowCounts() []string {
	arms := make([]string, 0, len(a.PerArm))
	for arm := range a.PerArm {
		arms = append(arms, arm)
	}
	sort.Strings(arms)
	out := make([]string, 0, len(arms))
	for _, arm := range arms {
		out = append(out, arm+":"+strconv.Itoa(a.PerArm[arm].FromK5bControl))
	}
	return out
}

// controlRowCountsWant is the expectation the second check is held to: EXACTLY
// one control error row per arm.
func (a errorRowAccounting) controlRowCountsWant() []string {
	arms := make([]string, 0, len(a.PerArm))
	for arm := range a.PerArm {
		arms = append(arms, arm)
	}
	sort.Strings(arms)
	out := make([]string, 0, len(arms))
	for _, arm := range arms {
		out = append(out, arm+":1")
	}
	return out
}

// appendErrorRowChecks records the two checks C7 requires beside the accounting,
// mirroring `src/compare.mts:961-975`:
//
//  1. ZERO error rows outside the K5b control, on every arm accounted for. This
//     is the claim the accounting exists to support, and it is asserted rather
//     than read off the summary.
//  2. When the control fixture is PRESENT in the corpus, EXACTLY ONE error row
//     from it per arm. A clean zero fails this just as a missing row does: the
//     control exists to make each arm error, so a control that stopped
//     controlling is a finding, not a quieter run.
//
// The second check is gated on presence rather than asserted unconditionally,
// because a record set with no control bundle (`specimens`) would otherwise
// report a permanent failure for a control it never had.
//
// They live here, beside the accounting they read, so the checks and the
// published numbers cannot be computed from two different row sets.
func appendErrorRowChecks(ck *checks, a errorRowAccounting) {
	arms := make([]string, 0, len(a.PerArm))
	for arm := range a.PerArm {
		arms = append(arms, arm)
	}
	sort.Strings(arms)

	ck.eq(fmt.Sprintf("ERROR ROWS — zero outside the K5b malformed-facts control, on every arm (%s)",
		strings.Join(arms, ", ")),
		a.outsideK5bKeys(), []string{})

	if len(a.K5bControlFixtureIDs) == 0 {
		return
	}
	ck.eq(fmt.Sprintf("ERROR ROWS — the K5b control (%s) produced EXACTLY ONE error row on each arm (%s) — "+
		"never a clean zero, never a missing row",
		strings.Join(a.K5bControlFixtureIDs, ", "), strings.Join(arms, ", ")),
		a.controlRowCounts(), a.controlRowCountsWant())
}
