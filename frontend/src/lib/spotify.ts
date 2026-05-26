import { exchangeSpotifyCode, getSpotifyAuthUrl } from "./api";

const TOKEN_KEY = "nero.spotify";
const VERIFIER_KEY = "nero.pkce.verifier";
const POST_AUTH_PATH_KEY = "nero.pkce.postAuthPath";
const REDIRECT_URI_KEY = "nero.pkce.redirectUri";

export type SpotifyTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

declare global {
  interface Window {
    Spotify?: {
      Player: new (options: {
        name: string;
        getOAuthToken: (callback: (token: string) => void) => void;
        volume?: number;
      }) => SpotifyPlayer;
    };
    onSpotifyWebPlaybackSDKReady?: () => void;
  }
}

type SpotifyPlayer = {
  addListener: (event: string, callback: (payload: any) => void) => void;
  connect: () => Promise<boolean>;
};

export function getStoredSpotifyTokens(): SpotifyTokens | null {
  const raw = localStorage.getItem(TOKEN_KEY);
  return raw ? (JSON.parse(raw) as SpotifyTokens) : null;
}

export function storeSpotifyTokens(tokens: SpotifyTokens) {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(tokens));
}

export async function startSpotifyLogin() {
  const verifier = randomString(64);
  const challenge = await pkceChallenge(verifier);
  const state = randomString(24);
  const redirectUri = `${window.location.origin}/spotify/callback`;
  sessionStorage.setItem(VERIFIER_KEY, verifier);
  sessionStorage.setItem(POST_AUTH_PATH_KEY, `${window.location.pathname}${window.location.search}`);
  sessionStorage.setItem(REDIRECT_URI_KEY, redirectUri);
  const { url } = await getSpotifyAuthUrl(state, challenge, redirectUri);
  window.location.href = url;
}

export async function finishSpotifyLoginFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  if (!code) return null;
  const verifier = sessionStorage.getItem(VERIFIER_KEY);
  if (!verifier) return null; // Already processed or missing
  sessionStorage.removeItem(VERIFIER_KEY); // Remove immediately to act as a lock against double-execution in StrictMode

  const redirectUri = sessionStorage.getItem(REDIRECT_URI_KEY) ?? `${window.location.origin}/spotify/callback`;
  const response = await exchangeSpotifyCode(code, verifier, redirectUri);
  const tokens = {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: Date.now() + response.expires_in * 1000,
  };
  storeSpotifyTokens(tokens);
  const postAuthPath = sessionStorage.getItem(POST_AUTH_PATH_KEY) ?? "/";
  sessionStorage.removeItem(POST_AUTH_PATH_KEY);
  sessionStorage.removeItem(REDIRECT_URI_KEY);
  window.history.replaceState({}, "", postAuthPath);
  return tokens;
}

export async function createSpotifyPlayer(accessToken: string) {
  await loadSpotifySdk();
  return new Promise<{ player: SpotifyPlayer; deviceId: string }>((resolve, reject) => {
    if (!window.Spotify) {
      reject(new Error("Spotify SDK did not load"));
      return;
    }
    const player = new window.Spotify.Player({
      name: "Nero Party",
      getOAuthToken: (callback) => callback(accessToken),
      volume: 0.8,
    });

    player.addListener("ready", ({ device_id }: { device_id: string }) => {
      resolve({ player, deviceId: device_id });
    });
    player.addListener("initialization_error", reject);
    player.addListener("authentication_error", reject);
    player.addListener("account_error", reject);
    void player.connect();
  });
}

export async function playSpotifyTrack(accessToken: string, deviceId: string, spotifyUri: string, positionMs: number) {
  await fetch(`https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ uris: [spotifyUri], position_ms: Math.max(0, Math.floor(positionMs)) }),
  });
}

export async function pauseSpotifyPlayback(accessToken: string, deviceId: string) {
  await fetch(`https://api.spotify.com/v1/me/player/pause?device_id=${encodeURIComponent(deviceId)}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

async function loadSpotifySdk() {
  if (window.Spotify) return;
  await new Promise<void>((resolve) => {
    window.onSpotifyWebPlaybackSDKReady = () => resolve();
    const script = document.createElement("script");
    script.src = "https://sdk.scdn.co/spotify-player.js";
    script.async = true;
    document.body.appendChild(script);
  });
}

async function pkceChallenge(verifier: string) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomString(length: number) {
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);
  return Array.from(values, (value) => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"[value % 62]).join("");
}
