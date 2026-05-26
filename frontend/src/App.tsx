import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { createParty, getParty, joinParty, searchTracks } from "./lib/api";
import { socket } from "./lib/socket";
import {
  createSpotifyPlayer,
  finishSpotifyLoginFromUrl,
  getStoredSpotifyTokens,
  pauseSpotifyPlayback,
  playSpotifyTrack,
  startSpotifyLogin,
  SpotifyTokens,
} from "./lib/spotify";
import { Party, ReactionType, Session, Song, Track } from "./types";

const sessionKey = (code: string) => `nero.session.${code}`;
const reactions: Array<{ type: ReactionType; icon: string; label: string; color: string }> = [
  { type: "FIRE", icon: "local_fire_department", label: "Fire", color: "text-orange-500" },
  { type: "VIBE", icon: "favorite", label: "Vibe", color: "text-primary" },
  { type: "MEH", icon: "sentiment_neutral", label: "Meh", color: "text-on-surface-variant" },
  { type: "SKIP", icon: "block", label: "Skip it", color: "text-error" },
  { type: "GOAT", icon: "stars", label: "GOAT", color: "text-yellow-500" },
];

function App() {
  const [party, setParty] = useState<Party | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [tokens, setTokens] = useState<SpotifyTokens | null>(() => getStoredSpotifyTokens());
  const [error, setError] = useState("");
  const [deviceReady, setDeviceReady] = useState(false);
  const [spotifyDeviceId, setSpotifyDeviceId] = useState<string | null>(null);
  const route = parseRoute();

  useEffect(() => {
    finishSpotifyLoginFromUrl()
      .then((result) => result && setTokens(result))
      .catch((err: Error) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!route.code) return;
    const stored = sessionStorage.getItem(sessionKey(route.code));
    if (stored) setSession(JSON.parse(stored));
    getParty(route.code)
      .then(({ party: loaded }) => setParty(loaded))
      .catch(() => undefined);
  }, [route.code]);

  useEffect(() => {
    if (!party || !session) return;
    if (!socket.connected) socket.connect();
    socket.emit("party:join-room", { code: party.code, participantId: session.participantId });
    socket.on("party:state", setParty);
    socket.on("party:error", setError);
    return () => {
      socket.off("party:state", setParty);
      socket.off("party:error", setError);
    };
  }, [party?.code, session?.participantId]);

  useEffect(() => {
    if (!tokens || deviceReady) return;
    createSpotifyPlayer(tokens.accessToken)
      .then(({ deviceId }) => {
        setSpotifyDeviceId(deviceId);
        setDeviceReady(true);
      })
      .catch((err: Error) => setError(err.message));
  }, [tokens, deviceReady]);

  useEffect(() => {
    if (!party) return;
    if (party.status === "ACTIVE" && route.view === "lobby") {
      window.history.pushState({}, "", `/party/${party.code}`);
    }
    if (party.status === "ENDED" && route.view !== "results") {
      window.history.pushState({}, "", `/party/${party.code}/results`);
    }
  }, [party?.status, party?.code, route.view]);

  function saveSession(code: string, nextSession: Session) {
    sessionStorage.setItem(sessionKey(code), JSON.stringify(nextSession));
    setSession(nextSession);
  }

  function leaveParty() {
    if (party && session) {
      socket.emit("party:leave", { code: party.code, participantId: session.participantId });
      sessionStorage.removeItem(sessionKey(party.code));
      socket.off("party:state", setParty);
      socket.off("party:error", setError);
    }
    setParty(null);
    setSession(null);
    window.history.pushState({}, "", "/");
  }

  async function handleCreate(input: {
    name: string;
    hostName: string;
  }) {
    const result = await createParty(input);
    setParty(result.party);
    const host = result.party.participants.find((participant) => participant.isHost)!;
    saveSession(result.party.code, {
      participantId: host.id,
      sessionToken: result.sessionToken,
      displayName: host.displayName,
    });
    window.history.pushState({}, "", `/party/${result.party.code}/lobby`);
  }

  async function handleJoin(code: string, displayName: string) {
    const result = await joinParty(code, displayName);
    setParty(result.party);
    saveSession(result.party.code, {
      participantId: result.participantId,
      sessionToken: result.sessionToken,
      displayName,
    });
    const nextPath =
      result.party.status === "ENDED"
        ? `/party/${result.party.code}/results`
        : result.party.status === "ACTIVE"
          ? `/party/${result.party.code}`
          : `/party/${result.party.code}/lobby`;
    window.history.pushState({}, "", nextPath);
  }

  const activeView =
    party?.status === "ENDED" || route.view === "results"
      ? "results"
      : party?.status === "ACTIVE"
        ? "party"
        : route.view;

  return (
    <>
      {error && (
        <div className="fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-error-container px-5 py-2 text-sm font-semibold text-error shadow-glass">
          {error}
        </div>
      )}
      {activeView === "join" && (
        <JoinScreen
          initialCode={route.code}
          onJoin={handleJoin}
          onCreate={handleCreate}
          spotifyReady={!!tokens}
          onSpotifyLogin={startSpotifyLogin}
        />
      )}
      {activeView === "lobby" && party && session && (
        <LobbyScreen party={party} session={session} hostSpotifyReady={!!tokens} onLeave={leaveParty} />
      )}
      {activeView === "party" && party && session && (
        <PartyScreen
          party={party}
          session={session}
          spotifyReady={!!tokens && deviceReady}
          accessToken={tokens?.accessToken}
          spotifyDeviceId={spotifyDeviceId}
          onLeave={leaveParty}
        />
      )}
      {activeView === "results" && party && <ResultsScreen party={party} onLeave={leaveParty} />}
    </>
  );
}

function JoinScreen({
  initialCode,
  onJoin,
  onCreate,
  spotifyReady,
  onSpotifyLogin,
}: {
  initialCode?: string;
  onJoin: (code: string, displayName: string) => Promise<void>;
  onCreate: (input: {
    name: string;
    hostName: string;
  }) => Promise<void>;
  spotifyReady: boolean;
  onSpotifyLogin: () => void;
}) {
  const [mode, setMode] = useState<"join" | "create">(initialCode ? "join" : "create");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!spotifyReady) return;
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      if (mode === "join") {
        await onJoin(String(form.get("code")).toUpperCase(), String(form.get("displayName")));
      } else {
        await onCreate({
          name: String(form.get("partyName")),
          hostName: String(form.get("displayName")),
        });
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <header className="mb-12 text-center">
          <h1 className="font-display text-4xl font-bold text-primary">Nero Party</h1>
          <p className="mt-1 text-on-surface-variant">Listen with your friends in real-time.</p>
        </header>
        <form onSubmit={submit} className="glass-card space-y-5 p-8">
          <div className="text-center">
            <h2 className="font-display text-2xl font-semibold">{mode === "join" ? "Join the Lobby" : "Host a Lobby"}</h2>
            <p className="text-sm text-on-surface-variant">
              {!spotifyReady
                ? "Connect Spotify before hosting or joining."
                : "Enter your details to sync with the party."}
            </p>
          </div>
          {!spotifyReady && (
            <button
              type="button"
              onClick={onSpotifyLogin}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-secondary-container py-4 font-semibold text-on-secondary-container transition active:scale-95"
            >
              <span className="icon">music_note</span>
              Connect Spotify
            </button>
          )}
          {mode === "create" && (
            <Field icon="celebration" label="Party name" name="partyName" placeholder="Saturday set" required />
          )}
          {mode === "join" && (
            <Field
              icon="qr_code_2"
              label="Join code"
              name="code"
              defaultValue={initialCode}
              placeholder="NR4X9"
              maxLength={6}
              required
            />
          )}
          <Field icon="person" label="Display name" name="displayName" placeholder="Your name" required />
          <button
            className={`flex w-full items-center justify-center gap-2 rounded-xl py-4 font-semibold transition active:scale-95 ${
              spotifyReady
                ? "bg-primary-container text-on-primary-container"
                : "cursor-not-allowed bg-outline-variant text-on-surface-variant"
            }`}
            disabled={busy || !spotifyReady}
          >
            {busy ? "Syncing..." : mode === "join" ? "Join Lobby" : "Host Lobby"}
            <span className="icon">arrow_forward</span>
          </button>
          <button type="button" onClick={() => setMode(mode === "join" ? "create" : "join")} className="w-full text-sm font-semibold text-primary">
            {mode === "join" ? "Hosting? Create a Room" : "Have a code? Join Party"}
          </button>
        </form>
      </div>
    </main>
  );
}

function LobbyScreen({
  party,
  session,
  hostSpotifyReady,
  onLeave,
}: {
  party: Party;
  session: Session;
  hostSpotifyReady: boolean;
  onLeave: () => void;
}) {
  const isHost = party.participants.some((participant) => participant.id === session.participantId && participant.isHost);
  const canStart = isHost && hostSpotifyReady && party.participants.length >= 2 && party.songs.length > 0;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(party.joinUrl)}`;

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-12">
      <AppHeader onLeave={onLeave} />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
        <section className="lg:col-span-8 space-y-6">
          <GlassCard className="flex flex-col items-center gap-6 p-6 md:flex-row">
            <div className="rounded-xl border border-outline-variant/30 bg-white p-4 shadow-sm">
              <img alt="Join QR code" src={qrUrl} className="h-40 w-40" />
            </div>
            <div className="text-center md:text-left">
              <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Join the Party: <span className="font-semibold text-primary">{party.name}</span></span>
              <h1 className="mt-1 font-display text-5xl font-bold text-primary">{party.code}</h1>
              <p className="mb-4 mt-2 text-on-surface-variant">Share this code or scan the QR to invite guests.</p>
              <button onClick={() => navigator.clipboard.writeText(party.joinUrl)} className="rounded-full border border-outline-variant px-5 py-2 text-sm font-semibold text-primary">
                <span className="icon mr-2 text-base">content_copy</span>Copy Link
              </button>
            </div>
          </GlassCard>
          <ParticipantList participants={party.participants} />
          <QueuePanel party={party} session={session} />
        </section>
        <aside className="space-y-6 lg:col-span-4">
          <GlassCard className="p-6">
            <h2 className="font-display text-2xl font-semibold">Party Settings</h2>
            {isHost ? (
              <>
                {!hostSpotifyReady && (
                  <button
                    onClick={startSpotifyLogin}
                    className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-secondary-container py-3 font-semibold text-on-secondary-container"
                  >
                    <span className="icon">music_note</span>
                    Connect Spotify to start
                  </button>
                )}
                <LobbySettingsEditor party={party} participantId={session.participantId} />
                <button
                  disabled={!canStart}
                  onClick={() => socket.emit("party:start", { code: party.code, participantId: session.participantId })}
                  className={`mt-6 w-full rounded-2xl py-4 font-semibold transition ${canStart ? "bg-primary text-white shadow-lg active:scale-95" : "cursor-not-allowed bg-outline-variant text-on-surface-variant"}`}
                >
                  Start Party
                </button>
                {!canStart && (
                  <p className="mt-4 text-center text-xs text-on-surface-variant">
                    {!hostSpotifyReady ? "Host Spotify connection required to start." : "Need 2 participants and 1 queued song."}
                  </p>
                )}
              </>
            ) : (
              <>
                <dl className="mt-6 space-y-4 text-sm">
                  <Setting label="Max songs in queue" value={formatLimit(party.maxSongs)} />
                  <Setting label="Songs per person" value={formatLimit(party.songsPerPerson)} />
                  <Setting label="Time limit" value={formatTimeLimit(party.timeLimit)} />
                </dl>
                <div className="mt-6 flex flex-col items-center gap-3 rounded-2xl bg-primary-container/20 p-5 text-center">
                  <span className="icon text-primary animate-pulse">hourglass_empty</span>
                  <p className="text-sm font-semibold text-primary">Waiting for host to start the party...</p>
                </div>
              </>
            )}
          </GlassCard>
          <Activity events={party.events} />
        </aside>
      </div>
    </main>
  );
}

function LobbySettingsEditor({ party, participantId }: { party: Party; participantId: string }) {
  function update(settings: Partial<Pick<Party, "maxSongs" | "songsPerPerson" | "timeLimit">>) {
    socket.emit("party:update-settings", {
      code: party.code,
      participantId,
      settings,
    });
  }

  return (
    <div className="mt-6 space-y-4">
      <SliderSetting
        label="Max songs in queue"
        value={party.maxSongs}
        min={5}
        max={30}
        unlimitedValue={31}
        step={1}
        onChange={(maxSongs) => update({ maxSongs })}
      />
      <SliderSetting
        label="Songs per person"
        value={party.songsPerPerson}
        min={1}
        max={5}
        unlimitedValue={6}
        step={1}
        onChange={(songsPerPerson) => update({ songsPerPerson })}
      />
      <label className="block rounded-xl border border-outline-variant/50 bg-white/70 px-4 py-3">
        <span className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">Time limit</span>
        <select
          value={party.timeLimit}
          onChange={(event) => update({ timeLimit: event.target.value as Party["timeLimit"] })}
          className="mt-2 w-full rounded-lg border border-outline-variant/40 bg-white px-3 py-2 text-sm outline-none"
        >
          <option value="NONE">None</option>
          <option value="ONE_HOUR">1 hour</option>
          <option value="TWO_HOURS">2 hours</option>
          <option value="THREE_HOURS">3 hours</option>
        </select>
      </label>
    </div>
  );
}

function PartyScreen({
  party,
  session,
  spotifyReady,
  accessToken,
  spotifyDeviceId,
  onLeave,
}: {
  party: Party;
  session: Session;
  spotifyReady: boolean;
  accessToken?: string;
  spotifyDeviceId: string | null;
  onLeave: () => void;
}) {
  const current = party.songs.find((song) => song.id === party.currentSongId) ?? party.songs[0];
  const elapsed = useElapsed(party, current);
  const [audioElapsed, setAudioElapsed] = useState(elapsed);
  const isHost = party.participants.some((participant) => participant.id === session.participantId && participant.isHost);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const isPaused = Boolean(party.playbackPausedAt || !party.playbackStartedAt);
  const displayElapsed = current?.previewUrl ? audioElapsed : elapsed;
  const [needInteractionToPlay, setNeedInteractionToPlay] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<Array<{ id: string; emoji: string; left: number; height: number }>>([]);

  const spawnEmoji = (type: ReactionType) => {
    const emojiMap: Record<ReactionType, string> = {
      FIRE: "🔥",
      VIBE: "❤️",
      MEH: "😐",
      SKIP: "🚫",
      GOAT: "🐐",
    };
    const emoji = emojiMap[type] || "🔥";
    const left = 20 + Math.random() * 60;
    const height = -150 - Math.random() * 200;
    const id = Math.random().toString(36).substring(2);
    setFloatingEmojis((prev) => [...prev, { id, emoji, left, height }]);
    setTimeout(() => {
      setFloatingEmojis((prev) => prev.filter((item) => item.id !== id));
    }, 2200);
  };

  useEffect(() => {
    socket.on("reaction:receive", ({ type }) => {
      spawnEmoji(type);
    });
    return () => {
      socket.off("reaction:receive");
    };
  }, []);

  const playAudio = (audioElement: HTMLAudioElement | null) => {
    if (!audioElement) return;
    audioElement.play().catch((err) => {
      if (err.name === "NotAllowedError") {
        setNeedInteractionToPlay(true);
      }
    });
  };

  const syncAudioTime = (audio: HTMLAudioElement, targetSeconds: number) => {
    if (audio.readyState >= 1) {
      audio.currentTime = targetSeconds;
      if (!isPaused) playAudio(audio);
    } else {
      const handleMetadata = () => {
        audio.currentTime = targetSeconds;
        if (!isPaused) playAudio(audio);
      };
      audio.addEventListener("loadedmetadata", handleMetadata, { once: true });
    }
  };

  useEffect(() => {
    const handleGlobalClick = () => {
      if (needInteractionToPlay) {
        const audio = audioRef.current;
        if (audio && !isPaused) {
          audio.play()
            .then(() => setNeedInteractionToPlay(false))
            .catch(() => undefined);
        }
      }
    };
    window.addEventListener("click", handleGlobalClick);
    return () => window.removeEventListener("click", handleGlobalClick);
  }, [needInteractionToPlay, isPaused]);

  useEffect(() => {
    setAudioElapsed(elapsed);
  }, [current?.id]);

  useEffect(() => {
    function handlePlaybackSync(payload: { action: "play" | "pause" | "stop"; party: Party }) {
      const audio = audioRef.current;
      if (payload.action === "stop" || payload.party.status === "ENDED") {
        audio?.pause();
        if (audio) audio.currentTime = 0;
        if (spotifyReady && accessToken && spotifyDeviceId) {
          void pauseSpotifyPlayback(accessToken, spotifyDeviceId).catch(() => undefined);
        }
        return;
      }

      const syncedSong = payload.party.songs.find((song) => song.id === payload.party.currentSongId);
      const syncedElapsed = getPartyElapsed(payload.party, syncedSong);
      if (audio && syncedSong?.previewUrl) {
        const seconds = Math.min(syncedElapsed / 1000, Math.max(0, audio.duration || 30) - 0.25);
        syncAudioTime(audio, seconds);
        setAudioElapsed(seconds * 1000);
        if (payload.action === "play") {
          playAudio(audio);
        } else {
          audio.pause();
        }
      }
    }

    socket.on("playback:sync", handlePlaybackSync);
    return () => {
      socket.off("playback:sync", handlePlaybackSync);
      const audio = audioRef.current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      if (spotifyReady && accessToken && spotifyDeviceId) {
        void pauseSpotifyPlayback(accessToken, spotifyDeviceId).catch(() => undefined);
      }
    };
  }, [accessToken, spotifyDeviceId, spotifyReady]);

  useEffect(() => {
    if (!spotifyReady || !accessToken || !spotifyDeviceId || !current?.spotifyUri) return;
    if (party.status === "ENDED") {
      void pauseSpotifyPlayback(accessToken, spotifyDeviceId).catch(() => undefined);
      return;
    }
    if (isPaused) {
      void pauseSpotifyPlayback(accessToken, spotifyDeviceId).catch(() => undefined);
    } else {
      void playSpotifyTrack(accessToken, spotifyDeviceId, current.spotifyUri, elapsed).catch(() => undefined);
    }
  }, [current?.id, isPaused, party.status, spotifyReady, accessToken, spotifyDeviceId, party.elapsedMs, party.playbackStartedAt]);

  useEffect(() => {
    const audio = audioRef.current;
    if (party.status === "ENDED") {
      audio?.pause();
      if (audio) audio.currentTime = 0;
      return;
    }
    if (!audio || !current?.previewUrl) return;
    const seconds = Math.min(elapsed / 1000, Math.max(0, audio.duration || 30) - 0.25);
    syncAudioTime(audio, seconds);
    setAudioElapsed(seconds * 1000);
    if (isPaused) {
      audio.pause();
    }
  }, [current?.id, current?.previewUrl, isPaused, party.status, party.elapsedMs, party.playbackStartedAt]);

  return (
    <>
      <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
        {floatingEmojis.map((item) => (
          <div
            key={item.id}
            className="absolute bottom-10 animate-float-up text-4xl"
            style={{ left: `${item.left}%`, "--float-height": `${item.height}px` } as React.CSSProperties}
          >
            {item.emoji}
          </div>
        ))}
      </div>
      {needInteractionToPlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="glass-card text-center max-w-sm p-8 space-y-6">
            <span className="icon text-6xl text-primary">volume_up</span>
            <div>
              <h3 className="font-display text-2xl font-bold">Unmute Party Audio</h3>
              <p className="text-sm text-on-surface-variant mt-2">Your browser has blocked autoplay. Click below to start listening with the party!</p>
            </div>
            <button
              onClick={() => {
                setNeedInteractionToPlay(false);
                const audio = audioRef.current;
                if (audio) {
                  const seconds = Math.min(elapsed / 1000, Math.max(0, audio.duration || 30) - 0.25);
                  audio.currentTime = seconds;
                  audio.play().catch(() => undefined);
                }
              }}
              className="w-full bg-primary text-white rounded-full py-4 font-semibold shadow-lg transition active:scale-95 hover:bg-primary/95"
            >
              Start Listening
            </button>
          </div>
        </div>
      )}
      <header className="flex items-center justify-between px-4 py-2">
        <div>
          <div className="font-display text-2xl font-bold text-primary leading-none">Nero Party</div>
          <div className="text-xs font-semibold text-on-surface-variant mt-1">{party.name}</div>
        </div>
        <button onClick={onLeave} className="rounded-full bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface-variant">Leave Party</button>
      </header>
      <main className="mx-auto grid max-h-[calc(100vh-48px)] max-w-[1280px] grid-cols-1 gap-4 overflow-hidden px-4 pb-4 pt-3 md:grid-cols-12">
        <audio
          ref={audioRef}
          src={current?.previewUrl ?? undefined}
          preload="auto"
          onLoadedMetadata={(event) => setAudioElapsed(event.currentTarget.currentTime * 1000)}
          onTimeUpdate={(event) => setAudioElapsed(event.currentTarget.currentTime * 1000)}
          onSeeking={(event) => setAudioElapsed(event.currentTarget.currentTime * 1000)}
          onSeeked={(event) => setAudioElapsed(event.currentTarget.currentTime * 1000)}
          onPause={(event) => setAudioElapsed(event.currentTarget.currentTime * 1000)}
          onPlay={(event) => setAudioElapsed(event.currentTarget.currentTime * 1000)}
        />
        <aside className="hidden md:col-span-3 md:block">
          <ParticipantList participants={party.participants} compact />
        </aside>
        <section className="md:col-span-6">
          {current ? <NowPlaying party={party} session={session} song={current} elapsed={displayElapsed} isPaused={isPaused} onReact={spawnEmoji} /> : <EmptyQueue />}
          <PlaybackControls
            party={party}
            session={session}
            isPaused={isPaused}
            previewAudio={audioRef.current}
            previewOffsetMs={displayElapsed}
            previewAvailable={Boolean(current?.previewUrl)}
          />
          {isHost && (
            <div className="mt-3 flex justify-center">
              <button onClick={() => socket.emit("party:end", { code: party.code, participantId: session.participantId })} className="rounded-full bg-error-container px-5 py-2 text-sm font-semibold text-error">End Party</button>
            </div>
          )}
        </section>
        <aside className="md:col-span-3">
          <QueuePanel party={party} session={session} />
        </aside>
      </main>
    </>
  );
}

function NowPlaying({
  party,
  session,
  song,
  elapsed,
  isPaused,
  onReact,
}: {
  party: Party;
  session: Session;
  song: Song;
  elapsed: number;
  isPaused: boolean;
  onReact: (type: ReactionType) => void;
}) {
  const percent = Math.min(100, (elapsed / song.durationMs) * 100);
  return (
    <section className="flex flex-col items-center">
      <GlassCard className="mb-3 aspect-square w-full max-w-[260px] overflow-hidden p-2">
        <img src={song.albumArtUrl} alt={song.title} className="h-full w-full rounded-[18px] object-cover" />
      </GlassCard>
      <div className="mb-3 text-center">
        <h1 className="font-display text-2xl font-semibold">{song.title}</h1>
        <p className="text-sm text-on-surface-variant">{song.artist} - {song.album}</p>
        <p className="mt-1 text-xs font-semibold text-primary">{isPaused ? "Paused" : spotifyPlaybackLabel(song)}</p>
      </div>
      <div className="mb-3 w-full max-w-[420px]">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-variant">
          <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${percent}%` }} />
        </div>
        <div className="mt-2 flex justify-between text-xs font-bold text-on-surface-variant">
          <span>{formatMs(elapsed)}</span>
          <span>{formatMs(song.durationMs)}</span>
        </div>
      </div>
      <VibeTokens party={party} session={session} song={song} />
      <ReactionBar party={party} session={session} song={song} onReact={onReact} />
    </section>
  );
}

function PlaybackControls({
  party,
  session,
  isPaused,
  previewAudio,
  previewOffsetMs,
  previewAvailable,
}: {
  party: Party;
  session: Session;
  isPaused: boolean;
  previewAudio: HTMLAudioElement | null;
  previewOffsetMs: number;
  previewAvailable: boolean;
}) {
  function playLocalPreview() {
    if (!previewAudio) return;
    previewAudio.currentTime = Math.min(previewOffsetMs / 1000, Math.max(0, previewAudio.duration || 30) - 0.25);
    void previewAudio.play().catch(() => undefined);
  }

  return (
    <div className="mt-3 flex items-center justify-center gap-3">
      <button
        onClick={() => socket.emit("playback:previous", { code: party.code, participantId: session.participantId })}
        className="glass-card flex h-11 w-11 items-center justify-center rounded-full text-primary active:scale-95"
        title="Restart or previous song"
      >
        <span className="icon">skip_previous</span>
      </button>
      <button
        onClick={() => {
          if (isPaused && previewAvailable) playLocalPreview();
          socket.emit(isPaused ? "playback:play" : "playback:pause", { code: party.code, participantId: session.participantId });
        }}
        className="flex h-14 w-14 items-center justify-center rounded-full bg-primary-container text-primary shadow-lg active:scale-95"
        title={isPaused ? "Play" : "Pause"}
      >
        <span className="icon text-3xl">{isPaused ? "play_arrow" : "pause"}</span>
      </button>
      <button
        onClick={() => socket.emit("queue:skip", { code: party.code, participantId: session.participantId })}
        className="glass-card flex h-11 w-11 items-center justify-center rounded-full text-primary active:scale-95"
        title="Skip"
      >
        <span className="icon">skip_next</span>
      </button>
    </div>
  );
}

function VibeTokens({ party, session, song }: { party: Party; session: Session; song: Song }) {
  const userVote = song.votes?.find((v) => v.participantId === session.participantId)?.tokens ?? 0;
  const [selected, setSelected] = useState(userVote);

  useEffect(() => {
    setSelected(userVote);
  }, [song.id, userVote]);

  function update(next: number) {
    setSelected(next);
    socket.emit("vote:update", { code: party.code, participantId: session.participantId, songId: song.id, tokens: next });
  }
  return (
    <GlassCard className="w-full max-w-[420px] p-4 text-center">
      <h4 className="text-xs font-bold uppercase tracking-widest text-primary">Vibe Allocation</h4>
      <div className="mt-2 text-xs font-bold text-primary">Vibe Points: {selected}/5</div>
      <div className="mt-3 flex justify-center gap-3">
        {[1, 2, 3, 4, 5].map((value) => (
          <button key={value} onClick={() => update(selected === value ? value - 1 : value)} className={`h-9 w-9 rounded-full border-2 transition active:scale-90 ${value <= selected ? "border-primary-container bg-primary-container text-on-primary-container" : "border-outline-variant/40 bg-white/50"}`}>
            {value <= selected && <span className="icon text-sm">bolt</span>}
          </button>
        ))}
      </div>
    </GlassCard>
  );
}

function ReactionBar({
  party,
  session,
  song,
  onReact,
}: {
  party: Party;
  session: Session;
  song: Song;
  onReact: (type: ReactionType) => void;
}) {
  return (
    <div className="mt-3 flex flex-wrap justify-center gap-4">
      {reactions.map((reaction) => (
        <div key={reaction.type} className="flex flex-col items-center gap-1">
          <button
            onClick={() => {
              onReact(reaction.type);
              socket.emit("reaction:send", { code: party.code, participantId: session.participantId, songId: song.id, type: reaction.type });
            }}
            className="glass-card flex h-10 w-10 items-center justify-center transition active:scale-90"
            title={reaction.label}
          >
            {reaction.type === "GOAT" ? (
              <span className="text-xl leading-none">🐐</span>
            ) : (
              <span className={`icon ${reaction.color}`}>{reaction.icon}</span>
            )}
          </button>
          <span className="text-[10px] font-bold text-on-surface-variant">{song.reactionsByType[reaction.type] ?? 0}</span>
        </div>
      ))}
    </div>
  );
}

function QueuePanel({ party, session }: { party: Party; session: Session }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Track[]>([]);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const timeout = window.setTimeout(() => {
      searchTracks(query).then(({ tracks }) => setResults(tracks)).catch(() => setResults([]));
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [query]);

  return (
    <GlassCard className="max-h-[calc(100vh-96px)] overflow-hidden p-4">
      <div className="relative mb-4">
        <span className="icon absolute left-3 top-1/2 -translate-y-1/2 text-sm text-outline">search</span>
        <input value={query} onChange={(event) => setQuery(event.target.value)} className="w-full rounded-full border border-outline-variant/40 bg-surface-container-low py-2 pl-10 pr-4 text-sm outline-none focus:border-primary" placeholder="Add to queue..." />
      </div>
      {results.length > 0 && (
        <div className="mb-4 max-h-48 space-y-2 overflow-y-auto">
          {results.map((track) => (
            <TrackRow key={track.spotifyTrackId} track={track} onClick={() => socket.emit("queue:add", { code: party.code, participantId: session.participantId, track })} />
          ))}
        </div>
      )}
      <div className="mb-2 flex justify-between">
        <h3 className="text-xs font-bold uppercase tracking-widest text-primary">Upcoming</h3>
        <span className="text-[10px] font-bold text-on-surface-variant">{party.songs.length}/{formatLimit(party.maxSongs)} Songs</span>
      </div>
      <div className="max-h-[52vh] space-y-2 overflow-y-auto">
        {party.songs.map((song) => (
          <TrackRow key={song.id} track={song} meta={`added by ${song.submittedBy}`} />
        ))}
      </div>
    </GlassCard>
  );
}

function ResultsScreen({ party, onLeave }: { party: Party; onLeave: () => void }) {
  const ranked = [...party.songs].sort((a, b) => (b.finalScore ?? 0) - (a.finalScore ?? 0) || (b.reactionsByType.GOAT ?? 0) - (a.reactionsByType.GOAT ?? 0) || a.submissionOrder - b.submissionOrder);
  const winner = ranked[0];
  const totalTokens = party.songs.reduce((sum, song) => sum + song.voteTotal, 0);

  return (
    <main className="mx-auto max-w-screen-xl space-y-12 px-4 py-12">
      <div className="flex justify-end">
        <button onClick={onLeave} className="rounded-full bg-surface-container-high px-4 py-2 text-sm font-semibold text-on-surface-variant">Leave Party</button>
      </div>
      <div className="text-center">
        <h1 className="font-display text-5xl font-bold text-primary">Party Results</h1>
        <p className="mt-2 text-on-surface-variant">Session Recap & Highlights</p>
      </div>
      {winner ? (
        <GlassCard className="overflow-hidden p-8 md:p-12">
          <div className="flex flex-col items-center gap-8 md:flex-row">
            <div className="relative">
              <img src={winner.albumArtUrl} alt={winner.title} className="h-56 w-56 rounded-[24px] object-cover shadow-xl" />
              <div className="absolute -left-4 -top-4 rounded-full border border-primary/20 bg-white/90 px-5 py-2 text-sm font-bold text-primary shadow-glass">
                <span className="icon mr-1 text-base">workspace_premium</span>WINNER
              </div>
            </div>
            <div className="flex-1 text-center md:text-left">
              <span className="rounded-full bg-primary-container/50 px-3 py-1 text-xs font-bold text-on-primary-container">Highest Vibe Score: {winner.finalScore ?? 0}</span>
              <h2 className="mt-4 font-display text-5xl font-bold">{winner.title}</h2>
              <p className="mt-2 text-lg text-on-surface-variant">{winner.artist} - <span className="font-semibold text-primary">Added by {winner.submittedBy}</span></p>
              <div className="mt-6 flex flex-wrap justify-center gap-4 md:justify-start">
                <Stat label="Token Score" value={winner.tokenScore ?? 0} />
                <Stat label="Participation" value={winner.participationBonus ?? 0} />
                <Stat label="GOAT Bonus" value={`+${winner.goatBonus ?? 0}`} />
              </div>
            </div>
          </div>
        </GlassCard>
      ) : (
        <GlassCard className="p-10 text-center">No playable songs finished, so no winner could be crowned.</GlassCard>
      )}
      <section>
        <h3 className="mb-6 font-display text-3xl font-semibold">Final Standings</h3>
        <div className="space-y-4">
          {ranked.map((song, index) => (
            <GlassCard key={song.id} className="flex flex-col items-center gap-6 p-6 md:flex-row">
              <div className="flex flex-1 items-center gap-4">
                <div className="w-8 text-center font-display text-2xl text-outline">{index + 1}</div>
                <img src={song.albumArtUrl} alt={song.title} className="h-20 w-20 rounded-xl object-cover" />
                <div>
                  <p className="font-bold">{song.title}</p>
                  <p className="text-sm text-on-surface-variant">{song.artist} - {song.submittedBy}</p>
                </div>
              </div>
              <div className="text-right">
                <div className="font-display text-3xl font-semibold text-primary">{song.finalScore ?? 0}</div>
                <div className="text-[10px] font-bold uppercase tracking-widest text-outline">Final Score</div>
              </div>
            </GlassCard>
          ))}
        </div>
      </section>
      <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard icon="library_music" value={party.songs.filter((song) => song.status !== "QUEUED").length} label="Tracks Played" />
        <StatCard icon="toll" value={totalTokens} label="Total Vibe Tokens" />
        <StatCard icon="bolt" value={mostEnthusiastic(party)} label="Most Enthusiastic" />
        <StatCard icon="favorite" value={crowdPleaser(ranked)} label="Crowd Pleaser" />
      </section>
    </main>
  );
}

function ParticipantList({ participants, compact = false }: { participants: Party["participants"]; compact?: boolean }) {
  return (
    <GlassCard className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <h2 className="font-display text-2xl font-semibold text-primary">{compact ? "Crowd" : "Participants"}</h2>
        <span className="rounded-full bg-secondary-container px-3 py-1 text-xs font-bold text-on-secondary-container">{participants.length} Joined</span>
      </div>
      <div className={compact ? "space-y-3" : "grid grid-cols-2 gap-5 sm:grid-cols-4"}>
        {participants.map((participant) => (
          <div key={participant.id} className={compact ? "flex items-center gap-3" : "flex flex-col items-center gap-2"}>
            <Avatar participant={participant} />
            <div className={compact ? "min-w-0 flex-1" : "text-center"}>
              <p className="truncate text-sm font-semibold">{participant.displayName}{participant.isHost ? " (Host)" : ""}</p>
              {compact && <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">{participant.isHost ? "Host" : participant.isAway ? "Away" : "Listener"}</p>}
            </div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

function Avatar({ participant }: { participant: Party["participants"][number] }) {
  return (
    <div className={`flex h-12 w-12 items-center justify-center rounded-full font-bold ${participant.isHost ? "bg-primary-container text-primary" : "bg-tertiary-container text-tertiary"} ${participant.isAway ? "opacity-50" : ""}`}>
      {participant.displayName.slice(0, 1).toUpperCase()}
    </div>
  );
}

function GlassCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`glass-card ${className}`}>{children}</div>;
}

function AppHeader({ onLeave }: { onLeave: () => void }) {
  return (
    <header className="mb-10 flex items-center justify-between">
      <div className="font-display text-2xl font-bold text-primary">Nero Party</div>
      <button onClick={onLeave} className="rounded-full px-3 py-1.5 text-sm font-semibold text-on-surface-variant">
        <span className="icon mr-1 text-base">logout</span>Leave Party
      </button>
    </header>
  );
}

function Field(props: {
  icon: string;
  label: string;
  name: string;
  placeholder: string;
  required?: boolean;
  defaultValue?: string;
  maxLength?: number;
}) {
  const { icon, label, ...inputProps } = props;
  return (
    <label className="block">
      <span className="ml-1 text-xs font-bold uppercase tracking-widest text-on-surface-variant">{label}</span>
      <span className="relative mt-1 block">
        <span className="icon absolute left-4 top-1/2 -translate-y-1/2 text-outline">{icon}</span>
        <input {...inputProps} className="w-full rounded-xl border border-outline-variant/50 bg-white py-3.5 pl-12 pr-4 outline-none focus:border-primary focus:ring-4 focus:ring-primary/10" />
      </span>
    </label>
  );
}

function SliderSetting({
  label,
  value,
  min,
  max,
  unlimitedValue,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  unlimitedValue: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const sliderValue = value === 0 ? unlimitedValue : value;
  const displayValue = value === 0 ? "Unlimited" : value;

  return (
    <label className="block rounded-xl border border-outline-variant/50 bg-white/70 px-4 py-3">
      <span className="flex items-center justify-between text-xs font-bold uppercase tracking-widest text-on-surface-variant">
        {label}
        <strong className="font-display text-lg text-primary">{displayValue}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={unlimitedValue}
        step={step}
        value={sliderValue}
        onChange={(event) => {
          const nextValue = Number(event.target.value);
          onChange(nextValue === unlimitedValue ? 0 : Math.min(nextValue, max));
        }}
        className="mt-3 h-1.5 w-full cursor-pointer accent-primary"
      />
    </label>
  );
}

function Setting({ label, value }: { label: string; value: string | number }) {
  return <div className="flex justify-between border-b border-outline-variant/20 pb-3"><dt>{label}</dt><dd className="font-bold text-primary">{value}</dd></div>;
}

function Activity({ events }: { events: Party["events"] }) {
  return (
    <GlassCard className="space-y-2 bg-primary-container/20 p-4">
      {events.length === 0 ? <p className="text-sm text-primary">Waiting for activity...</p> : events.map((event) => <p key={event.id} className="text-sm font-semibold text-primary"><span className="icon mr-2 text-base">info</span>{event.message}</p>)}
    </GlassCard>
  );
}

function TrackRow({ track, meta, onClick }: { track: Track; meta?: string; onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-3 rounded-xl p-2 text-left transition hover:bg-white/60">
      <img src={track.albumArtUrl} alt={track.title} className="h-12 w-12 rounded-lg object-cover" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{track.title}</span>
        <span className="block truncate text-xs text-on-surface-variant">{meta ?? track.artist}</span>
      </span>
      {onClick && <span className="icon text-primary">add</span>}
    </button>
  );
}

function EmptyQueue() {
  return <GlassCard className="p-10 text-center text-on-surface-variant">The queue is empty.</GlassCard>;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-xl bg-white/50 px-6 py-4 text-center"><p className="text-xs font-bold text-on-surface-variant">{label}</p><p className="font-display text-2xl font-semibold text-primary">{value}</p></div>;
}

function StatCard({ icon, value, label }: { icon: string; value: string | number; label: string }) {
  return <GlassCard className="p-8 text-center"><span className="icon text-4xl text-primary">{icon}</span><p className="mt-4 font-display text-4xl font-bold">{value}</p><p className="text-sm text-on-surface-variant">{label}</p></GlassCard>;
}

function useElapsed(party: Party, song?: Song) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);
  return useMemo(() => {
    return getPartyElapsed(party, song, now);
  }, [now, party.elapsedMs, party.playbackPausedAt, party.playbackStartedAt, song]);
}

function getPartyElapsed(party: Party, song?: Song, now = Date.now()) {
  if (!song || !party.playbackStartedAt || party.playbackPausedAt) return party.elapsedMs;
  return Math.min(song.durationMs, party.elapsedMs + now - new Date(party.playbackStartedAt).getTime());
}

function parseRoute() {
  const path = window.location.pathname;
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "join") return { view: "join" as const, code: parts[1] };
  if (parts[0] === "party") {
    const code = parts[1];
    const suffix = parts[2];
    return { view: suffix === "lobby" ? "lobby" as const : suffix === "results" ? "results" as const : "party" as const, code };
  }
  return { view: "join" as const, code: undefined };
}

function formatMs(ms: number) {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function formatTimeLimit(value: Party["timeLimit"]) {
  const labels = {
    NONE: "None",
    ONE_HOUR: "1 hour",
    TWO_HOURS: "2 hours",
    THREE_HOURS: "3 hours",
  };
  return labels[value];
}

function formatLimit(value: number) {
  return value === 0 ? "Unlimited" : value;
}

function spotifyPlaybackLabel(song: Song) {
  return song.previewUrl ? "Playing preview audio" : "Spotify playback ready";
}

function mostEnthusiastic(party: Party) {
  const participant = party.participants[0];
  return participant?.displayName ?? "N/A";
}

function crowdPleaser(ranked: Song[]) {
  return ranked[0]?.submittedBy ?? "N/A";
}

export default App;
