; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 16104b4e57be1a86   (\[['"][a-zA-Z_]\w*['"]\]\s*\()
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "[") (re.union (str.to_re """") (str.to_re "'")) (re.union (re.range "A" "Z") (str.to_re "_") (re.range "a" "z")) (re.* (re.union (re.range "0" "9") (re.range "A" "Z") (str.to_re "_") (re.range "a" "z"))) (re.union (str.to_re """") (str.to_re "'")) (str.to_re "]") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "(") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "[") (re.union (str.to_re """") (str.to_re "'")) (re.union (re.range "A" "Z") (str.to_re "_") (re.range "a" "z")) (re.* (re.union (re.range "0" "9") (re.range "A" "Z") (str.to_re "_") (re.range "a" "z"))) (re.union (str.to_re """") (str.to_re "'")) (str.to_re "]") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "(") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
