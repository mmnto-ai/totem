; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = d5b7c8b5391ffb9f   (throw\s+new\s+\w*Error\([^)]*\+\s*(?:err|e|error)\.message)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "throw") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "new") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.* (re.union (re.range "0" "9") (re.range "A" "Z") (str.to_re "_") (re.range "a" "z"))) (str.to_re "Error(") (re.* (re.union (str.to_re "\u{9}") (re.range " " "(") (re.range "*" "~"))) (str.to_re "+") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re "err") (str.to_re "e") (str.to_re "error")) (str.to_re ".message") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "throw") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "new") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.* (re.union (re.range "0" "9") (re.range "A" "Z") (str.to_re "_") (re.range "a" "z"))) (str.to_re "Error(") (re.* (re.union (str.to_re "\u{9}") (re.range " " "(") (re.range "*" "~"))) (str.to_re "+") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re "e") (str.to_re "err") (str.to_re "error")) (str.to_re ".message") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
