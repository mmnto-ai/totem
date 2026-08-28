; ──────────────────────────────────────────────────────────────────────────
; O6 — set membership
;
; Exclusion subsumption: is L(fileGlobs) a subset of L(excludeGlobs) —
; i.e. is every in-scope file excluded, making the rule dead by scope? UNSAT
; proves the subsumption.
;
; - CONSTRUCTED subsuming pair, per the table: fileGlobs
;   ['packages/**/*.test.ts'] against excludeGlobs ['**/*.test.ts'].
;   'packages/' is itself a legal (?:[^/]+/) segment, so the positive language
;   is contained in the negative one.
; - Both assertions are named so the core names the two scope arrays that
;   jointly kill the rule — the material a curation probe would surface.
; Expected (OBLIGATIONS.md): UNSAT + core
; ──────────────────────────────────────────────────────────────────────────
(set-logic QF_SLIA)
(set-option :produce-unsat-cores true)

(declare-const p String)

; ── check: no-path-escapes-the-exclusion (expect unsat) ─────────────────────────────────
(assert (! (str.in_re p (re.++ (str.to_re "packages/") (re.* (re.++ (re.+ (re.union (re.range " " ".") (re.range "0" "~"))) (str.to_re "/"))) (re.* (re.union (re.range " " ".") (re.range "0" "~"))) (str.to_re ".test.ts"))) :named in-positive-scope))
(assert (! (not (str.in_re p (re.++ (re.* (re.++ (re.+ (re.union (re.range " " ".") (re.range "0" "~"))) (str.to_re "/"))) (re.* (re.union (re.range " " ".") (re.range "0" "~"))) (str.to_re ".test.ts")))) :named not-in-exclusion))
(check-sat)
(get-unsat-core)

