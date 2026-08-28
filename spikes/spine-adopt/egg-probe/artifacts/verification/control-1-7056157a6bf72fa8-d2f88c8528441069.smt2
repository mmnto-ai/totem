; ENCODING CONTROL — expected unsat.
; `[\/'"`]?\.git[\/]hooks` vs `\.git[\/]hooks` ARE equal under unanchored search (Σ*·C? = Σ*), but egg did NOT merge them: the absorbing law Σ*·C? → Σ* is not in the ruleset DESIGN names. A recorded FALSE NEGATIVE of the named ruleset, not of egg.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "") (re.union (str.to_re """") (str.to_re "'") (str.to_re "/") (str.to_re "`"))) (str.to_re ".git") (str.to_re "/") (str.to_re "hooks") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".git") (str.to_re "/") (str.to_re "hooks") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
