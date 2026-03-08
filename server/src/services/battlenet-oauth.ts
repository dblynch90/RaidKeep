/**
 * Battle.net OAuth 2.0 helpers for authorization code flow.
 * Docs: https://develop.battle.net/documentation/guides/using-oauth/authorization-code-flow
 */

const REGIONS = ["us", "eu", "kr", "tw"] as const;
type Region = (typeof REGIONS)[number];

function getOAuthBase(region: Region): string {
  return `https://${region}.battle.net`;
}

export function getAuthorizeUrl(
  region: Region,
  clientId: string,
  redirectUri: string,
  state: string
): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "wow.profile openid",
    state,
  });
  return `${getOAuthBase(region)}/oauth/authorize?${params}`;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  id_token?: string;
}

export async function exchangeCodeForToken(
  region: Region,
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<TokenResponse> {
  const url = `${getOAuthBase(region)}/oauth/token`;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    scope: "wow.profile openid",
  });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${auth}`,
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${err}`);
  }
  return res.json() as Promise<TokenResponse>;
}

/**
 * Fetch Battle.net account profile (BattleTag) using the user's access token.
 * Endpoint: https://oauth.battle.net/userinfo
 */
export async function fetchBattleNetUserInfo(accessToken: string, _region: Region): Promise<{ battletag?: string }> {
  const res = await fetch("https://oauth.battle.net/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) return {};
  const data = (await res.json()) as { battletag?: string };
  return { battletag: data.battletag };
}

/**
 * Decode JWT payload without verification (we trust it came from our token exchange).
 * Returns the payload object including sub (Battle.net account ID).
 */
export function decodeIdToken(idToken: string): { sub?: string } {
  try {
    const parts = idToken.split(".");
    if (parts.length !== 3) throw new Error("Invalid JWT");
    const payload = parts[1];
    const decoded = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return JSON.parse(decoded) as { sub?: string };
  } catch {
    return {};
  }
}
