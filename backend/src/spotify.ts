import { env } from "./env.js";

const SPOTIFY_ACCOUNTS = "https://accounts.spotify.com";
const SPOTIFY_API = "https://api.spotify.com/v1";
let appAccessToken: { token: string; expiresAt: number } | null = null;

export function getSpotifyAuthUrl(state: string, codeChallenge: string, redirectUri = env.SPOTIFY_REDIRECT_URI) {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.SPOTIFY_CLIENT_ID,
    scope:
      "streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state",
    redirect_uri: validateRedirectUri(redirectUri),
    state,
    code_challenge_method: "S256",
    code_challenge: codeChallenge,
  });

  return `${SPOTIFY_ACCOUNTS}/authorize?${params.toString()}`;
}

export async function exchangeSpotifyCode(code: string, codeVerifier: string, redirectUri = env.SPOTIFY_REDIRECT_URI) {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: validateRedirectUri(redirectUri),
    client_id: env.SPOTIFY_CLIENT_ID,
    code_verifier: codeVerifier,
  });

  return spotifyTokenRequest(body);
}

export async function refreshSpotifyToken(refreshToken: string) {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: env.SPOTIFY_CLIENT_ID,
  });

  return spotifyTokenRequest(body);
}

async function spotifyTokenRequest(body: URLSearchParams) {
  const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Spotify token request failed: ${response.status} ${detail}`);
  }

  return response.json();
}

function validateRedirectUri(redirectUri: string) {
  const allowed = new Set([
    env.SPOTIFY_REDIRECT_URI,
    "http://127.0.0.1:5173/spotify/callback",
    "http://localhost:5173/spotify/callback",
  ]);
  if (!allowed.has(redirectUri)) {
    throw new Error("Unsupported Spotify redirect URI");
  }
  return redirectUri;
}

export async function searchSpotifyTracks(query: string, accessToken?: string) {
  const token = accessToken ?? (await getAppAccessToken());
  const params = new URLSearchParams({ q: query, type: "track", limit: "10" });
  const response = await fetch(`${SPOTIFY_API}/search?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error(`Spotify search failed: ${response.status}`);
  }

  const data = await response.json();
  return data.tracks.items.map((track: any) => ({
    spotifyTrackId: track.id,
    spotifyUri: track.uri,
    title: track.name,
    artist: track.artists.map((artist: { name: string }) => artist.name).join(", "),
    album: track.album.name,
    durationMs: track.duration_ms,
    albumArtUrl: track.album.images?.[0]?.url ?? "",
    previewUrl: track.preview_url,
  }));
}

async function getAppAccessToken() {
  if (appAccessToken && appAccessToken.expiresAt > Date.now() + 30_000) {
    return appAccessToken.token;
  }
  if (!env.SPOTIFY_CLIENT_ID || !env.SPOTIFY_CLIENT_SECRET) {
    throw new Error("Spotify client credentials are not configured");
  }

  const credentials = Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${SPOTIFY_ACCOUNTS}/api/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!response.ok) {
    throw new Error(`Spotify app token request failed: ${response.status}`);
  }

  const data = await response.json();
  appAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return appAccessToken.token;
}
