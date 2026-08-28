(set-logic QF_SLIA)
(declare-const s String)
(assert (= s "a\u{9}b"))
(check-sat)
