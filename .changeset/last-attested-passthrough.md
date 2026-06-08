---
'@mmnto/totem': patch
'@mmnto/cli': patch
---

feat(doctor): wire the `last-attested:` manifest field through to manual-attestation rows (#2125). The parity-manifest schema parses the optional ISO-8601 `last-attested:` date (strategy#540) into `ParityContract.lastAttested`, and `doctor --parity` passes it to the detector's reserved `attested?:` seam — dated rows render `last attested <date>`, undated rows keep the honest `last attested: not recorded`. Message refinement only; the manual-attestation verdict ceiling (`info`/`skip`, never fails) is unchanged. Ships with the `@mmnto/strategy-doctrine` 0.1.3→0.1.4 pin bump that distributes the first attestation dates.
