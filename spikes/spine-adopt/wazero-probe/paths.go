package main

// ─── Artifact roots (C10 — SPIKE_ARTIFACTS_SUBDIR) ───────────────────────────
//
// A run can be sent into a NAMED artifact subdirectory so that a control run (the
// K4 example swap, the K3 control-only re-pin build) deposits a COMPLETE second
// artifact set beside the seed's instead of overwriting it
// (mmnto-ai/totem#2694 C10). The selector is the environment variable
// `SPIKE_ARTIFACTS_SUBDIR`, shared with the TS half — a flag of this arm's own
// would let one seam straddle two roots, with the TS half lowering into one and
// this half scoring out of the other.
//
// The subdir moves BOTH ends of this arm:
//
//   - the INPUT root it reads (`<spike-root>/artifacts/<subdir>`: the lowering
//     index, the fact corpus and its index, the shipped and opa verdict files);
//   - the OUTPUT dir it writes (`<spike-root>/wazero-probe/artifacts/<subdir>`).
//
// Unset ⇒ today's paths, byte for byte.
//
// The built modules move too, but this arm does not RE-DERIVE that path: the
// lowering artifact declares each record's `dir` and the TS lowering owns the
// naming rule (see policyWasmPath). What this file adds is the ASSERTION that the
// declared dir actually lives under the rego build root this run resolved — a
// lowering index from the seed's root, read during a `k4-swap` run, would
// otherwise silently evaluate the wrong modules.

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	artifactsSubdirEnvVar = "SPIKE_ARTIFACTS_SUBDIR"

	// artifactsSubdirPattern is the name grammar C10 fixes, verbatim. It is
	// deliberately narrow: the value is joined into a filesystem path on both
	// halves of the seam, so anything with a separator, a drive letter or a `..`
	// segment in it would silently relocate an artifact tree.
	artifactsSubdirPattern = `^[a-z0-9-]+$`

	// artifactsSubdirRefusal is the class name every subdir refusal carries, in
	// the house style of the other named refusals (`RECORD-SET IDENTITY`,
	// `EMPTY RESULT SET`, `ABSENT ROW`). A constant, so the tests assert on the
	// token the probe prints rather than on a re-spelled copy of the sentence.
	artifactsSubdirRefusal = "ARTIFACTS SUBDIR"

	// regoBuildRootRefusal is the class name for a lowering index whose declared
	// build directories do not live under the rego build root this run resolved.
	regoBuildRootRefusal = "REGO BUILD ROOT"
)

var artifactsSubdirRe = regexp.MustCompile(artifactsSubdirPattern)

// loadArtifactsSubdir resolves the subdir selector: "" when unset, the validated
// name otherwise.
//
// An invalid name is an ERROR rather than a fall-back to the default root. The
// fall-back is the dangerous branch: a typo'd `SPIKE_ARTIFACTS_SUBDIR=K4-Swap`
// would send a control run's outputs on top of the seed run's committed artifact
// set, which is the exact accident the subdir exists to prevent.
func loadArtifactsSubdir() (string, error) {
	// NOT trimmed (fold 1 G2, `.totem/specs/seed20-apparatus-slice2-fold1.md`): the
	// TS and Rust arms reject a value carrying whitespace, so this arm must too —
	// three arms, one grammar. A padded name fails the pattern below.
	v := os.Getenv(artifactsSubdirEnvVar)
	if v == "" {
		// Fold 1 G2: the control-only build (`SPIKE_CONTROL_RECORD` set, no subdir
		// named) defaults to `k3-control` on EVERY arm — the TS arm already did; an
		// arm that fell back to the base root would read the seed's facts against
		// the control's lowering.
		if os.Getenv(controlRecordEnvVar) != "" {
			return "k3-control", nil
		}
		return "", nil
	}
	if !artifactsSubdirRe.MatchString(v) {
		return "", fmt.Errorf(
			"%s — %s=%q is not a valid artifacts subdirectory name. C10 (mmnto-ai/totem#2694) fixes the grammar at "+
				"%s: lowercase letters, digits and hyphens only. Refusing rather than falling back to the default root, "+
				"because a rejected name that silently defaulted would write a control run's artifacts over the seed run's",
			artifactsSubdirRefusal, artifactsSubdirEnvVar, v, artifactsSubdirPattern)
	}
	return v, nil
}

// spikePaths is every root this arm reads or writes, resolved ONCE per run.
//
// Resolved once, and then passed, so that no call site can re-read the
// environment and disagree with the header the run printed. The header prints
// these exact fields.
type spikePaths struct {
	// Root is `spikes/spine-adopt` (the `-spike-root` flag).
	Root string
	// Subdir is the validated `SPIKE_ARTIFACTS_SUBDIR` value, "" when unset.
	Subdir string
	// Artifacts is the TS pipeline's artifact root this run reads.
	Artifacts string
	// Facts is the fact corpus directory inside Artifacts.
	Facts string
	// RegoBuild is the build root the lowered modules are expected under.
	RegoBuild string
	// Out is this probe's own artifact output directory.
	Out string
}

// resolveSpikePaths applies the subdir to every root at once.
//
// `subdirOf` is applied by JOINING the name onto each root rather than by
// rewriting a single string, so the unset case produces the identical paths the
// probe used before C10 — `filepath.Join(root, "artifacts")` — and not
// `…/artifacts/` with an empty final segment.
func resolveSpikePaths(root string) (spikePaths, error) {
	subdir, err := loadArtifactsSubdir()
	if err != nil {
		return spikePaths{}, err
	}
	under := func(parts ...string) string {
		p := filepath.Join(parts...)
		if subdir == "" {
			return p
		}
		return filepath.Join(p, subdir)
	}
	artifacts := under(root, "artifacts")
	return spikePaths{
		Root:      root,
		Subdir:    subdir,
		Artifacts: artifacts,
		Facts:     filepath.Join(artifacts, "facts"),
		RegoBuild: under(root, "rego", "build"),
		Out:       under(root, "wazero-probe", "artifacts"),
	}, nil
}

// artifact names one file inside the artifact root this run reads.
func (p spikePaths) artifact(name string) string {
	return filepath.Join(p.Artifacts, name)
}

// subdirLabel renders the subdir for the run-start header: the name, or the
// explicit "(unset)" rather than an empty column that reads as a missing line.
func (p spikePaths) subdirLabel() string {
	if p.Subdir == "" {
		return "(unset)"
	}
	return p.Subdir
}

// checkUnderRegoBuild asserts a lowering artifact's declared build directory is an
// IMMEDIATE child of the rego build root this run resolved.
//
// The `dir` is READ from the artifact, never re-derived (policyWasmPath states
// why), so under a subdir run this is the only place the two halves' agreement on
// the build root can be checked at all. Without it, a stale `artifacts/` (or a
// hand-copied one) would point a `k4-swap` run at the SEED run's modules and the
// probe would report a clean pass over the wrong wasm bytes.
//
// IMMEDIATE child, not merely "somewhere underneath", because the default root is
// a PARENT of every subdir root: `rego/build/k4-swap/<pkg>` is nested inside
// `rego/build/`, so a prefix test would catch a subdir run reading the seed's
// modules and NOT the reverse. The TS lowering writes exactly one segment below
// the build root (`src/lower.mts:672` — `path.join(REGO_BUILD_DIR, pkgSuffix)`),
// so the one-segment rule is the artifact's own shape and it discriminates in
// both directions.
func (p spikePaths) checkUnderRegoBuild(rec loweredRecord) error {
	dir := filepath.Join(p.Root, filepath.FromSlash(rec.Dir))
	rel, err := filepath.Rel(p.RegoBuild, dir)
	if err != nil || rel == "" || rel == "." || rel == ".." ||
		strings.ContainsRune(rel, filepath.Separator) || strings.ContainsRune(rel, '/') {
		return fmt.Errorf(
			"%s — record %s declares dir %q, which is not an immediate child of the rego build root this run "+
				"resolved (%s). %s=%s selects the build root on BOTH halves of the seam (mmnto-ai/totem#2694 C10), "+
				"so a lowering index pointing elsewhere means this run would evaluate another run's modules",
			regoBuildRootRefusal, rec.Specimen, rec.Dir, p.RegoBuild, artifactsSubdirEnvVar, p.subdirLabel())
	}
	return nil
}
