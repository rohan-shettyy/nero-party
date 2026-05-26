import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const env = {
  PORT: process.env.PORT || 3000,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5173",
  ALLOWED_ORIGINS: Array.from(
    new Set([
      process.env.FRONTEND_ORIGIN || "http://127.0.0.1:5173",
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ]),
  ),
  SPOTIFY_REDIRECT_URI:
    process.env.SPOTIFY_REDIRECT_URI || "http://127.0.0.1:5173/spotify/callback",
  SPOTIFY_CLIENT_ID: process.env.SPOTIFY_CLIENT_ID || "",
  SPOTIFY_CLIENT_SECRET: process.env.SPOTIFY_CLIENT_SECRET || "",
};
