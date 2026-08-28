; ──────────────────────────────────────────────────────────────────────────
; O2 — contradiction
;
; Dead matcher: is L(pattern) empty for a contradictory construction p =
; re.inter(A, re.comp(A))? UNSAT proves the matcher can never fire.
;
; - A is specimen (a)'s target language, so the contradiction is built over a
;   REAL corpus matcher rather than a toy.
; - The core is single-element by construction: the one named assertion IS the
;   contradiction. That is the honest core for this shape, not a harness
;   limitation.
; Expected (OBLIGATIONS.md): UNSAT + unsat core
; ──────────────────────────────────────────────────────────────────────────
(set-logic QF_SLIA)
(set-option :produce-unsat-cores true)

(declare-const s String)

; ── check: dead-matcher-has-no-member (expect unsat) ─────────────────────────────────
(assert (! (str.in_re s (re.inter (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.++ (re.union (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (str.to_re "rm")) (str.to_re "rm")) (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) ((_ re.loop 0 40) (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".totem/lessons.md")) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) (re.comp (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.++ (re.union (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (str.to_re "rm")) (str.to_re "rm")) (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) ((_ re.loop 0 40) (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".totem/lessons.md")) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))))) :named dead-matcher-membership))
(check-sat)
(get-unsat-core)

