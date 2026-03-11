import { useSearchParams } from "react-router-dom";
import { toRealmSlug } from "../utils/realm";

const DEFAULT_SERVER_TYPE = "TBC Anniversary";

export function useGuildParams() {
  const [searchParams] = useSearchParams();
  const realm = searchParams.get("realm") ?? "";
  const guildName = searchParams.get("guild_name") ?? "";
  const serverType = searchParams.get("server_type") ?? DEFAULT_SERVER_TYPE;
  const realmSlug = toRealmSlug(realm);
  const isValid = Boolean(realm && guildName);
  return { realm, guildName, serverType, realmSlug, isValid };
}
