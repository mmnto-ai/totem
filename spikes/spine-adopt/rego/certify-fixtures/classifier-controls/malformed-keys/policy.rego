# Classifier control — the `extra-or-malformed-keys` blocked class, MALFORMED arm.
#
# Exactly the two required keys, but `violations` is a STRING. The key-set check
# alone would pass this; it is the per-key type check that has to fire, which is
# why the class covers malformed values as well as surplus keys.

package totem.spike.certctl_malformed_keys

result := {"violations": "none", "events": []}
