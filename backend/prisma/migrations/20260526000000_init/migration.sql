CREATE TABLE "Party" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "code" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'LOBBY',
  "maxSongs" INTEGER NOT NULL DEFAULT 15,
  "songsPerPerson" INTEGER NOT NULL DEFAULT 3,
  "timeLimit" TEXT NOT NULL DEFAULT 'NONE',
  "currentSongId" TEXT,
  "playbackStartedAt" DATETIME,
  "playbackPausedAt" DATETIME,
  "elapsedMs" INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" DATETIME,
  "endedAt" DATETIME
);

CREATE UNIQUE INDEX "Party_code_key" ON "Party"("code");

CREATE TABLE "Participant" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "partyId" TEXT NOT NULL,
  "displayName" TEXT NOT NULL,
  "isHost" BOOLEAN NOT NULL DEFAULT false,
  "isRemoved" BOOLEAN NOT NULL DEFAULT false,
  "isAway" BOOLEAN NOT NULL DEFAULT false,
  "sessionToken" TEXT NOT NULL,
  "socketId" TEXT,
  "spotifyUserId" TEXT,
  "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reclaimExpiresAt" DATETIME,
  CONSTRAINT "Participant_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Participant_sessionToken_key" ON "Participant"("sessionToken");

CREATE TABLE "Song" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "partyId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "spotifyTrackId" TEXT NOT NULL,
  "spotifyUri" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "artist" TEXT NOT NULL,
  "album" TEXT NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "albumArtUrl" TEXT NOT NULL,
  "previewUrl" TEXT,
  "status" TEXT NOT NULL DEFAULT 'QUEUED',
  "submissionOrder" INTEGER NOT NULL,
  "startedAt" DATETIME,
  "endedAt" DATETIME,
  "skippedAtMs" INTEGER,
  "finalScore" REAL,
  "tokenScore" REAL,
  "participationBonus" REAL,
  "goatBonus" REAL,
  "skipPenaltyApplied" BOOLEAN NOT NULL DEFAULT false,
  "isPlayable" BOOLEAN NOT NULL DEFAULT true,
  CONSTRAINT "Song_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Song_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Song_partyId_spotifyTrackId_key" ON "Song"("partyId", "spotifyTrackId");

CREATE TABLE "Vote" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "tokens" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "Vote_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Vote_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Vote_songId_participantId_key" ON "Vote"("songId", "participantId");

CREATE TABLE "Reaction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "songId" TEXT NOT NULL,
  "participantId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Reaction_songId_fkey" FOREIGN KEY ("songId") REFERENCES "Song" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Reaction_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "Participant" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "PartyEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "partyId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartyEvent_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
