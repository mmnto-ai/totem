; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = d2f88c8528441069   (\.git[\/]hooks)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".git") (str.to_re "/") (str.to_re "hooks") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".git/hooks") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
