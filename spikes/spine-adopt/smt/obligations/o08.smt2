; ──────────────────────────────────────────────────────────────────────────
; O8 — regex/string constraints
;
; Self-suppressing pattern: does L(pattern) intersect the
; suppression-directive language .*totem-ignore.*? SAT on the offender means
; the rule matches its own suppression comment; UNSAT on the control means a
; clean pattern cannot.
;
; - CONSTRUCTED pair. Offender //\s*totem-[a-z-]+ is the #2680 shape: a
;   comment-directive matcher whose language swallows '// totem-ignore'.
; - Control console\.log\( is a matcher whose every member is a fixed
;   twelve-character span that cannot contain the marker.
; - The subject is the MATCHED SPAN, not the whole line — see the code
;   comment; under line semantics both halves would be trivially SAT and the
;   obligation would prove nothing.
; Expected (OBLIGATIONS.md): SAT offender, UNSAT control
; ──────────────────────────────────────────────────────────────────────────
(set-logic QF_SLIA)
(set-option :produce-models true)
(set-option :produce-unsat-cores true)

(declare-const s String)

; ── check: offender-span-can-be-a-suppression-directive (expect sat) ─────────────────────────────────
(push 1)
(assert (str.in_re s (re.++ (str.to_re "//") (re.* (re.union (str.to_re " ") (str.to_re "\u{9}"))) (str.to_re "totem-") (re.+ (re.union (re.range "a" "z") (str.to_re "-"))))))
(assert (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "totem-ignore") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))))
(check-sat)
(get-model)
(pop 1)

; ── check: control-span-cannot (expect unsat) ─────────────────────────────────
(push 1)
(assert (! (str.in_re s (str.to_re "console.log(")) :named control-pattern-membership))
(assert (! (str.in_re s (re.++ (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))) (str.to_re "totem-ignore") (re.* (re.union (str.to_re "\u{9}") (re.range " " "~"))))) :named suppression-directive-membership))
(check-sat)
(get-unsat-core)
(pop 1)

