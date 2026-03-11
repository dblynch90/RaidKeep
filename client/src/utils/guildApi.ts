/** Build query string for guild-scoped API endpoints */
export function guildQueryString(params: {
  realm: string;
  guildName: string;
  serverType: string;
}): string {
  const realmSlug = params.realm.toLowerCase().replace(/\s+/g, "-");
  return `realm=${encodeURIComponent(realmSlug)}&guild_name=${encodeURIComponent(params.guildName)}&server_type=${encodeURIComponent(params.serverType)}`;
}

/** Build query string when realm is already a slug (for "realm" param) */
export function guildQueryStringFromSlug(params: {
  realmSlug: string;
  guildName: string;
  serverType: string;
}): string {
  return `realm=${encodeURIComponent(params.realmSlug)}&guild_name=${encodeURIComponent(params.guildName)}&server_type=${encodeURIComponent(params.serverType)}`;
}

/** Build query string for endpoints using guild_realm param (raider-roster, raid-teams) */
export function guildRealmQueryString(params: {
  realm: string;
  guildName: string;
  serverType: string;
}): string {
  return `guild_realm=${encodeURIComponent(params.realm)}&guild_name=${encodeURIComponent(params.guildName)}&server_type=${encodeURIComponent(params.serverType)}`;
}
