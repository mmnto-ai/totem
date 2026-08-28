; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = e12c9c71f8e0aa5b   ("optionalDependencies"\s*:)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re """optionalDependencies""") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re ":") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re """optionalDependencies""") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re ":") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
