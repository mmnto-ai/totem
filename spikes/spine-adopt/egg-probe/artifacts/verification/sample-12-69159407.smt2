; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = e118e1e349e8439e   (\?\?\s*(['"][^'"]*['"]|\d+|true|false)\s+as\s+)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "??") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (re.++ (re.union (str.to_re """") (str.to_re "'")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "!") (re.range "#" "&") (re.range "(" "~"))) (re.union (str.to_re """") (str.to_re "'"))) (re.+ (re.range "0" "9")) (str.to_re "true") (str.to_re "false")) (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "as") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "??") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (re.+ (re.range "0" "9")) (str.to_re "false") (re.++ (re.union (str.to_re """") (str.to_re "'")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "!") (re.range "#" "&") (re.range "(" "~"))) (re.union (str.to_re """") (str.to_re "'"))) (str.to_re "true")) (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "as") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
