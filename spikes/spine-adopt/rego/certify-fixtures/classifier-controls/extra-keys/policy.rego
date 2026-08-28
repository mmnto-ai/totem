# Classifier control — the `extra-or-malformed-keys` blocked class, EXTRA arm.
#
# Both required keys are present and well-typed, and a third key rides along.
# PASS is "exactly the keys `violations` + `events`" (spec § Actuator slice 1),
# so an unrecognised key is a block: a certificate must attest a known shape, not
# a superset whose extra member no host agrees how to read.

package totem.spike.certctl_extra_keys

result := {"violations": [], "events": [], "verdict": "clean"}
