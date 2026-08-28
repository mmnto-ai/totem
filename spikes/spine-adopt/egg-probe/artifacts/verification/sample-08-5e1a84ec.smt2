; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 60c2e674222dc4e5   (\[\[.*==\s*['"]?(commit|push|pull|merge|rebase|checkout|fetch)['"]?\s*\]\])
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "[[") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "==") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re "") (re.union (str.to_re """") (str.to_re "'"))) (re.union (str.to_re "commit") (str.to_re "push") (str.to_re "pull") (str.to_re "merge") (str.to_re "rebase") (str.to_re "checkout") (str.to_re "fetch")) (re.union (str.to_re "") (re.union (str.to_re """") (str.to_re "'"))) (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "]]") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "[[") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "==") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re "") (re.union (str.to_re """") (str.to_re "'"))) (re.union (str.to_re "rebase") (str.to_re "commit") (str.to_re "merge") (str.to_re "pull") (str.to_re "checkout") (str.to_re "push") (str.to_re "fetch")) (re.union (str.to_re "") (re.union (str.to_re """") (str.to_re "'"))) (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "]]") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
