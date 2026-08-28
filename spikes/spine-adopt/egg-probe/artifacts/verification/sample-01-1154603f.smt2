; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 3da0f60891174989   ("(?:api[_-]?key|token|secret|password)"\s*:\s*".+")
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re """") (re.union (re.++ (str.to_re "api") (re.union (str.to_re "") (re.union (str.to_re "-") (str.to_re "_"))) (str.to_re "key")) (str.to_re "token") (str.to_re "secret") (str.to_re "password")) (str.to_re """") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re ":") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re """") (re.+ (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re """") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re """") (re.union (str.to_re "token") (str.to_re "secret") (re.++ (str.to_re "api") (re.union (str.to_re "") (re.union (str.to_re "-") (str.to_re "_"))) (str.to_re "key")) (str.to_re "password")) (str.to_re """") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re ":") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re """") (re.+ (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re """") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
