; ──────────────────────────────────────────────────────────────────────────
; O7 — regex/string constraints
;
; Rule subsumption/redundancy: is L(p_A) a subset of L(p_B) for two corpus
; patterns with known overlap? SAT means p_A is NOT redundant against p_B
; and the witness is a line only p_A catches.
;
; - p_A = corpus rule 09ee37252a814a09 (the lookahead-vs-requires control),
;   RE2-EXPRESSIBLE PARTS ONLY — its trailing (?![^'"\n]*LC_ALL=C) negative
;   lookahead is dropped.
; - That drop is an enumerable builtin-gap finding, NOT a silent
;   approximation: it WIDENS p_A, so a SAT witness here remains sound evidence
;   of non-subsumption, while an UNSAT would have needed the lookahead to be
;   sound.
; - p_B = specimen (d)'s target \bgit\s+(log|diff|status)\b — a strict
;   sub-alternation of p_A's fifteen branches.
; - MEASURED (dialect finding D6): this obligation originally also asserted
;   the redundant line-alphabet membership. That assertion changes no model
;   — L(p_A) is already inside the alphabet — but cvc5 could not decide
;   the obligation with it present even at 300s, and decides it in ~34ms
;   without it. z3 was unaffected either way.
; Expected (OBLIGATIONS.md): measured (either), agreement required
; ──────────────────────────────────────────────────────────────────────────
(set-logic QF_SLIA)
(set-option :produce-models true)

(declare-const s String)

; ── check: wide-pattern-catches-what-narrow-misses (expect measured) ─────────────────────────────────
(assert (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (re.union (str.to_re "log") (str.to_re "diff") (str.to_re "status") (str.to_re "show") (str.to_re "branch") (str.to_re "tag") (str.to_re "rev-parse") (str.to_re "ls-files") (str.to_re "for-each-ref") (str.to_re "cat-file") (str.to_re "blame") (str.to_re "shortlog") (str.to_re "stash") (str.to_re "remote") (str.to_re "config"))) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))))
(assert (not (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (re.union (str.to_re "log") (str.to_re "diff") (str.to_re "status"))) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))))))
(check-sat)
(get-model)

