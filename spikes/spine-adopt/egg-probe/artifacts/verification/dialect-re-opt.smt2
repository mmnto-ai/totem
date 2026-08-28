; dialect probe — does the pinned z3 accept this construct?
(set-logic QF_SLIA)
(declare-const s String)
(assert (str.in_re s (re.opt (str.to_re "ab"))))
(check-sat)
