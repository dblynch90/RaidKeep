/** Convert realm slug/name to display format: "Stormrage" from "stormrage" or "storm-rage" */
export function capitalizeRealm(realm: string): string {
  if (!realm) return "";
  return realm
    .split(/[- ]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Convert realm display name to URL slug: "storm-rage" from "Storm Rage" */
export function toRealmSlug(realm: string): string {
  if (!realm) return "";
  return realm.toLowerCase().replace(/\s+/g, "-");
}
