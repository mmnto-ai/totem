package main

// ─── The opa-vs-wazero pairs artifact ────────────────────────────────────────
//
// `artifacts/wazero-pairs.json` is this arm's contribution to the differential in
// the SAME shape `artifacts/differential-report.json` uses, so a scorer reads one
// row grammar across every runtime pairing rather than a per-arm dialect
// (mmnto-ai/totem-strategy#1154 § G10).
//
// It compares the two runtimes evaluating the SAME wasm bytes: `left: "opa"` is
// the wasmtime arm's row from `artifacts/opa-verdicts.json`, `right: "wazero"` is
// the row this probe produced. Any divergence here is a RUNTIME divergence, not a
// lowering one — which is precisely why it is worth its own artifact.

import "sort"

// firedCount is how many rows of this artifact carry the given explanation class.
// Counted from the rows being written, never tallied separately, so the published
// list cannot claim a class the artifact does not contain.
func firedCount(rows []pairResult, class string) int {
	n := 0
	for _, r := range rows {
		if r.ExplanationClass != nil && *r.ExplanationClass == class {
			n++
		}
	}
	return n
}

func writePairsArtifact(outDir, recordSet string, runManifestSha256 *string, pairs []pairResult) (string, error) {
	// Never nil: `null` would read as "not computed" where the summary claims a
	// count, and this artifact exists to be counted.
	rows := []pairResult{}
	rows = append(rows, pairs...)
	sort.SliceStable(rows, func(i, j int) bool {
		if rows[i].RuleID != rows[j].RuleID {
			return rows[i].RuleID < rows[j].RuleID
		}
		return rows[i].FixtureID < rows[j].FixtureID
	})
	t := tallyOf(rows)

	return writeArtifact(outDir, "wazero-pairs.json", map[string]any{
		"generatedBy": "spikes/spine-adopt/wazero-probe (go run .)",
		"contract": "mmnto-ai/totem-strategy#1154 § G10 — the wazero arm's differential rows, in " +
			"artifacts/differential-report.json's shape. rego/LOWERING.md § Comparator + spec § Differential units " +
			"(\"a VERDICT is the violation MULTISET\", \"`fired` derives from violations\") supply the semantics, ported in compare.go.",
		"recordSet": recordSet,
		// Fold 2 H4: the run identity, present-as-null when the manifest carries
		// none — `controls.mts` K5/K5b refuse a pairs artifact whose identity is not
		// this run's (a leftover from an earlier run of the SAME set passed the
		// record-set guard alone).
		"runManifestSha256": runManifestSha256,
		"armProvenance": map[string]any{
			"opa":    "artifacts/opa-verdicts.json — spikes/spine-adopt/host/src/main.rs --arm opa (wasmtime), the SAME policy.wasm bytes",
			"wazero": "wazero-probe/artifacts/wazero-verdicts.json — this probe, driving the OPA wasm ABI by hand under wazero",
		},
		"comparisonKey": map[string]any{
			"violations": "(rule_id, line_number, ordinal) as a MULTISET",
			"events":     "(kind, line_number) as a MULTISET",
			"derivedFields": "`fired` and `matchCount` must DERIVE from the violation multiset on BOTH arms, checked on every " +
				"pair before any classification — an explained divergence is not an excuse to stop looking at them.",
			"errorRows": "An error row on either side is a divergence, never a clean zero. The one exception is the " +
				"malformed-facts control, below.",
			"rowJoin": "(ruleId, fixtureId). The bundle-to-record join upstream of it is the PAIR (ruleId, specimen), never " +
				"ruleId alone — records sharing a lessonHash (the pinned exemplar id on `specimens`, the language twins on `seed20`) " +
				"would otherwise fan one fixture across siblings.",
		},
		// The SAME class vocabulary the TS comparator publishes in
		// `differential-report.json.explanationClasses[]`
		// (`src/compare.mts:1016-1036`): same ids, so a scorer reading
		// `pairs[].explanationClass` across the two artifacts resolves every value
		// against one list (mmnto-ai/totem#2694 C9). `timesFired` is carried per
		// class so the list cannot claim a class the rows never produced.
		"explanationClasses": []map[string]any{{
			"id": ordinalDerivationOnlyClass,
			// `fires` is the TS entry's sentence verbatim (`src/compare.mts:1019-1020`),
			// so the two artifacts describe the shared class identically.
			"fires": "the (rule_id, line_number) multisets and the event streams are identical and only the ordinal differs",
			"declines": "any difference in the (rule_id, line_number) multiset or in the event stream — a wider rule would " +
				"launder a real semantic divergence as \"explained\", which is the failure a differential exists to prevent",
			"rationale":  ordinalExplanation,
			"timesFired": firedCount(rows, ordinalDerivationOnlyClass),
		}, {
			"id": malformedFactsControlClass,
			"fires": "fixtureId == " + malformedFactsControlFixture + " AND both arms returned an error row AND each arm's error is " +
				"ITS OWN designed error for this control (shipped: begins `" + shippedDesignedControlError + "`; opa/wazero: contains `" +
				wasmDesignedControlError + "`)",
			"declines": "either arm returned a clean verdict, or either arm produced no row at all, or either arm's error is not its " +
				"designed one (a trap, a decode failure, the other arm's text) — reported UNEXPLAINED with both messages",
			"rationale":  malformedFactsControlExplanation,
			"timesFired": firedCount(rows, malformedFactsControlClass),
		}},
		"summary": map[string]any{
			"MATCH":                  t.Match,
			"EXPLAINED-DIVERGENCE":   t.Explained,
			"UNEXPLAINED-DIVERGENCE": t.Unexplained,
			"total":                  len(rows),
		},
		"pairs": rows,
	})
}
