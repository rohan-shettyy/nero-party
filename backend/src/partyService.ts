import { PrismaClient } from "@prisma/client";
import { randomUUID } from "crypto";
import { calculateVibeScore } from "./score.js";
import { env } from "./env.js";
import { ReactionType, TimeLimit, TrackInput } from "./types.js";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createPartyService(prisma: PrismaClient) {
  async function serializeParty(code: string) {
    const party = await prisma.party.findUnique({
      where: { code: normalizeCode(code) },
      include: {
        participants: {
          where: { isRemoved: false },
          orderBy: { joinedAt: "asc" },
        },
        songs: {
          orderBy: { submissionOrder: "asc" },
          include: {
            participant: true,
            votes: true,
            reactions: true,
          },
        },
        events: { orderBy: { createdAt: "desc" }, take: 8 },
      },
    });

    if (!party) return null;

    const activeParticipants = party.participants.filter((participant) => !participant.isAway);
    const currentSong = party.songs.find((song) => song.id === party.currentSongId) ?? null;
    const songs = party.songs.map((song) => ({
      ...song,
      voteTotal: song.votes.reduce((sum, vote) => sum + vote.tokens, 0),
      voterCount: song.votes.filter((vote) => vote.tokens > 0).length,
      reactionsByType: summarizeReactions(song.reactions),
      submittedBy: song.participant.displayName,
      votes: song.votes.map((v) => ({ participantId: v.participantId, tokens: v.tokens })),
      reactions: undefined,
      participant: undefined,
    }));

    return {
      ...party,
      activeParticipantCount: activeParticipants.length,
      joinUrl: `${env.FRONTEND_ORIGIN}/join/${party.code}`,
      currentSong,
      songs,
      participants: party.participants.map((participant) => ({
        id: participant.id,
        displayName: participant.displayName,
        isHost: participant.isHost,
        isAway: participant.isAway,
        joinedAt: participant.joinedAt,
      })),
    };
  }

  async function createParty(input: {
    name: string;
    hostName: string;
    maxSongs?: number;
    songsPerPerson?: number;
    timeLimit?: TimeLimit;
  }) {
    if (!input.name.trim()) throw new Error("Party name is required");
    if (!input.hostName.trim()) throw new Error("Host display name is required");

    const code = await generateUniqueCode(prisma);
    const sessionToken = randomUUID();
    const party = await prisma.party.create({
      data: {
        code,
        name: input.name.trim(),
        maxSongs: normalizeLimit(input.maxSongs ?? 15, 5, 30),
        songsPerPerson: normalizeLimit(input.songsPerPerson ?? 3, 1, 5),
        timeLimit: input.timeLimit ?? "NONE",
        participants: {
          create: {
            displayName: input.hostName.trim(),
            isHost: true,
            sessionToken,
          },
        },
        events: {
          create: { type: "party_created", message: `${input.hostName.trim()} created the party.` },
        },
      },
    });

    return { party: await serializeParty(party.code), sessionToken };
  }

  async function joinParty(code: string, displayName: string, sessionToken?: string) {
    const party = await prisma.party.findUnique({
      where: { code: normalizeCode(code) },
      include: { participants: true },
    });
    if (!party) throw new Error("Party not found");
    if (!displayName.trim()) throw new Error("Display name is required");

    const returning = sessionToken
      ? party.participants.find(
          (participant) =>
            participant.sessionToken === sessionToken &&
            !participant.isRemoved &&
            (!participant.reclaimExpiresAt || participant.reclaimExpiresAt > new Date()),
        )
      : null;

    const participant = returning
      ? await prisma.participant.update({
          where: { id: returning.id },
          data: { isAway: false, lastSeenAt: new Date(), reclaimExpiresAt: null },
        })
      : await prisma.participant.create({
          data: {
            partyId: party.id,
            displayName: displayName.trim(),
            sessionToken: randomUUID(),
          },
        });

    await prisma.partyEvent.create({
      data: {
        partyId: party.id,
        type: "participant_joined",
        message: `${participant.displayName} joined the party.`,
      },
    });

    return {
      party: await serializeParty(party.code),
      participantId: participant.id,
      sessionToken: participant.sessionToken,
    };
  }

  async function updateSettings(
    code: string,
    participantId: string,
    input: {
      maxSongs?: number;
      songsPerPerson?: number;
      timeLimit?: TimeLimit;
    },
  ) {
    const party = await prisma.party.findUnique({
      where: { code: normalizeCode(code) },
      include: { participants: true },
    });
    if (!party) throw new Error("Party not found");
    assertHost(party.participants, participantId);
    if (party.status !== "LOBBY") throw new Error("Settings can only be changed in the lobby");

    await prisma.party.update({
      where: { id: party.id },
      data: {
        maxSongs: input.maxSongs === undefined ? undefined : normalizeLimit(input.maxSongs, 5, 30),
        songsPerPerson:
          input.songsPerPerson === undefined ? undefined : normalizeLimit(input.songsPerPerson, 1, 5),
        timeLimit: input.timeLimit,
      },
    });

    return serializeParty(party.code);
  }

  async function addSong(code: string, participantId: string, track: TrackInput) {
    const party = await prisma.party.findUnique({
      where: { code: normalizeCode(code) },
      include: { songs: true, participants: true },
    });
    if (!party) throw new Error("Party not found");
    if (party.status === "ENDED") throw new Error("Party has ended");
    if (party.maxSongs > 0 && party.songs.length >= party.maxSongs) throw new Error("Queue is full");
    if (party.songs.some((song) => song.spotifyTrackId === track.spotifyTrackId)) {
      throw new Error("That song is already in the queue");
    }

    const participant = party.participants.find((item) => item.id === participantId && !item.isRemoved);
    if (!participant) throw new Error("Participant not found");
    const participantSongCount = party.songs.filter((song) => song.participantId === participantId).length;
    if (party.songsPerPerson > 0 && participantSongCount >= party.songsPerPerson) throw new Error("Song limit reached");

    await prisma.song.create({
      data: {
        ...track,
        partyId: party.id,
        participantId,
        submissionOrder: party.songs.length + 1,
      },
    });

    await prisma.partyEvent.create({
      data: {
        partyId: party.id,
        type: "song_added",
        message: `${participant.displayName} added ${track.title}.`,
      },
    });

    return serializeParty(party.code);
  }

  async function startParty(code: string, participantId: string) {
    const party = await prisma.party.findUnique({
      where: { code: normalizeCode(code) },
      include: { participants: true, songs: { orderBy: { submissionOrder: "asc" } } },
    });
    if (!party) throw new Error("Party not found");
    assertHost(party.participants, participantId);
    if (party.status !== "LOBBY") throw new Error("Party already started");
    if (party.participants.filter((participant) => !participant.isRemoved).length < 2) {
      throw new Error("At least 2 participants are required");
    }
    const firstSong = party.songs.find((song) => song.isPlayable);
    if (!firstSong) throw new Error("Add at least 1 playable song before starting");

    await prisma.$transaction([
      prisma.song.update({ where: { id: firstSong.id }, data: { status: "PLAYING", startedAt: new Date() } }),
      prisma.party.update({
        where: { id: party.id },
        data: {
          status: "ACTIVE",
          currentSongId: firstSong.id,
          startedAt: new Date(),
          playbackStartedAt: new Date(),
          elapsedMs: 0,
        },
      }),
      prisma.partyEvent.create({
        data: { partyId: party.id, type: "party_started", message: "The party started." },
      }),
    ]);

    return serializeParty(party.code);
  }

  async function updateVote(code: string, participantId: string, songId: string, tokens: number) {
    const party = await prisma.party.findUnique({ where: { code: normalizeCode(code) } });
    if (!party || party.status !== "ACTIVE" || party.currentSongId !== songId) {
      throw new Error("Voting is only open for the current song");
    }

    await prisma.vote.upsert({
      where: { songId_participantId: { songId, participantId } },
      update: { tokens: clamp(tokens, 0, 5) },
      create: { songId, participantId, tokens: clamp(tokens, 0, 5) },
    });

    return serializeParty(code);
  }

  async function addReaction(code: string, participantId: string, songId: string, type: ReactionType) {
    const party = await prisma.party.findUnique({ where: { code: normalizeCode(code) } });
    if (!party || party.status !== "ACTIVE" || party.currentSongId !== songId) {
      throw new Error("Reactions are only open for the current song");
    }

    await prisma.reaction.create({ data: { songId, participantId, type } });
    return serializeParty(code);
  }

  async function skipSong(code: string, participantId: string) {
    const party = await prisma.party.findUnique({
      where: { code: normalizeCode(code) },
      include: { participants: true },
    });
    if (!party || !party.currentSongId) throw new Error("No song is playing");
    const elapsedMs = getElapsedMs(party.playbackStartedAt, party.elapsedMs);
    await finalizeSong(party.currentSongId, elapsedMs, true);
    await playNextOrEnd(party.id);
    return serializeParty(party.code);
  }

  async function pausePlayback(code: string) {
    const party = await prisma.party.findUnique({ where: { code: normalizeCode(code) } });
    if (!party || party.status !== "ACTIVE") throw new Error("Party is not active");
    await prisma.party.update({
      where: { id: party.id },
      data: {
        elapsedMs: getElapsedMs(party.playbackStartedAt, party.elapsedMs),
        playbackStartedAt: null,
        playbackPausedAt: new Date(),
      },
    });
    return serializeParty(party.code);
  }

  async function resumePlayback(code: string) {
    const party = await prisma.party.findUnique({ where: { code: normalizeCode(code) } });
    if (!party || party.status !== "ACTIVE") throw new Error("Party is not active");
    await prisma.party.update({
      where: { id: party.id },
      data: {
        playbackStartedAt: new Date(),
        playbackPausedAt: null,
      },
    });
    return serializeParty(party.code);
  }

  async function previousOrRestart(code: string) {
    const party = await prisma.party.findUnique({
      where: { code: normalizeCode(code) },
      include: { songs: { orderBy: { submissionOrder: "asc" } } },
    });
    if (!party || party.status !== "ACTIVE" || !party.currentSongId) throw new Error("Party is not active");
    const elapsedMs = getElapsedMs(party.playbackStartedAt, party.elapsedMs);
    const currentIndex = party.songs.findIndex((song) => song.id === party.currentSongId);
    const shouldGoPrevious = elapsedMs < 3_000 && currentIndex > 0;
    const targetSong = shouldGoPrevious ? party.songs[currentIndex - 1] : party.songs[currentIndex];

    if (shouldGoPrevious) {
      await prisma.$transaction([
        prisma.song.update({ where: { id: party.currentSongId }, data: { status: "QUEUED", startedAt: null } }),
        prisma.song.update({
          where: { id: targetSong.id },
          data: {
            status: "PLAYING",
            startedAt: new Date(),
            endedAt: null,
            skippedAtMs: null,
            finalScore: null,
            tokenScore: null,
            participationBonus: null,
            goatBonus: null,
            skipPenaltyApplied: false,
          },
        }),
        prisma.party.update({
          where: { id: party.id },
          data: {
            currentSongId: targetSong.id,
            elapsedMs: 0,
            playbackStartedAt: party.playbackStartedAt ? new Date() : null,
            playbackPausedAt: party.playbackPausedAt ? new Date() : null,
          },
        }),
      ]);
    } else {
      await prisma.party.update({
        where: { id: party.id },
        data: {
          elapsedMs: 0,
          playbackStartedAt: party.playbackStartedAt ? new Date() : null,
        },
      });
    }

    return serializeParty(party.code);
  }

  async function advanceCurrentSong(code: string) {
    const party = await prisma.party.findUnique({ where: { code: normalizeCode(code) } });
    if (!party || party.status !== "ACTIVE" || !party.currentSongId) return serializeParty(code);
    await finalizeSong(party.currentSongId, getElapsedMs(party.playbackStartedAt, party.elapsedMs), false);
    await playNextOrEnd(party.id);
    return serializeParty(party.code);
  }

  async function endParty(code: string, participantId: string) {
    const party = await prisma.party.findUnique({
      where: { code: normalizeCode(code) },
      include: { participants: true },
    });
    if (!party) throw new Error("Party not found");
    assertHost(party.participants, participantId);
    if (party.currentSongId) {
      await finalizeSong(party.currentSongId, getElapsedMs(party.playbackStartedAt, party.elapsedMs), false);
    }
    await prisma.party.update({
      where: { id: party.id },
      data: { status: "ENDED", endedAt: new Date(), currentSongId: null },
    });
    return serializeParty(party.code);
  }

  async function leaveParty(code: string, participantId: string) {
    const party = await prisma.party.findUnique({
      where: { code: normalizeCode(code) },
      include: { participants: { orderBy: { joinedAt: "asc" } } },
    });
    if (!party) return null;
    const leaving = party.participants.find((participant) => participant.id === participantId);
    if (!leaving) return serializeParty(party.code);

    const remaining = party.participants.filter(
      (participant) => participant.id !== participantId && !participant.isRemoved && !participant.isAway,
    );
    const updates = [
      prisma.participant.update({
        where: { id: participantId },
        data: { isRemoved: true, socketId: null, isAway: false },
      }),
      prisma.partyEvent.create({
        data: { partyId: party.id, type: "participant_left", message: `${leaving.displayName} left the party.` },
      }),
    ];

    if (leaving.isHost && remaining.length > 0) {
      updates.push(
        prisma.participant.update({
          where: { id: remaining[0].id },
          data: { isHost: true },
        }),
      );
    }

    await prisma.$transaction(updates);

    if (remaining.length === 0) {
      await prisma.party.update({
        where: { id: party.id },
        data: { status: "ENDED", endedAt: new Date(), currentSongId: null },
      });
    }

    return serializeParty(party.code);
  }

  async function markParticipantAway(socketId: string) {
    const participant = await prisma.participant.findFirst({
      where: { socketId },
      include: { party: { include: { participants: { where: { isRemoved: false } } } } }
    });
    if (!participant) return null;

    // Set participant as removed
    await prisma.participant.update({
      where: { id: participant.id },
      data: { isAway: false, isRemoved: true, socketId: null },
    });

    await prisma.partyEvent.create({
      data: {
        partyId: participant.party.id,
        type: "participant_left",
        message: `${participant.displayName} left the party.`,
      },
    });

    // If host is leaving, promote next active participant
    if (participant.isHost) {
      const remaining = participant.party.participants.filter(p => !p.isRemoved && p.id !== participant.id);
      if (remaining.length > 0) {
        await prisma.participant.update({
          where: { id: remaining[0].id },
          data: { isHost: true },
        });
        await prisma.partyEvent.create({
          data: {
            partyId: participant.party.id,
            type: "host_promoted",
            message: `${remaining[0].displayName} was promoted to host.`,
          },
        });
      } else {
        // No participants left, end the party
        await prisma.party.update({
          where: { id: participant.party.id },
          data: { status: "ENDED", endedAt: new Date(), currentSongId: null },
        });
      }
    }

    return participant.party.code;
  }

  async function attachSocket(code: string, participantId: string, socketId: string) {
    await prisma.participant.update({ where: { id: participantId }, data: { socketId, isAway: false } });
    return serializeParty(code);
  }

  async function finalizeSong(songId: string, elapsedMs: number, skipped: boolean) {
    const song = await prisma.song.findUnique({
      where: { id: songId },
      include: {
        party: { include: { participants: { where: { isRemoved: false } } } },
        votes: true,
        reactions: true,
      },
    });
    if (!song) return;
    const score = calculateVibeScore({
      participantCount: song.party.participants.length,
      durationMs: song.durationMs,
      skippedAtMs: skipped ? elapsedMs : null,
      votes: song.votes,
      reactions: song.reactions as Array<{ type: ReactionType }>,
    });
    await prisma.song.update({
      where: { id: song.id },
      data: {
        status: skipped ? "SKIPPED" : "PLAYED",
        endedAt: new Date(),
        skippedAtMs: skipped ? elapsedMs : null,
        ...score,
      },
    });
  }

  async function playNextOrEnd(partyId: string) {
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      include: { songs: { orderBy: { submissionOrder: "asc" } } },
    });
    if (!party) return;
    const next = party.songs.find((song) => song.status === "QUEUED" && song.isPlayable);
    if (!next) {
      await prisma.party.update({
        where: { id: party.id },
        data: { status: "ENDED", endedAt: new Date(), currentSongId: null },
      });
      return;
    }
    await prisma.$transaction([
      prisma.song.update({ where: { id: next.id }, data: { status: "PLAYING", startedAt: new Date() } }),
      prisma.party.update({
        where: { id: party.id },
        data: { currentSongId: next.id, playbackStartedAt: new Date(), elapsedMs: 0, playbackPausedAt: null },
      }),
    ]);
  }

  return {
    serializeParty,
    createParty,
    joinParty,
    updateSettings,
    addSong,
    startParty,
    updateVote,
    addReaction,
    skipSong,
    pausePlayback,
    resumePlayback,
    previousOrRestart,
    advanceCurrentSong,
    endParty,
    leaveParty,
    markParticipantAway,
    attachSocket,
  };
}

function summarizeReactions(reactions: Array<{ type: string }>) {
  return reactions.reduce<Record<string, number>>((summary, reaction) => {
    summary[reaction.type] = (summary[reaction.type] ?? 0) + 1;
    return summary;
  }, {});
}

function assertHost(participants: Array<{ id: string; isHost: boolean }>, participantId: string) {
  if (!participants.some((participant) => participant.id === participantId && participant.isHost)) {
    throw new Error("Only the host can do that");
  }
}

function getElapsedMs(startedAt: Date | null, existingElapsedMs: number) {
  if (!startedAt) return existingElapsedMs;
  return existingElapsedMs + Date.now() - startedAt.getTime();
}

function normalizeCode(code: string) {
  const raw = code.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return raw.slice(0, 6);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeLimit(value: number, min: number, max: number) {
  return value === 0 ? 0 : clamp(value, min, max);
}

async function generateUniqueCode(prisma: PrismaClient) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
    const existing = await prisma.party.findUnique({ where: { code } });
    if (!existing) return code;
  }
  throw new Error("Unable to generate a unique party code");
}
