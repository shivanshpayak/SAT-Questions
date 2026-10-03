export function buildOverride(question, patch) {
  const override = {};
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string" && value.trim() === "") continue;
    override[key] = typeof value === "string" ? value.trim() : value;
  }
  return override;
}

export async function saveOverrides(overrides, postJson) {
  return postJson("api/overrides", overrides);
}
