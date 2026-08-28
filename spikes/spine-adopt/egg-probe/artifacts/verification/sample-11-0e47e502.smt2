; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 71afc4b8f4c930a1   (\}\s*as\s+Error\b)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "}") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "as") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "Error") (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))) (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "}") (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "as") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "Error") (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))))) :named symmetric-difference))
(check-sat)
