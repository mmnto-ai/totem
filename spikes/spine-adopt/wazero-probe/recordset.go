package main

// ─── Record set ──────────────────────────────────────────────────────────────
//
// The pipeline runs over a SELECTED record set (mmnto-ai/totem-strategy#1154
// § Hard constraints 4): the default `specimens` is the seven-record baseline
// this probe was built against, and `seed20` is the R14 trial set of 22 records.
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
	recordSetEnvVar    = "SPIKE_RECORD_SET"
)

// loadRecordSet resolves the selector, defaulting to `specimens`.
//
// An unrecognised value is an ERROR, not a silent fall-back to the default: a
// typo'd `SPIKE_RECORD_SET=seed-20` would otherwise run the seed corpus through
// the specimens set's required subset and report a green run over the wrong
// contract. The spec names exactly two sets, so anything else is a defect at the
// call site and is reported there.
func loadRecordSet() (string, error) {
	v := strings.TrimSpace(os.Getenv(recordSetEnvVar))
	switch v {
	case "":
		return recordSetSpecimens, nil
	case recordSetSpecimens, recordSetSeed20:
		return v, nil
	default:
		return "", fmt.Errorf(
			"%s=%q names no known record set — mmnto-ai/totem-strategy#1154 § Hard constraints 4 declares exactly %q (the default) and %q",
			recordSetEnvVar, v, recordSetSpecimens, recordSetSeed20)
	}
}

// isRequired answers whether a specimen's rows belong to the record set's
// REQUIRED subset — the rows the report tallies separately so they cannot be
// lost in an aggregate that a wide superset would dominate.
//
// On `specimens` the required subset is the two rows the original dispatch named
// explicitly (specimen-a and specimen-d-file); on `seed20` EVERY record is
// required, because the trial's whole question is per-record and a subset would
// silently exempt the records most likely to diverge.
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
	return fmt.Sprintf(
		"every record in the `%s` set — all %d lowered records are required (mmnto-ai/totem-strategy#1154 § G10)",
		recordSet, len(records))
}
