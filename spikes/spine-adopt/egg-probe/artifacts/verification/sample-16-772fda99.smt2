; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 6f1ffc8fb332d76f   (\b(latency|tokens?|duration|ms|count)\b\s\*\|\|)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.union (str.to_re "latency") (re.++ (str.to_re "token") (re.union (str.to_re "") (str.to_re "s"))) (str.to_re "duration") (str.to_re "ms") (str.to_re "count")) (re.union (str.to_re "\u{9}") (str.to_re " ")) (str.to_re "*||") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.union (str.to_re "ms") (re.++ (str.to_re "token") (re.union (str.to_re "") (str.to_re "s"))) (str.to_re "count") (str.to_re "latency") (str.to_re "duration")) (re.union (str.to_re "\u{9}") (str.to_re " ")) (str.to_re "*||") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
