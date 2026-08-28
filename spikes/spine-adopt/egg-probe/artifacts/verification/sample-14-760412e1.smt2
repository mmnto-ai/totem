; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = a8ade9d9b017f7b3   ((?:execSync|exec|spawnSync|spawn)\([^)]*(?:git\s+(?:branch|status|diff|log|show|describe))[^)]*\))
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "execSync") (str.to_re "exec") (str.to_re "spawnSync") (str.to_re "spawn")) (str.to_re "(") (re.* (re.union (str.to_re "\u{9}") (re.range " " "(") (re.range "*" "~"))) (str.to_re "git") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re "branch") (str.to_re "status") (str.to_re "diff") (str.to_re "log") (str.to_re "show") (str.to_re "describe")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "(") (re.range "*" "~"))) (str.to_re ")") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "execSync") (str.to_re "exec") (str.to_re "spawnSync") (str.to_re "spawn")) (str.to_re "(") (re.* (re.union (str.to_re "\u{9}") (re.range " " "(") (re.range "*" "~"))) (str.to_re "git") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re "describe") (str.to_re "branch") (str.to_re "status") (str.to_re "show") (str.to_re "diff") (str.to_re "log")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "(") (re.range "*" "~"))) (str.to_re ")") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
