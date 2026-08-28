# HAND-AUTHORED negative conformance fixture (spec § Actuator slice 5).
# NOT produced by src/lower.mts — § Lowering 4's engine gate rejects this pattern
# at lowering time.
#
# Provenance: corpus rule 80192e6ac2a1dd3c (root corpus), census class
# `backreference` — the ONLY backreference in the 226-pattern corpus. The literal
# below is the JSON-escaped form of that rule's pattern, asserted byte-exact
# against artifacts/expressibility-census.json by src/certify.mts.
#
# Note the escaping layers, which are the census's hazard (ii) in miniature: the
# Rego source spells the backreference `\\1`, which is a Rego string escape for a
# single backslash followed by `1`, which is what RE2 then rejects. Written
# verbatim it would be an unknown Rego escape and the file would not parse at all
# — a different failure, at a different layer, proving nothing about eval.
#
# Measured behaviour of pinned OPA v1.20.0 on this file:
#   opa build -t wasm      exit 0, a valid module          (the FAIL-OPEN)
#   opa eval --strict…     exit 2, "regex.match: error parsing regexp:
#                          invalid escape sequence: `\1`"
#   the built module       EMPTY RESULT SET, no trap, no opa_abort
#
# Certification must BLOCK with `empty-result-set`; every host must error.

package totem.spike.certfix_backreference

rule_id := "80192e6ac2a1dd3c"

severity := "error"

normalized_file := replace(input.file, "\\", "/")

positive_globs := [
	"^(?:[^/]+/)*[^/]*\\.ts$",
	"^(?:[^/]+/)*[^/]*\\.md$",
]

exclude_globs := []

positive_match if {
	some g in positive_globs
	regex.match(g, normalized_file)
}

exclude_match if {
	some g in exclude_globs
	regex.match(g, normalized_file)
}

in_scope if {
	positive_match
	not exclude_match
}

patterns_compile if {
	is_boolean(regex.match("^(?:[^/]+/)*[^/]*\\.ts$", ""))
	is_boolean(regex.match("^(?:[^/]+/)*[^/]*\\.md$", ""))
	is_boolean(regex.match("\\bmodel\\w*\\b.*(['\"\\/])\\^?\\[[a-zA-Z0-9\\-_]+\\][*+]\\$?\\1", ""))
}

facts_wellformed if {
	is_string(input.file)
	is_array(input.lines)
	is_array(input.astMatches)
	count([1 | some l in input.lines; is_string(l)]) == count(input.lines)
	count([1 | some m in input.astMatches; ast_match_wellformed(m)]) == count(input.astMatches)
}

ast_match_wellformed(m) if {
	is_number(m.lineNumber)
	is_string(m.lineText)
	is_string(m.startLineText)
}

same_line_markers := [
	"totem-ignore",
	"totem-context:",
	"shield-context:",
]

preceding_line_markers := [
	"totem-ignore-next-line",
	"totem-context:",
]

suppressed(i) if {
	some m in same_line_markers
	contains(input.lines[i], m)
}

suppressed(i) if {
	i > 0
	some m in preceding_line_markers
	contains(input.lines[i - 1], m)
}

target_hit(i) if {
	regex.match("\\bmodel\\w*\\b.*(['\"\\/])\\^?\\[[a-zA-Z0-9\\-_]+\\][*+]\\$?\\1", input.lines[i])
}

violations contains v if {
	in_scope
	some i, _ in input.lines
	target_hit(i)
	not suppressed(i)
	v := {"rule_id": rule_id, "line_number": i + 1, "ordinal": 0}
}

events contains e if {
	in_scope
	some i, _ in input.lines
	target_hit(i)
	not suppressed(i)
	e := {"kind": "trigger", "line_number": i + 1, "ordinal": 0}
}

events contains e if {
	in_scope
	some i, _ in input.lines
	target_hit(i)
	suppressed(i)
	e := {"kind": "suppress", "line_number": i + 1, "ordinal": 0}
}

result := {"violations": violations, "events": events} if {
	patterns_compile
	facts_wellformed
}
