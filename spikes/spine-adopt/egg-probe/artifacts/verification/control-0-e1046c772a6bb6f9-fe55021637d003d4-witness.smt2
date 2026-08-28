; ENCODING CONTROL — expected sat.
; `pnpm\s+bin\b` vs `\bpnpm\s+bin\b` differ only by a LEADING \b, so the second rejects a line like `xpnpm bin` that the first accepts. A SAT here (with a witness) is what proves the construction discriminates rather than proving everything equal.
(set-logic QF_SLIA)
(set-option :produce-models true)

(declare-const s String)

(assert (! (xor (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "pnpm") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "bin") (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))) (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (str.to_re "pnpm") (re.+ (re.union (str.to_re "\u{9}") (str.to_re " "))) (str.to_re "bin") (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))))) :named symmetric-difference))
(check-sat)
(get-model)
