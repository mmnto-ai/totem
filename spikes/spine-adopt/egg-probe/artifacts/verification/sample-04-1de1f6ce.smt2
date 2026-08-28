; REWRITE CHECK — a corpus pattern's desugared original vs the form egg
; extracted from its saturated e-class (AstSize cost).
;   pattern = c2d9e854231b78f1   (\b(coming soon|planned (feature|for)|future release|roadmap|under development|slated for|later development phases)\b)
; UNSAT = the rewriting preserved the language.
(set-logic QF_SLIA)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.union (str.to_re "coming soon") (re.++ (str.to_re "planned ") (re.union (str.to_re "feature") (str.to_re "for"))) (str.to_re "future release") (str.to_re "roadmap") (str.to_re "under development") (str.to_re "slated for") (str.to_re "later development phases")) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))) (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.union (re.++ (str.to_re "planned ") (re.union (str.to_re "feature") (str.to_re "for"))) (str.to_re "coming soon") (str.to_re "slated for") (str.to_re "future release") (str.to_re "roadmap") (str.to_re "under development") (str.to_re "later development phases")) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))))) :named symmetric-difference))
(check-sat)
