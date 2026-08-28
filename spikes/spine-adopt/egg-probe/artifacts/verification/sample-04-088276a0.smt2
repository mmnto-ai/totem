; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 76762d7d0ad98113   (\\b[A-Za-z_$][\w$]*\\b)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "\b") (re.union (str.to_re "$") (re.range "A" "Z") (str.to_re "_") (re.range "a" "z")) (re.* (re.union (str.to_re "$") (re.range "0" "9") (re.range "A" "Z") (str.to_re "_") (re.range "a" "z"))) (str.to_re "\b") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "\b") (re.union (str.to_re "$") (re.range "A" "Z") (str.to_re "_") (re.range "a" "z")) (re.* (re.union (str.to_re "$") (re.range "0" "9") (re.range "A" "Z") (str.to_re "_") (re.range "a" "z"))) (str.to_re "\b") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
