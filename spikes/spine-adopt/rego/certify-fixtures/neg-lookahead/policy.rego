# HAND-AUTHORED negative conformance fixture (spec § Actuator slice 5).
# NOT produced by src/lower.mts — § Lowering 4's engine gate rejects this pattern
# at lowering time, which is the whole point: this fixture tests the layer BELOW
# the lowerer, where a policy reaches `opa build` with an RE2-inexpressible
# pattern intact.
#
# Provenance: corpus rule e64911592b774cc6 (pack-agent-workflow), census class
# `lookaround`. The literal below is the JSON-escaped form of that rule's pattern,
# asserted byte-exact against artifacts/expressibility-census.json by src/certify.mts.
#
# Measured behaviour of pinned OPA v1.20.0 on this file:
#   opa build -t wasm      exit 0, a valid module          (the FAIL-OPEN)
#   opa eval --strict…     exit 2, "regex.match: error parsing regexp:
#                          invalid or unsupported Perl syntax: `(?!`"
#   the built module       `patterns_compile` is undefined => `result` is
#                          undefined => the entrypoint returns an EMPTY RESULT SET,
#                          with no trap and no opa_abort
#
# Certification must therefore BLOCK this bundle with the typed reason
# `empty-result-set`, and every host must produce an error row for it.

package totem.spike.certfix_neg_lookahead

rule_id := "e64911592b774cc6"

severity := "warning"

normalized_file := replace(input.file, "\\", "/")

positive_globs := [
	"^(?:[^/]+/)*[^/]*\\.ts$",
	"^(?:[^/]+/)*[^/]*\\.yml$",
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

# The § Lowering 2 structural-strictness probe, verbatim in shape. The third
# literal is the inexpressible one: RE2 rejects `(?!` at COMPILE, so
# `regex.match` is undefined here, so `patterns_compile` is undefined, so
# `result` is undefined.
patterns_compile if {
	is_boolean(regex.match("^(?:[^/]+/)*[^/]*\\.ts$", ""))
	is_boolean(regex.match("^(?:[^/]+/)*[^/]*\\.yml$", ""))
	is_boolean(regex.match("(?:lint|test|typecheck|audit|verify|gate|check)(?:(?!\\|\\|).)*\\|\\|\\s*true", ""))
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
	regex.match("(?:lint|test|typecheck|audit|verify|gate|check)(?:(?!\\|\\|).)*\\|\\|\\s*true", input.lines[i])
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
