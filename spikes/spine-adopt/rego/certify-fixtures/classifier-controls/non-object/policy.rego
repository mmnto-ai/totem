# Classifier control — the `non-object` blocked class.
#
# A DEFINED result that is not an object at all. The entrypoint returns a
# one-entry result set holding a string, so this is not an empty set, not an
# error, and not a missing key — it is the shape check itself that has to fire.

package totem.spike.certctl_non_object

result := "certification must refuse a non-object result"
