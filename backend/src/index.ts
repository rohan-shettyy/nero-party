import cors from "cors";
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { env } from "./env.js";
import { createPartyService } from "./partyService.js";
import { prisma } from "./prisma.js";
import {
  exchangeSpotifyCode,
  getSpotifyAuthUrl,
  refreshSpotifyToken,
  searchSpotifyTracks,
} from "./spotify.js";
import { ReactionType } from "./types.js";

const app = express();
const server = createServer(app);
const parties = createPartyService(prisma);
const playbackTimers = new Map<string, NodeJS.Timeout>();

const io = new Server(server, {
  cors: {
    origin: env.ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
  },
});

app.use(cors({ origin: env.ALLOWED_ORIGINS }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/api/parties", asyncHandler(async (req, res) => {
  const result = await parties.createParty(req.body);
  res.status(201).json(result);
}));

app.get("/api/parties/:code", asyncHandler(async (req, res) => {
  const party = await parties.serializeParty(String(req.params.code));
  if (!party) {
    res.status(404).json({ error: "Party not found" });
    return;
  }
  res.json({ party });
}));

app.post("/api/parties/:code/join", asyncHandler(async (req, res) => {
  const result = await parties.joinParty(String(req.params.code), req.body.displayName, req.body.sessionToken);
  res.status(201).json(result);
}));

app.get("/api/spotify/auth-url", (req, res) => {
  if (!env.SPOTIFY_CLIENT_ID) {
    res.status(400).json({ error: "SPOTIFY_CLIENT_ID is not configured" });
    return;
  }
  res.json({
    url: getSpotifyAuthUrl(
      String(req.query.state),
      String(req.query.codeChallenge),
      String(req.query.redirectUri ?? env.SPOTIFY_REDIRECT_URI),
    ),
  });
});

app.post("/api/spotify/token", asyncHandler(async (req, res) => {
  res.json(await exchangeSpotifyCode(req.body.code, req.body.codeVerifier, req.body.redirectUri));
}));

app.post("/api/spotify/refresh", asyncHandler(async (req, res) => {
  res.json(await refreshSpotifyToken(req.body.refreshToken));
}));

app.get("/api/spotify/search", asyncHandler(async (req, res) => {
  const authorization = req.headers.authorization;
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) {
    res.json({ tracks: [] });
    return;
  }
  const tracks = await searchSpotifyTracks(
    q,
    authorization?.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : undefined,
  );
  res.json({ tracks });
}));

io.on("connection", (socket) => {
  socket.on("party:join-room", async ({ code, participantId }) => {
    try {
      socket.join(code);
      const party = await parties.attachSocket(code, participantId, socket.id);
      io.to(code).emit("party:state", party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("queue:add", async ({ code, participantId, track }) => {
    try {
      const party = await parties.addSong(code, participantId, track);
      io.to(code).emit("party:state", party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("party:update-settings", async ({ code, participantId, settings }) => {
    try {
      const party = await parties.updateSettings(code, participantId, settings);
      io.to(code).emit("party:state", party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("party:start", async ({ code, participantId }) => {
    try {
      const party = await parties.startParty(code, participantId);
      io.to(code).emit("party:state", party);
      io.to(code).emit("playback:sync", party);
      scheduleAutoAdvance(code, party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("vote:update", async ({ code, participantId, songId, tokens }) => {
    try {
      const party = await parties.updateVote(code, participantId, songId, tokens);
      io.to(code).emit("party:state", party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("reaction:send", async ({ code, participantId, songId, type }) => {
    try {
      const party = await parties.addReaction(code, participantId, songId, type as ReactionType);
      io.to(code).emit("party:state", party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("queue:skip", async ({ code, participantId }) => {
    try {
      const party = await parties.skipSong(code, participantId);
      io.to(code).emit("party:state", party);
      io.to(code).emit("playback:sync", party);
      scheduleAutoAdvance(code, party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("playback:pause", async ({ code }) => {
    try {
      const party = await parties.pausePlayback(code);
      clearAutoAdvance(code);
      io.to(code).emit("party:state", party);
      io.to(code).emit("playback:sync", party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("playback:play", async ({ code }) => {
    try {
      const party = await parties.resumePlayback(code);
      io.to(code).emit("party:state", party);
      io.to(code).emit("playback:sync", party);
      scheduleAutoAdvance(code, party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("playback:rewind", async ({ code, amountMs }) => {
    try {
      const party = await parties.rewindPlayback(code, amountMs);
      io.to(code).emit("party:state", party);
      io.to(code).emit("playback:sync", party);
      scheduleAutoAdvance(code, party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("party:leave", async ({ code, participantId }) => {
    try {
      const party = await parties.leaveParty(code, participantId);
      socket.leave(code);
      if (party) {
        io.to(code).emit("party:state", party);
      }
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("party:end", async ({ code, participantId }) => {
    try {
      const party = await parties.endParty(code, participantId);
      clearAutoAdvance(code);
      io.to(code).emit("party:state", party);
    } catch (error) {
      socket.emit("party:error", toError(error));
    }
  });

  socket.on("disconnect", async () => {
    const code = await parties.markParticipantAway(socket.id);
    if (!code) return;
    const party = await parties.serializeParty(code);
    io.to(code).emit("party:state", party);
    setTimeout(async () => {
      const nextParty = await parties.cleanupDisconnects(code);
      io.to(code).emit("party:state", nextParty);
    }, 65_000);
  });
});

server.listen(env.PORT, () => {
  console.log(`Server running on http://localhost:${env.PORT}`);
});

function asyncHandler(
  handler: (req: express.Request, res: express.Response) => Promise<void> | Promise<unknown>,
) {
  return async (req: express.Request, res: express.Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      res.status(400).json({ error: toError(error) });
    }
  };
}

function toError(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

function scheduleAutoAdvance(code: string, party: Awaited<ReturnType<typeof parties.serializeParty>>) {
  clearAutoAdvance(code);
  if (!party || party.status !== "ACTIVE" || !party.currentSongId || party.playbackPausedAt) return;
  const currentSong = party.songs.find((song) => song.id === party.currentSongId);
  if (!currentSong) return;
  const remainingMs = Math.max(1000, currentSong.durationMs - party.elapsedMs);
  playbackTimers.set(
    code,
    setTimeout(async () => {
      const nextParty = await parties.advanceCurrentSong(code);
      io.to(code).emit("party:state", nextParty);
      io.to(code).emit("playback:sync", nextParty);
      scheduleAutoAdvance(code, nextParty);
    }, remainingMs),
  );
}

function clearAutoAdvance(code: string) {
  const timer = playbackTimers.get(code);
  if (timer) clearTimeout(timer);
  playbackTimers.delete(code);
}
