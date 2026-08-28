; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 271765fe97bafafb   (git add -A|git add --all)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.union (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "git add -A") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))) (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "git add --all") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) (str.in_re s (re.union (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "git add -A") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))) (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "git add --all") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))) :named symmetric-difference))
(check-sat)
