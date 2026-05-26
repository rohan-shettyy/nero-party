# Nero Party

Nero Party is a real-time listening party app where a host creates a lobby, guests join with a six-character alphanumeric code, everyone adds Spotify tracks to a shared queue, votes with Vibe Tokens, sends reactions, and sees a final leaderboard.

## Stack

- Backend: Express, Socket.IO, Prisma
- Frontend: React, Vite, TailwindCSS
- Database: SQLite
- Music: Spotify Web API and Spotify Web Playback SDK

## Spotify Requirements

Spotify connection is required before hosting or joining. Full browser playback uses Spotify's Web Playback SDK.

Create a Spotify developer app and add this redirect URI:

```txt
http://127.0.0.1:5173/spotify/callback
```

## Setup

```bash
npm install
copy .env.example .env
```

Fill in `.env`:

```txt
PORT=3000
FRONTEND_ORIGIN=http://127.0.0.1:5173
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/spotify/callback
```

Set up the database:

```bash
cd backend
npx prisma generate
npx prisma migrate dev
cd ..
```

Start both apps:

```bash
npm run dev
```

- Backend: `http://127.0.0.1:3000`
- Frontend: `http://127.0.0.1:5173`

## Project Structure

```
nero-party/
├── backend/          # Express + Socket.IO server
│   ├── prisma/       # Database schema & migrations
│   └── src/          # Server source code
└── frontend/         # React + Vite client
    └── src/          # Client source code
```

## Tech Stack

- **Backend:** Express.js, Prisma, Socket.IO
- **Frontend:** React, Vite, TailwindCSS
- **Database:** SQLite (local)
- **External API:** Music API of your choice (for song search and playback)

## Demo Flow

1. Connect Spotify, then host a lobby or join with a code like `NR4X9Z`.
2. Open additional tabs to simulate guests; each tab joins as a separate Nero participant even if Spotify uses the same account.
3. Configure lobby settings as the host, including max songs, songs per person, and time limit. Song limits can be set to unlimited.
4. Search Spotify tracks and add them to the queue.
5. Start the party once 2 participants, 1 queued song, and host Spotify playback are ready.
6. Vote with Vibe Tokens and send reactions while songs play.
7. View the winner, score breakdown, final standings, and stats.
