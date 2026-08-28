; MERGE CHECK — two corpus patterns egg placed in one equivalence class.
;   A = d2f88c8528441069   (\.git[\/]hooks)
;   B = 282e9e8692be3edb   (\.git\/hooks)
; UNSAT = the symmetric difference is empty = the languages are equal.
; SAT   = egg claimed an equivalence that does not hold (criterion 1 fails).
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".git") (str.to_re "/") (str.to_re "hooks") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".git/hooks") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
