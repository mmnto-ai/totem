package main

import (
	"path/filepath"
	"strings"
	"testing"
)

// TestArtifactsSubdirMovesBothRoots pins C10 (mmnto-ai/totem#2694): the subdir
// moves the INPUT root this arm reads AND the OUTPUT dir it writes, together.
//
// Moving only one is the failure worth a test: a run that read the seed's
// artifacts and wrote into `k4-swap/` would report the seed's verdicts under the
// control's name, and every check in the run would be green while doing it.
func TestArtifactsSubdirMovesBothRoots(t *testing.T) {
	const root = "/spike"

	t.Setenv(artifactsSubdirEnvVar, "")
	base, err := resolveSpikePaths(root)
	if err != nil {
		t.Fatalf("unset %s: %v", artifactsSubdirEnvVar, err)
	}
	// Unset ⇒ today's paths, byte for byte. Spelled out rather than derived, so a
	// change to the join rule shows up here as a diff and not as a tautology.
	for _, c := range []struct{ got, want string }{
		{base.Artifacts, filepath.Join(root, "artifacts")},
		{base.Facts, filepath.Join(root, "artifacts", "facts")},
		{base.RegoBuild, filepath.Join(root, "rego", "build")},
		{base.Out, filepath.Join(root, "wazero-probe", "artifacts")},
	} {
		if c.got != c.want {
			t.Errorf("with %s unset: got %q, want %q", artifactsSubdirEnvVar, c.got, c.want)
		}
	}
	if base.Subdir != "" {
		t.Errorf("subdir = %q with the variable unset", base.Subdir)
	}

	t.Setenv(artifactsSubdirEnvVar, "k4-swap")
	moved, err := resolveSpikePaths(root)
	if err != nil {
		t.Fatalf("%s=k4-swap: %v", artifactsSubdirEnvVar, err)
	}
	for _, c := range []struct{ got, want string }{
		{moved.Artifacts, filepath.Join(root, "artifacts", "k4-swap")},
		{moved.Facts, filepath.Join(root, "artifacts", "k4-swap", "facts")},
		{moved.RegoBuild, filepath.Join(root, "rego", "build", "k4-swap")},
		{moved.Out, filepath.Join(root, "wazero-probe", "artifacts", "k4-swap")},
	} {
		if c.got != c.want {
			t.Errorf("with %s=k4-swap: got %q, want %q", artifactsSubdirEnvVar, c.got, c.want)
		}
	}
	if moved.Subdir != "k4-swap" {
		t.Errorf("subdir = %q, want %q", moved.Subdir, "k4-swap")
	}
	// The named artifact files follow the input root, not just the directory.
	if got, want := moved.artifact("facts-index.json"),
		filepath.Join(root, "artifacts", "k4-swap", "facts-index.json"); got != want {
		t.Errorf("artifact() = %q, want %q", got, want)
	}
	if moved.Artifacts == base.Artifacts || moved.Out == base.Out {
		t.Error("the subdir did not move both roots; one of them is still the default")
	}
}

// TestArtifactsSubdirRefusesAnInvalidName pins the grammar C10 fixes.
//
// The refusal — rather than a fall-back to the default root — is the load-bearing
// half: a rejected name that silently defaulted would write a control run's
// artifacts over the seed run's committed set, which is exactly what the subdir
// exists to prevent.
func TestArtifactsSubdirRefusesAnInvalidName(t *testing.T) {
	for _, bad := range []string{
		"K4-Swap",      // uppercase
		"k4_swap",      // underscore
		"k4/swap",      // a separator: would relocate the tree
		"../artifacts", // traversal
		"k4 swap",      // space
		"k4.swap",      // dot
		`C:\artifacts`, // absolute, Windows
		"k4+swap",      // punctuation outside the class
	} {
		t.Setenv(artifactsSubdirEnvVar, bad)
		got, err := loadArtifactsSubdir()
		if err == nil {
			t.Errorf("%s=%q was accepted as %q; the name grammar is %s",
				artifactsSubdirEnvVar, bad, got, artifactsSubdirPattern)
			continue
		}
		if !strings.Contains(err.Error(), artifactsSubdirRefusal) {
			t.Errorf("the refusal for %q does not name itself as a %s refusal: %v", bad, artifactsSubdirRefusal, err)
		}
		if _, err := resolveSpikePaths("/spike"); err == nil {
			t.Errorf("resolveSpikePaths accepted %s=%q; the refusal must reach the caller before any read",
				artifactsSubdirEnvVar, bad)
		}
	}

	for _, ok := range []string{"k4-swap", "k3-control", "a", "0", "seed20"} {
		t.Setenv(artifactsSubdirEnvVar, ok)
		if got, err := loadArtifactsSubdir(); err != nil || got != ok {
			t.Errorf("%s=%q = (%q, %v); a valid name must be accepted", artifactsSubdirEnvVar, ok, got, err)
		}
	}
}

// TestPolicyWasmPathStaysUnderTheResolvedBuildRoot pins the half of C10 this arm
// cannot apply itself: the built module's directory is READ from the lowering
// artifact (the TS lowering owns the naming rule), so the subdir reaches it only
// through that field. What is asserted here is that a `dir` from ANOTHER root is
// refused rather than followed.
func TestPolicyWasmPathStaysUnderTheResolvedBuildRoot(t *testing.T) {
	rec := loweredRecord{Specimen: "c-supp", Dir: "rego/build/k4-swap/r87aff037d7de47a7"}

	t.Setenv(artifactsSubdirEnvVar, "k4-swap")
	p, err := resolveSpikePaths("/spike")
	if err != nil {
		t.Fatalf("resolveSpikePaths: %v", err)
	}
	at, err := policyWasmPath(p, rec)
	if err != nil {
		t.Fatalf("a dir under the resolved build root was refused: %v", err)
	}
	if want := filepath.Join("/spike", "rego", "build", "k4-swap", "r87aff037d7de47a7", "policy.wasm"); at != want {
		t.Errorf("policyWasmPath = %q, want %q — the dir is read from the artifact, never re-derived", at, want)
	}

	// The seed run's dir under a k4-swap run: the exact accident the subdir
	// exists to prevent, and one a verbatim-path read cannot notice by itself.
	seed := loweredRecord{Specimen: "c-supp", Dir: "rego/build/r87aff037d7de47a7"}
	if _, err := policyWasmPath(p, seed); err == nil {
		t.Fatal("a lowering row pointing outside the resolved build root was followed; it must refuse")
	} else if !strings.Contains(err.Error(), regoBuildRootRefusal) {
		t.Errorf("the refusal does not name itself as a %s refusal: %v", regoBuildRootRefusal, err)
	}

	// And with no subdir the same seed row is the correct one, so the check is not
	// simply "always refuse".
	t.Setenv(artifactsSubdirEnvVar, "")
	base, err := resolveSpikePaths("/spike")
	if err != nil {
		t.Fatalf("resolveSpikePaths: %v", err)
	}
	if _, err := policyWasmPath(base, seed); err != nil {
		t.Errorf("the default build root refused its own dir: %v", err)
	}
	// The reverse direction, which a plain prefix test could NOT catch: the
	// default root is a parent of every subdir root, so `rego/build/k4-swap/<pkg>`
	// is "underneath" it. Only the immediate-child rule refuses it.
	if _, err := policyWasmPath(base, rec); err == nil {
		t.Error("a k4-swap dir was accepted by a default-root run; the check must be immediate-child, not prefix")
	}
}
