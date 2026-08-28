# HAND-AUTHORED control for the § Actuator slice 4 only-exported-result-path
# assertion: "certification FAILS a bundle whose entrypoint set is not exactly
# one `<pkg>/result` (no ungated side entrypoints)."
#
# The control is built for TWO entrypoints:
#
#   totem/spike/certfix_two_entrypoints/result
#   totem/spike/certfix_two_entrypoints/side_result
#
# BOTH are deliberately well-formed — each returns a defined object with exactly
# the keys `violations` and `events`, so each classifies PASS on its own. The
# bundle is therefore blocked by the entrypoint-set assertion and by NOTHING
# ELSE, which is what makes it a proof that the assertion has teeth rather than a
# bundle that would have failed anyway.
#
# `side_result` is the hazard in miniature: a second exported path that reaches
# the same violation set WITHOUT passing through the `patterns_compile` /
# `facts_wellformed` guards. It is exactly the ungated side entrypoint the ruled
# text names, and it is why the guard living in "the only exported result path"
# is only meaningful if there IS only one exported result path.

package totem.spike.certfix_two_entrypoints

rule_id := "certfix-two-entrypoints"

severity := "warning"

patterns_compile if {
	is_boolean(regex.match("^certify/", ""))
}

facts_wellformed if {
	is_string(input.file)
	is_array(input.lines)
	is_array(input.astMatches)
}

violations contains v if {
	some i, _ in input.lines
	regex.match("^certify/", input.lines[i])
	v := {"rule_id": rule_id, "line_number": i + 1, "ordinal": 0}
}

events contains e if {
	some i, _ in input.lines
	regex.match("^certify/", input.lines[i])
	e := {"kind": "trigger", "line_number": i + 1, "ordinal": 0}
}

# The GUARDED path.
result := {"violations": violations, "events": events} if {
	patterns_compile
	facts_wellformed
}

# The UNGATED side path — same violations, no guards. Well-formed on the
# sentinel, which is the point.
side_result := {"violations": violations, "events": events}
