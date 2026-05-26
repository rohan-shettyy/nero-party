export type PartyStatus = "LOBBY" | "ACTIVE" | "ENDED";
export type ReactionType = "FIRE" | "VIBE" | "MEH" | "SKIP" | "GOAT";

export type Track = {
  spotifyTrackId: string;
  spotifyUri: string;
  title: string;
  artist: string;
  album: string;
  durationMs: number;
  albumArtUrl: string;
  previewUrl?: string | null;
};

export type Participant = {
  id: string;
  displayName: string;
  isHost: boolean;
  isAway: boolean;
};

export type Song = Track & {
  id: string;
  participantId: string;
  status: "QUEUED" | "PLAYING" | "PLAYED" | "SKIPPED" | "UNPLAYABLE";
  submissionOrder: number;
  finalScore?: number | null;
  tokenScore?: number | null;
  participationBonus?: number | null;
  goatBonus?: number | null;
  skipPenaltyApplied?: boolean;
  voteTotal: number;
  voterCount: number;
  submittedBy: string;
  reactionsByType: Partial<Record<ReactionType, number>>;
  votes?: Array<{ participantId: string; tokens: number }>;
};

export type Party = {
  id: string;
  code: string;
  name: string;
  status: PartyStatus;
  maxSongs: number;
  songsPerPerson: number;
  timeLimit: "NONE" | "ONE_HOUR" | "TWO_HOURS" | "THREE_HOURS";
  currentSongId?: string | null;
  playbackStartedAt?: string | null;
  playbackPausedAt?: string | null;
  elapsedMs: number;
  joinUrl: string;
  participants: Participant[];
  activeParticipantCount: number;
  songs: Song[];
  events: Array<{ id: string; message: string; type: string; createdAt: string }>;
};

export type Session = {
  participantId: string;
  sessionToken: string;
  displayName: string;
};
