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

func writePairsArtifact(outDir, recordSet string, pairs []pairResult) (string, error) {
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
		"explanationClasses": []map[string]any{{
			"id": "MALFORMED-FACTS-CONTROL",
			"fires": "fixtureId == " + malformedFactsControlFixture + " AND both arms returned an error row AND each arm's error is " +
				"ITS OWN designed error for this control (shipped: begins `" + shippedDesignedControlError + "`; opa/wazero: contains `" +
				wasmDesignedControlError + "`)",
			"declines": "either arm returned a clean verdict, or either arm produced no row at all, or either arm's error is not its " +
				"designed one (a trap, a decode failure, the other arm's text) — reported UNEXPLAINED with both messages",
			"rationale": malformedFactsControlExplanation,
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
