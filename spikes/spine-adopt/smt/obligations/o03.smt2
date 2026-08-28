; ──────────────────────────────────────────────────────────────────────────
; O3 — exhaustiveness
;
; Severity vocabulary exhaustiveness: is every record severity in the closed
; set {error, warning}? Five specimen severities must be members; the
; negative control "info" must not be.
;
; - Severities read from the five specimen records under
;   spikes/spine-adopt/records/.
; - The negative control is what gives the check its teeth: without it, a
;   vocabulary regex of re.all would also pass all five.
; Expected (OBLIGATIONS.md): SAT x5, UNSAT control
; ──────────────────────────────────────────────────────────────────────────
(set-logic QF_SLIA)
(set-option :produce-models true)
(set-option :produce-unsat-cores true)

(declare-const sev String)

; ── check: severity-in-vocabulary:a-regex-lessons-rm-guard (expect sat) ─────────────────────────────────
(push 1)
(assert (= sev "error"))
(assert (str.in_re sev (re.union (str.to_re "error") (str.to_re "warning"))))
(check-sat)
(get-model)
(pop 1)

; ── check: severity-in-vocabulary:b-astgrep-flat-empty-catch (expect sat) ─────────────────────────────────
(push 1)
(assert (= sev "warning"))
(assert (str.in_re sev (re.union (str.to_re "error") (str.to_re "warning"))))
(check-sat)
(get-model)
(pop 1)

; ── check: severity-in-vocabulary:c-astgrep-compound-spawn-shell (expect sat) ─────────────────────────────────
(push 1)
(assert (= sev "error"))
(assert (str.in_re sev (re.union (str.to_re "error") (str.to_re "warning"))))
(check-sat)
(get-model)
(pop 1)

; ── check: severity-in-vocabulary:d-requires-line (expect sat) ─────────────────────────────────
(push 1)
(assert (= sev "warning"))
(assert (str.in_re sev (re.union (str.to_re "error") (str.to_re "warning"))))
(check-sat)
(get-model)
(pop 1)

; ── check: severity-in-vocabulary:e-exception-excludeglobs (expect sat) ─────────────────────────────────
(push 1)
(assert (= sev "error"))
(assert (str.in_re sev (re.union (str.to_re "error") (str.to_re "warning"))))
(check-sat)
(get-model)
(pop 1)

; ── check: negative-control:info-is-not-in-vocabulary (expect unsat) ─────────────────────────────────
(push 1)
(assert (! (= sev "info") :named sev-is-info))
(assert (! (str.in_re sev (re.union (str.to_re "error") (str.to_re "warning"))) :named sev-in-vocabulary))
(check-sat)
(get-unsat-core)
(pop 1)

