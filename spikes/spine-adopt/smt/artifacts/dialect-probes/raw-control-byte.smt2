(set-logic QF_SLIA)
(declare-const s String)
(assert (= s "a	b"))
(check-sat)
