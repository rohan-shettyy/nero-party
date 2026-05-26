export type PartyStatus = "LOBBY" | "ACTIVE" | "ENDED";
export type TimeLimit = "NONE" | "ONE_HOUR" | "TWO_HOURS" | "THREE_HOURS";
export type SongStatus = "QUEUED" | "PLAYING" | "PLAYED" | "SKIPPED" | "UNPLAYABLE";
export type ReactionType = "FIRE" | "VIBE" | "MEH" | "SKIP" | "GOAT";

export type TrackInput = {
  spotifyTrackId: string;
  spotifyUri: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  albumArtUrl: string;
  previewUrl?: string | null;
};

export type ScoreInput = {
  participantCount: number;
  durationMs: number;
  skippedAtMs?: number | null;
  votes: Array<{ tokens: number }>;
  reactions: Array<{ type: ReactionType }>;
};

export type ScoreBreakdown = {
  finalScore: number;
  tokenScore: number;
  participationBonus: number;
  goatBonus: number;
  skipPenaltyApplied: boolean;
};
