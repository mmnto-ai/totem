function handleLegacy(input) {
  try { risky(input); } catch (e) { }
  return input;
}
