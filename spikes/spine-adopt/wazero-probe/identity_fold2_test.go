package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Fold 2 H4 (`.totem/specs/seed20-apparatus-slice2-fold2.md`): the pairs artifact
// carries the run identity the TS manifest minted — present-as-`null` when there
// is none — so `controls.mts` can refuse a leftover from an earlier run of the
// SAME record set, which the `recordSet` guard alone cannot tell apart.
func TestPairsArtifactCarriesTheRunIdentityPresentAsNull(t *testing.T) {
	withoutAt, err := writePairsArtifact(t.TempDir(), recordSetSpecimens, nil, nil)
	if err != nil {
		t.Fatalf("writePairsArtifact(nil identity): %v", err)
	}
	without, err := os.ReadFile(withoutAt)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(without), `"runManifestSha256": null`) {
		t.Errorf("a nil identity must serialise as a PRESENT null key; got:\n%s", without)
	}

	id := "d8ce68e23791cfe01e0baab9085ccf2e82ee5f8d4eda5c1cbc89965e70d79378"
	withAt, err := writePairsArtifact(t.TempDir(), recordSetSpecimens, &id, nil)
	if err != nil {
		t.Fatalf("writePairsArtifact(identity): %v", err)
	}
	with, err := os.ReadFile(withAt)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(with), `"runManifestSha256": "`+id+`"`) {
		t.Errorf("the identity must round-trip verbatim; got:\n%s", with)
	}
}

// manifestRunIdentity reads the key from the manifest at the resolved artifact
// root and is nil — never "" — when the manifest is missing or carries no key.
func TestManifestRunIdentityIsNilWhenAbsent(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "artifacts"), 0o750); err != nil {
		t.Fatal(err)
	}
	p := spikePaths{Root: root, Artifacts: filepath.Join(root, "artifacts")}
	if got := manifestRunIdentity(p); got != nil {
		t.Errorf("no manifest: want nil, got %q", *got)
	}
	if err := os.WriteFile(filepath.Join(root, "artifacts", "manifest.json"), []byte(`{"recordSet":"specimens"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := manifestRunIdentity(p); got != nil {
		t.Errorf("manifest without the key: want nil, got %q", *got)
	}
	if err := os.WriteFile(filepath.Join(root, "artifacts", "manifest.json"), []byte(`{"runManifestSha256":"abc"}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if got := manifestRunIdentity(p); got == nil || *got != "abc" {
		t.Errorf("manifest with the key: want \"abc\", got %v", got)
	}
}
