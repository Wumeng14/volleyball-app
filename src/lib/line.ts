/** LINE Login (OAuth 2.1) 流程工具。Channel 設定見 README。 */

const LINE_AUTH_URL = "https://access.line.me/oauth2/v2.1/authorize";
const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_PROFILE_URL = "https://api.line.me/v2/profile";

export function lineRedirectUri() {
  return `${process.env.NEXT_PUBLIC_APP_URL}/auth/line/callback`;
}

export function buildLineAuthUrl(state: string) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env.LINE_CHANNEL_ID!,
    redirect_uri: lineRedirectUri(),
    state,
    scope: "profile openid",
  });
  return `${LINE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeLineCode(code: string) {
  const res = await fetch(LINE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: lineRedirectUri(),
      client_id: process.env.LINE_CHANNEL_ID!,
      client_secret: process.env.LINE_CHANNEL_SECRET!,
    }),
  });
  if (!res.ok) {
    throw new Error(`LINE token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as { access_token: string; id_token?: string };
}

export async function fetchLineProfile(accessToken: string) {
  const res = await fetch(LINE_PROFILE_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`LINE profile fetch failed: ${res.status}`);
  }
  return (await res.json()) as {
    userId: string;
    displayName: string;
    pictureUrl?: string;
  };
}
