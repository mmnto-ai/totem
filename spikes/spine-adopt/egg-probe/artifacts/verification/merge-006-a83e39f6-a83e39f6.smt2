; MERGE CHECK — two corpus patterns egg placed in one equivalence class.
;   A = 55c903bd228e0b5c   (\[Totem Error\])
;   B = 027b32b8ea3c8c51   (\[Totem Error\])
; UNSAT = the symmetric difference is empty = the languages are equal.
; SAT   = egg claimed an equivalence that does not hold (criterion 1 fails).
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "[Totem Error]") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "[Totem Error]") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
