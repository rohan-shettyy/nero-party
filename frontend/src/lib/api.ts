import { Party, Track } from "../types";

const API_URL = `${window.location.protocol}//${window.location.hostname}:3000`;

export async function createParty(input: {
  name: string;
  hostName: string;
  maxSongs?: number;
  songsPerPerson?: number;
  timeLimit?: string;
}) {
  return request<{ party: Party; sessionToken: string }>("/api/parties", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function joinParty(code: string, displayName: string, sessionToken?: string) {
  return request<{ party: Party; participantId: string; sessionToken: string }>(
    `/api/parties/${code}/join`,
    {
      method: "POST",
      body: JSON.stringify({ displayName, sessionToken }),
    },
  );
}

export async function getParty(code: string) {
  return request<{ party: Party }>(`/api/parties/${code}`);
}

export async function getSpotifyAuthUrl(state: string, codeChallenge: string, redirectUri: string) {
  return request<{ url: string }>(
    `/api/spotify/auth-url?state=${encodeURIComponent(state)}&codeChallenge=${encodeURIComponent(
      codeChallenge,
    )}&redirectUri=${encodeURIComponent(redirectUri)}`,
  );
}

export async function exchangeSpotifyCode(code: string, codeVerifier: string, redirectUri: string) {
  return request<{
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  }>("/api/spotify/token", {
    method: "POST",
    body: JSON.stringify({ code, codeVerifier, redirectUri }),
  });
}

export async function searchTracks(query: string) {
  return request<{ tracks: Track[] }>(`/api/spotify/search?q=${encodeURIComponent(query)}`);
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json", ...init.headers },
    ...init,
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error ?? "Request failed");
  }
  return data;
}
