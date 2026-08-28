; ──────────────────────────────────────────────────────────────────────────
; O10 — deliberate timeout
;
; Deliberate timeout, fail closed: a nested re.inter chain over long ranges
; engineered past the budget. The ASSERTION is not about the answer — it
; is that the harness reports timeout/unknown and treats the obligation as
; NOT-PROVEN, with no pass-through.
;
; - The chain forces a witness whose length is a multiple of 3, 7 and 11 (so
;   of 231), not a multiple of 5 or 13, and at least 150 — a length no
;   string solver reaches by enumeration.
; - Satisfiable in principle at length 231; that is deliberate. A trivially
;   UNSAT instance could be refuted structurally and would not exercise the
;   budget.
; - Per-solver wall budget 10s (z3 -T:10, cvc5 --tlimit=10000). The harness
;   additionally kills the process at a hard outer bound so a solver that
;   ignores its own flag still fails closed.
; Expected (OBLIGATIONS.md): timeout on >=1 solver
; ──────────────────────────────────────────────────────────────────────────
(set-logic QF_SLIA)
(set-option :produce-models true)

(declare-const s String)

; ── check: engineered-past-the-budget (expect not-proven) ─────────────────────────────────
(assert (str.in_re s (re.inter (re.* ((_ re.loop 3 3) (re.range "a" "z"))) (re.* ((_ re.loop 7 7) (re.range "a" "z"))) (re.comp (re.* ((_ re.loop 5 5) (re.range "a" "z")))) (re.* ((_ re.loop 11 11) (re.range "a" "z"))) (re.comp (re.* ((_ re.loop 13 13) (re.range "a" "z")))) (re.++ ((_ re.loop 150 150) (re.range "a" "z")) (re.* (re.range "a" "z"))))))
(check-sat)
(get-model)

