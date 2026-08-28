; MERGE CHECK — two corpus patterns egg placed in one equivalence class.
;   A = 56c801dfda484c75   (text-embedding-004)
;   B = 719a577b17874645   (text-embedding-004)
; UNSAT = the symmetric difference is empty = the languages are equal.
; SAT   = egg claimed an equivalence that does not hold (criterion 1 fails).
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "text-embedding-004") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "text-embedding-004") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
