; ──────────────────────────────────────────────────────────────────────────
; O4 — exhaustiveness
;
; Fixture differential: for specimen (a)'s inline example pair, is the bad
; line in L(pattern) AND the good line outside it? SAT means the authored
; pair actually discriminates.
;
; - Pair from a-regex-lessons-rm-guard.rule.yaml examples[0]: bad 'git rm
;   .totem/lessons.md', good 'rm .totem/lessons/lesson-cd27a5b0.md'.
; - Both operands are ground, so SAT here is a PROOF about the two authored
;   lines, not the discovery of some other witness.
; - Line-anchored per the table: each example is one added line, and the regex
;   is an unanchored search WITHIN that line — the shipped per-added-line
;   semantics.
; Expected (OBLIGATIONS.md): SAT (both conjuncts)
; ──────────────────────────────────────────────────────────────────────────
(set-logic QF_SLIA)
(set-option :produce-models true)

(declare-const bad String)
(declare-const good String)

; ── check: bad-matches-and-good-does-not (expect sat) ─────────────────────────────────
(assert (= bad "git rm .totem/lessons.md"))
(assert (str.in_re bad (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.++ (re.union (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (str.to_re "rm")) (str.to_re "rm")) (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) ((_ re.loop 0 40) (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".totem/lessons.md")) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))))
(assert (= good "rm .totem/lessons/lesson-cd27a5b0.md"))
(assert (not (str.in_re good (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.++ (re.union (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (str.to_re "rm")) (str.to_re "rm")) (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) ((_ re.loop 0 40) (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".totem/lessons.md")) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~")))))))))
(check-sat)
(get-model)

