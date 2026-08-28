; ──────────────────────────────────────────────────────────────────────────
; O1 — contradiction
;
; Requires-vacuity: does requires.pattern match every line that
; target.pattern matches — i.e. can the rule EVER fire? SAT = the rule can
; fire and the witness IS the firing line; UNSAT = the rule is vacuous.
;
; - Source: specimen (d) d-requires-line.rule.yaml — target
;   \bgit\s+(log|diff|status)\b, requires LC_ALL=C, requires.scope: line.
; - requires: is a MATCH PREDICATE (satisfied ⇒ no violation), so vacuity is
;   exactly L(target) ⊆ L(requires).
; - No separate line-alphabet assertion is emitted: L(target) is built
;   entirely over the line alphabet, so membership in it already confines the
;   witness to a real line. See the REDUNDANT-ASSERTION rule in the module
;   header.
; Expected (OBLIGATIONS.md): SAT, stable witness
; ──────────────────────────────────────────────────────────────────────────
(set-logic QF_SLIA)
(set-option :produce-models true)

(declare-const s String)

; ── check: target-matches-without-requirement (expect sat) ─────────────────────────────────
(assert (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (re.union (str.to_re "log") (str.to_re "diff") (str.to_re "status"))) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))))
(assert (not (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "LC_ALL=C") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))))
(check-sat)
(get-model)

