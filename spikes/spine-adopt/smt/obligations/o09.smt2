; ──────────────────────────────────────────────────────────────────────────
; O9 — regex/string constraints
;
; Word-boundary desugar equivalence: is a \b-desugared RE2 form equivalent
; to the intended language on the line alphabet? The test is
; symmetric-difference emptiness — UNSAT means equivalent, SAT hands back
; a distinguishing witness.
;
; - Subject pattern: specimen (a)'s target
;   \b(?:git\s+rm|rm)\s+[^\n]{0,40}\.totem/lessons\.md\b.
; - Check A compares the intended desugar against a structurally different
;   re.comp-framed form. It is a genuine equivalence proof, and it doubles as
;   the check that lang.rs's hand-enumerated non-word ranges really are the
;   complement of the word class within the alphabet.
; - Check B compares the intended desugar against the NAIVE one that maps \b
;   to 'a non-word character'. A witness here is the census finding: the
;   shortcut is not language-preserving at line edges.
; - Both checks omit an explicit line-alphabet assertion: every language
;   compared is a subset of the alphabet already, so a string outside it lies
;   in NEITHER side of the xor and cannot be a witness. Equivalence proved
;   here therefore holds on the line alphabet exactly as the table words it.
; Expected (OBLIGATIONS.md): UNSAT (equivalent) or witness
; ──────────────────────────────────────────────────────────────────────────
(set-logic QF_SLIA)
(set-option :produce-models true)
(set-option :produce-unsat-cores true)

(declare-const s String)

; ── check: A:intended-equals-complement-framed (expect unsat) ─────────────────────────────────
(push 1)
(assert (! (xor (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.++ (re.union (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (str.to_re "rm")) (str.to_re "rm")) (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) ((_ re.loop 0 40) (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".totem/lessons.md")) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))) (str.in_re s (re.++ (re.inter (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.comp (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (re.range "0" "9") (re.range "A" "Z") (re.range "a" "z") (str.to_re "_"))))) (re.++ (re.union (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (str.to_re "rm")) (str.to_re "rm")) (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) ((_ re.loop 0 40) (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".totem/lessons.md")) (re.inter (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.comp (re.++ (re.union (re.range "0" "9") (re.range "A" "Z") (re.range "a" "z") (str.to_re "_")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))))) :named symmetric-difference))
(check-sat)
(get-unsat-core)
(pop 1)

; ── check: B:intended-versus-naive-desugar (expect measured) ─────────────────────────────────
(push 1)
(assert (xor (str.in_re s (re.++ (re.union (str.to_re "") (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")))) (re.++ (re.union (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (str.to_re "rm")) (str.to_re "rm")) (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) ((_ re.loop 0 40) (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".totem/lessons.md")) (re.union (str.to_re "") (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))) (str.in_re s (re.++ (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~"))) (re.++ (re.union (re.++ (str.to_re "git") (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) (str.to_re "rm")) (str.to_re "rm")) (re.+ (re.union (str.to_re " ") (str.to_re "\u{9}"))) ((_ re.loop 0 40) (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re ".totem/lessons.md")) (re.++ (re.union (str.to_re "\u{9}") (re.range " " "/") (re.range ":" "@") (re.range "[" "^") (str.to_re "`") (re.range "{" "~")) (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))))
(check-sat)
(get-model)
(pop 1)

