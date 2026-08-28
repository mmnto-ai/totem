; MERGE CHECK — two corpus patterns egg placed in one equivalence class.
;   A = 28cc46c09bd5820f   (currentBranch:\s*['"][^'"]+['"])
;   B = a24ec7272f1f670e   (currentBranch:\s*["'][^"']+["'])
; UNSAT = the symmetric difference is empty = the languages are equal.
; SAT   = egg claimed an equivalence that does not hold (criterion 1 fails).
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "currentBranch:") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re """") (str.to_re "'")) (re.+ (re.union (str.to_re "\u{9}") (re.range " " "!") (re.range "#" "&") (re.range "(" "~"))) (re.union (str.to_re """") (str.to_re "'")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "currentBranch:") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re """") (str.to_re "'")) (re.+ (re.union (str.to_re "\u{9}") (re.range " " "!") (re.range "#" "&") (re.range "(" "~"))) (re.union (str.to_re """") (str.to_re "'")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
