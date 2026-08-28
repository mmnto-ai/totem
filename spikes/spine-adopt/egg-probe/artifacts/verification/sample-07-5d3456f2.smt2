; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 94ad9eb3fe20bdb0   (git\s+(diff|checkout|restore|reset|add|ls-files|show)\s+[^|&;]*\$[a-zA-Z_][a-zA-Z0-9_]*)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "git") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re "diff") (str.to_re "checkout") (str.to_re "restore") (str.to_re "reset") (str.to_re "add") (str.to_re "ls-files") (str.to_re "show")) (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.* (re.union (str.to_re "\u{9}") (re.range " " "%") (re.range "'" ":") (re.range "<" "{") (re.range "}" "~"))) (str.to_re "$") (re.union (re.range "A" "Z") (str.to_re "_") (re.range "a" "z")) (re.* (re.union (re.range "0" "9") (re.range "A" "Z") (str.to_re "_") (re.range "a" "z"))) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "git") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.union (str.to_re "restore") (str.to_re "checkout") (str.to_re "diff") (str.to_re "add") (str.to_re "ls-files") (str.to_re "reset") (str.to_re "show")) (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (re.* (re.union (str.to_re "\u{9}") (re.range " " "%") (re.range "'" ":") (re.range "<" "{") (re.range "}" "~"))) (str.to_re "$") (re.union (re.range "A" "Z") (str.to_re "_") (re.range "a" "z")) (re.* (re.union (re.range "0" "9") (re.range "A" "Z") (str.to_re "_") (re.range "a" "z"))) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
