; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = cae08ccccd834eb3   (JSON\.parse\(.*(exec|spawn|stdout|stderr))
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "JSON.parse(") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "exec") (str.to_re "spawn") (str.to_re "stdout") (str.to_re "stderr")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "JSON.parse(") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "spawn") (str.to_re "stdout") (str.to_re "exec") (str.to_re "stderr")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
