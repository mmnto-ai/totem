; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = 61dcb058bd1df15d   (\b(?:git\s+rm|rm)\s+[^\n]{0,40}\.totem/lessons\.md\b)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.union (re.++ (str.to_re "git") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "rm")) (str.to_re "rm")) (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) ((_ re.loop 0 40) (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".totem/lessons.md") (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))) (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.union (str.to_re "rm") (re.++ (str.to_re "git") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "rm"))) (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) ((_ re.loop 0 40) (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".totem/lessons.md") (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))))) :named symmetric-difference))
(check-sat)
