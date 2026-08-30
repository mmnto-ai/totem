package main

import "testing"

// Fold 1 G2 (`.totem/specs/seed20-apparatus-slice2-fold1.md`, M8): the three
// arms resolve the artifact subdir by ONE rule — no trimming (a padded name is
// invalid on every arm), and the control-only build defaults to `k3-control`
// when `SPIKE_CONTROL_RECORD` is set and no subdir is named.
func TestArtifactsSubdirIsNotTrimmed(t *testing.T) {
	t.Setenv(controlRecordEnvVar, "")
	t.Setenv(artifactsSubdirEnvVar, " k4-swap ")
	if got, err := loadArtifactsSubdir(); err == nil {
		t.Errorf("%s=%q (padded) was accepted as %q; want a refusal — the TS and Rust arms refuse it", artifactsSubdirEnvVar, " k4-swap ", got)
	}
}

func TestArtifactsSubdirDefaultsToK3ControlForTheControlBuild(t *testing.T) {
	t.Setenv(artifactsSubdirEnvVar, "")
	t.Setenv(controlRecordEnvVar, "records/c-supp-astgrep-compound-failopen-catch.rule.yaml")
	if got, err := loadArtifactsSubdir(); err != nil || got != "k3-control" {
		t.Errorf("control build with no subdir = (%q, %v); want (%q, nil)", got, err, "k3-control")
	}
	// An explicit subdir still wins over the default.
	t.Setenv(artifactsSubdirEnvVar, "k3-repin")
	if got, err := loadArtifactsSubdir(); err != nil || got != "k3-repin" {
		t.Errorf("control build with an explicit subdir = (%q, %v); want (%q, nil)", got, err, "k3-repin")
	}
	// And without a control record, unset stays unset.
	t.Setenv(artifactsSubdirEnvVar, "")
	t.Setenv(controlRecordEnvVar, "")
	if got, err := loadArtifactsSubdir(); err != nil || got != "" {
		t.Errorf("no control record, no subdir = (%q, %v); want (\"\", nil)", got, err)
	}
}
