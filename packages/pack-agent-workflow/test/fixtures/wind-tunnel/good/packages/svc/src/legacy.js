function handleLegacy(input) {
  try { risky(input); } catch (e) { console.warn("legacy path failed", e); }
  return input;
}
