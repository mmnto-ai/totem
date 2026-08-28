; dialect probe — does the pinned z3 accept this construct?
(set-logic QF_SLIA)
(declare-const s String)
(assert (str.in_re s ((_ re.loop 0 3) (str.to_re "x"))))
(check-sat)
