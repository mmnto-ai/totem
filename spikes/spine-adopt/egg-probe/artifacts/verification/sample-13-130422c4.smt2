; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 4d63af6631a6ddf7   (<\/[a-zA-Z][^>]*>)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "</") (re.union (re.range "A" "Z") (re.range "a" "z")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "=") (re.range "?" "~"))) (str.to_re ">") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "</") (re.union (re.range "A" "Z") (re.range "a" "z")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "=") (re.range "?" "~"))) (str.to_re ">") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
