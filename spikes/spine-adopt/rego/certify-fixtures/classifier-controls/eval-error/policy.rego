# Classifier control — the `eval-error-or-trap` blocked class.
#
# `regex.find_n` is the sharp builtin the ABI census already measured
# (artifacts/opa-abi-census.json § headline.hostPathConsequence): OPA does NOT
# compile it into the module, so the module DELEGATES it to the host, and
# `rust-opa-wasm`'s fixed `builtins::resolve` table carries an entry whose body is
# `bail!("not implemented")`. The module therefore LOADS fine and fails at CALL
# time — an evaluation error rather than an empty result set or a bad shape.
#
# Everything else here is deliberately well-formed: were the call to succeed, the
# result would be a defined object with exactly `violations` + `events`. The only
# thing wrong with this bundle is that evaluating it errors.

package totem.spike.certctl_eval_error

hits := regex.find_n("a", input.file, -1)

result := {"violations": [], "events": []} if {
	count(hits) >= 0
}
