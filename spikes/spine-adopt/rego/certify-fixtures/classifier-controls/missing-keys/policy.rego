# Classifier control — the `missing-keys` blocked class.
#
# A defined OBJECT with `violations` but no `events`. "Absent = absent" (spec
# § Data model deltas): a lowering that stopped emitting `events` must never read
# as a record that emits none, so the missing key is a BLOCK and not an empty
# event stream.

package totem.spike.certctl_missing_keys

result := {"violations": []}
