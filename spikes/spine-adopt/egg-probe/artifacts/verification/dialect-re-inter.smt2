; dialect probe — does the pinned z3 accept this construct?
(set-logic QF_SLIA)
(declare-const s String)
(assert (str.in_re s (re.inter (str.to_re "") (str.to_re "a"))))
(check-sat)
