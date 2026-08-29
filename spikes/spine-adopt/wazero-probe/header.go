package main

// ─── Run-start environment header (S4) ───────────────────────────────────────
//
// The TS half prints one environment block before any check
// (`src/manifest.mts`); this arm repeats the SAME block at its run start
// (mmnto-ai/totem#2694 § S4), so a transcript of either half answers "which
// commit, which record pin, which artifact roots, which toolchain" without
// opening an artifact.
//
// It is a PRINT, not an artifact: nothing here is a new claim. Every value is
// either read back from `manifest.json` — the TS half's record, quoted, never
// re-derived — or is this process's own resolved path.
//
// Absent values print as `(absent)` rather than as an empty column. The manifest
// legitimately predates some of these keys (S2 adds `artifactsSubdir`,
// `controlRecord` and `byteIdentity`), and a blank line would read as "the value
// is empty" instead of "the manifest does not carry it".

import (
	"fmt"
	"os"
	"sort"
	"strings"
)

const absentValue = "(absent)"

// runManifestHeader is `artifacts/manifest.json` as far as the header reads it.
//
// Every field is a POINTER (or a map, which is nil when absent) so that a MISSING
// key is distinguishable from an empty one. Unknown fields are ignored by design:
// the manifest carries far more than the header prints, and this arm must not
// break when the TS half adds a key.
type runManifestHeader struct {
	RunCommit        *string `json:"runCommit"`
	WorkingTreeClean *bool   `json:"workingTreeClean"`
	RecordPin        *string `json:"recordPin"`
	ArtifactsSubdir  *string `json:"artifactsSubdir"`
	ControlRecord    *string `json:"controlRecord"`

	Platform *struct {
		OS      *string `json:"os"`
		Arch    *string `json:"arch"`
		Release *string `json:"release"`
	} `json:"platform"`

	Toolchain map[string]struct {
		Version *string `json:"version"`
	} `json:"toolchain"`

	ByteIdentity *struct {
		BaselinePin *string `json:"baselinePin"`
	} `json:"byteIdentity"`
}

func orAbsent(s *string) string {
	if s == nil || *s == "" {
		return absentValue
	}
	return *s
}

// orAbsentBool renders a manifest boolean the same way: a missing key is
// `(absent)`, never silently `false` — the header must not claim a clean tree
// the manifest never attested (fold 1 G4, `seed20-apparatus-slice2-fold1.md`).
func orAbsentBool(b *bool) string {
	if b == nil {
		return absentValue
	}
	if *b {
		return "true"
	}
	return "false"
}

// platformLine renders `os/arch release`, or `(absent)`.
func (m runManifestHeader) platformLine() string {
	if m.Platform == nil {
		return absentValue
	}
	line := orAbsent(m.Platform.OS) + "/" + orAbsent(m.Platform.Arch)
	if m.Platform.Release != nil && *m.Platform.Release != "" {
		line += " " + *m.Platform.Release
	}
	return line
}

// toolchainLine renders `name=version` for every recorded tool, sorted by name so
// two runs are diffable. A null version prints as `(absent)` — that is a FAIL
// check on the TS side for the seed sets (S4), and the header must not hide it.
func (m runManifestHeader) toolchainLine() string {
	if len(m.Toolchain) == 0 {
		return absentValue
	}
	names := make([]string, 0, len(m.Toolchain))
	for n := range m.Toolchain {
		names = append(names, n)
	}
	sort.Strings(names)
	parts := make([]string, 0, len(names))
	for _, n := range names {
		parts = append(parts, n+"="+orAbsent(m.Toolchain[n].Version))
	}
	return strings.Join(parts, " ")
}

// baselinePin is `BASELINE_PIN`, echoed from the manifest's byteIdentity block.
func (m runManifestHeader) baselinePin() string {
	if m.ByteIdentity == nil {
		return absentValue
	}
	return orAbsent(m.ByteIdentity.BaselinePin)
}

// printRunHeader prints the block. It never fails the run: a manifest that cannot
// be read is REPORTED on the `manifest` line and the rest of the block still
// prints this process's own resolved roots. The manifest is the TS half's
// artifact, and the checks that gate on it are the TS half's too — refusing here
// would turn a print into a second, undeclared gate.
// The `record set` line S4 names is printed immediately above this block by the
// caller and is not repeated here.
func printRunHeader(p spikePaths) {
	at := p.artifact("manifest.json")
	var m runManifestHeader
	manifestLine := at
	if err := readJSON(at, &m); err != nil {
		manifestLine = fmt.Sprintf("%s — NOT READ: %v", at, err)
	}

	fmt.Printf("\n-- run environment (spec .totem/specs/seed20-apparatus-slice2.md S4) --\n")
	fmt.Printf("  manifest          %s\n", manifestLine)
	fmt.Printf("  runCommit         %s\n", orAbsent(m.RunCommit))
	fmt.Printf("  workingTreeClean  %s\n", orAbsentBool(m.WorkingTreeClean))
	fmt.Printf("  recordPin         %s\n", orAbsent(m.RecordPin))
	fmt.Printf("  BASELINE_PIN      %s\n", m.baselinePin())
	fmt.Printf("  artifactsSubdir   %s (%s)  manifest: %s\n",
		p.subdirLabel(), artifactsSubdirEnvVar, orAbsent(m.ArtifactsSubdir))
	fmt.Printf("  controlRecord     %s (%s)  manifest: %s\n",
		envOrUnset(controlRecordEnvVar), controlRecordEnvVar, orAbsent(m.ControlRecord))
	fmt.Printf("  platform          %s\n", m.platformLine())
	fmt.Printf("  toolchain         %s\n", m.toolchainLine())
	fmt.Printf("  roots\n")
	fmt.Printf("    artifacts in    %s\n", p.Artifacts)
	fmt.Printf("    facts in        %s\n", p.Facts)
	fmt.Printf("    rego build      %s\n", p.RegoBuild)
	fmt.Printf("    artifacts out   %s\n", p.Out)
	fmt.Printf("\n")
}

// envOrUnset renders an environment variable for the header: its trimmed value,
// or the explicit "(unset)".
func envOrUnset(name string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return "(unset)"
}
