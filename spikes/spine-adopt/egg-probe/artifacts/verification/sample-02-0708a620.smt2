; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 17f273d09af38f0c   (\bconsole\.(log|warn|error|info|debug|trace)\s*\()
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (str.to_re "console.") (re.union (str.to_re "log") (str.to_re "warn") (str.to_re "error") (str.to_re "info") (str.to_re "debug") (str.to_re "trace")) (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "(") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (str.to_re "console.") (re.union (str.to_re "warn") (str.to_re "info") (str.to_re "error") (str.to_re "trace") (str.to_re "log") (str.to_re "debug")) (re.* (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "(") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))) :named symmetric-difference))
(check-sat)
