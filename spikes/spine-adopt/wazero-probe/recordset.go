package main

// ─── Record set ──────────────────────────────────────────────────────────────
//
// The pipeline runs over a SELECTED record set (mmnto-ai/totem-strategy#1154
// § Hard constraints 4): the default `specimens` is the seven-record baseline
// this probe was built against, `seed20` is the R14 trial set of 22 records plus
// the K5 control record, and `control` is the control-only build — one record,
// selected by `SPIKE_CONTROL_RECORD`, used for the K3 arm-B re-pin
// (mmnto-ai/totem#2694 C11).
//
// The Go arm reads the SAME selector the TS pipeline reads — the `SPIKE_RECORD_SET`
// environment variable — rather than a flag of its own. A flag would let one run
// straddle two sets: the TS half would lower and build one corpus while this half
// scored it against another set's required subset, and the mismatch would show up
// as a verdict divergence rather than as the configuration error it is.

import (
	"fmt"
	"os"
	"strings"
)

const (
	recordSetSpecimens = "specimens"
	recordSetSeed20    = "seed20"
	recordSetControl   = "control"
	recordSetEnvVar    = "SPIKE_RECORD_SET"

	// controlRecordEnvVar names the one record a `control` run loads (a path
	// relative to `spikes/spine-adopt/`). The path itself is the TS half's to
	// resolve and validate against its specimen table; this arm reads the variable
	// only to keep the two selectors from disagreeing.
	controlRecordEnvVar = "SPIKE_CONTROL_RECORD"
)

// controlRecordSelectorRefusal is the class name the conflicting-selector refusal
// carries, in the house style of the other named refusals (`RECORD-SET IDENTITY`,
// `ARTIFACTS SUBDIR`). A constant, so the tests assert on the token the probe
// prints rather than on a re-spelled copy of the sentence.
const controlRecordSelectorRefusal = "CONTROL-RECORD SELECTOR"

// loadRecordSet resolves the selector, defaulting to `specimens`.
//
// An unrecognised value is an ERROR, not a silent fall-back to the default: a
// typo'd `SPIKE_RECORD_SET=seed-20` would otherwise run the seed corpus through
// the specimens set's required subset and report a green run over the wrong
// contract. The spec names exactly three sets, so anything else is a defect at the
// call site and is reported there.
//
// `SPIKE_CONTROL_RECORD` SELECTS the `control` set (C11 — "SPIKE_CONTROL_RECORD
// selects it"), and naming it together with any other record set is a refusal on
// both halves of the seam. The two variables are a single decision expressed
// twice, so a disagreement between them cannot be resolved by preferring one: a
// run that honoured `SPIKE_RECORD_SET=seed20` while a control record was selected
// would score the control-only corpus against the seed set's contract.
func loadRecordSet() (string, error) {
	v := strings.TrimSpace(os.Getenv(recordSetEnvVar))
	control := strings.TrimSpace(os.Getenv(controlRecordEnvVar))
	if control != "" && v != "" && v != recordSetControl {
		return "", fmt.Errorf(
			"%s — %s=%q selects the control-only build, whose record set is %q, but %s=%q names a different set. "+
				"Refusing rather than preferring one of them: the two variables express ONE decision, and honouring "+
				"the record set here would score the control-only corpus against another set's contract "+
				"(mmnto-ai/totem#2694 C11)",
			controlRecordSelectorRefusal, controlRecordEnvVar, control, recordSetControl, recordSetEnvVar, v)
	}
	switch v {
	case "":
		if control != "" {
			return recordSetControl, nil
		}
		return recordSetSpecimens, nil
	case recordSetSpecimens, recordSetSeed20, recordSetControl:
		return v, nil
	default:
		return "", fmt.Errorf(
			"%s=%q names no known record set — mmnto-ai/totem-strategy#1154 § Hard constraints 4 and mmnto-ai/totem#2694 C11 declare exactly %q (the default), %q and %q",
			recordSetEnvVar, v, recordSetSpecimens, recordSetSeed20, recordSetControl)
	}
}

// isRequired answers whether a specimen's rows belong to the record set's
// REQUIRED subset — the rows the report tallies separately so they cannot be
// lost in an aggregate that a wide superset would dominate.
//
// On `specimens` the required subset is the two rows the original dispatch named
// explicitly (specimen-a and specimen-d-file); on `seed20` EVERY record is
// required, because the trial's whole question is per-record and a subset would
// silently exempt the records most likely to diverge. `control` is treated like
// `seed20` — all rows required (mmnto-ai/totem#2694 C11): the control-only build
// carries exactly one record, and exempting it would leave the run with no
// required row at all.
func isRequired(recordSet, specimen string) bool {
	if recordSet == recordSetSpecimens {
		return specimen == "a" || specimen == "d-file"
	}
	return true
}

// requiredSubsetDescription is the human-readable gloss the report carries beside
// the required-subset tally. It is DERIVED from the loaded records so it cannot
// go on describing the seven-specimen set after the set changes underneath it.
func requiredSubsetDescription(recordSet string, records []loweredRecord) string {
	if recordSet == recordSetSpecimens {
		return "specimen-a (61dcb058bd1df15d) + specimen-d-file (0123456789abcdef_d_file) — the rows the dispatch names explicitly"
	}
	if recordSet == recordSetControl {
		return fmt.Sprintf(
			"the control-only build selected by %s — all %d loaded record(s) are required (mmnto-ai/totem#2694 C11 / S5)",
			controlRecordEnvVar, len(records))
	}
	return fmt.Sprintf(
		"every record in the `%s` set — all %d lowered records are required (mmnto-ai/totem-strategy#1154 § G10)",
		recordSet, len(records))
}
