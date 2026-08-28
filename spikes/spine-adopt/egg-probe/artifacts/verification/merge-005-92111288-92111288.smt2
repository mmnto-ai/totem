; MERGE CHECK — two corpus patterns egg placed in one equivalence class.
;   A = ece07b64a3df6e2a   (bun-version:\s*['"]?latest['"]?)
;   B = 3706efb77448d53d   (bun-version:\s*['"]?latest['"]?)
; UNSAT = the symmetric difference is empty = the languages are equal.
; SAT   = egg claimed an equivalence that does not hold (criterion 1 fails).
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "bun-version:") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re "") (re.union (str.to_re """") (str.to_re "'"))) (str.to_re "latest") (re.union (str.to_re "") (re.union (str.to_re """") (str.to_re "'"))) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "bun-version:") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re "") (re.union (str.to_re """") (str.to_re "'"))) (str.to_re "latest") (re.union (str.to_re "") (re.union (str.to_re """") (str.to_re "'"))) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
