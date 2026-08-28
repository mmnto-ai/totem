; ──────────────────────────────────────────────────────────────────────────
; O5 — set membership
;
; Scope emptiness: does ANY path match fileGlobs and not excludeGlobs? SAT
; means the rule has a live scope; the witness is an in-scope path.
;
; - Scope from specimen (e) e-exception-excludeglobs.rule.yaml: fileGlobs
;   ['packages/**/*.ts'], excludeGlobs ['**/*.test.ts'].
; - Globs lowered by the § Design 7 profile (see lang.rs::glob_to_re);
;   membership in str.in_re is a FULL-string test, which supplies the
;   profile's ^…$ anchoring.
; Expected (OBLIGATIONS.md): SAT, witness path
; ──────────────────────────────────────────────────────────────────────────
(set-logic QF_SLIA)
(set-option :produce-models true)

(declare-const p String)

; ── check: in-scope-path-exists (expect sat) ─────────────────────────────────
(assert (str.in_re p (re.++ (str.to_re "packages/") (re.* (re.++ (re.+ (re.union (re.range " " ".") (re.range "0" "~"))) (str.to_re "/"))) (re.* (re.union (re.range " " ".") (re.range "0" "~"))) (str.to_re ".ts"))))
(assert (not (str.in_re p (re.++ (re.* (re.++ (re.+ (re.union (re.range " " ".") (re.range "0" "~"))) (str.to_re "/"))) (re.* (re.union (re.range " " ".") (re.range "0" "~"))) (str.to_re ".test.ts")))))
(check-sat)
(get-model)

