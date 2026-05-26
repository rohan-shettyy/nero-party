import { ScoreBreakdown, ScoreInput } from "./types.js";

export function calculateVibeScore(input: ScoreInput): ScoreBreakdown {
  const voters = input.votes.filter((vote) => vote.tokens > 0);
  if (voters.length === 0) {
    return {
      finalScore: 0,
      tokenScore: 0,
      participationBonus: 0,
      goatBonus: 0,
      skipPenaltyApplied: false,
    };
  }

  const averageTokens =
    voters.reduce((sum, vote) => sum + Math.max(0, Math.min(5, vote.tokens)), 0) /
    voters.length;
  const tokenScore = (averageTokens / 5) * 70;
  const participationBonus =
    input.participantCount <= 0 ? 0 : (voters.length / input.participantCount) * 20;
  const goatCount = input.reactions.filter((reaction) => reaction.type === "GOAT").length;
  const goatBonus = Math.min(goatCount * 2, 10);
  const skippedEarly =
    typeof input.skippedAtMs === "number" && input.skippedAtMs < input.durationMs * 0.5;
  const rawScore = tokenScore + participationBonus + goatBonus;
  const finalScore = skippedEarly ? rawScore * 0.8 : rawScore;

  return {
    finalScore: Math.round(Math.min(finalScore, 100) * 10) / 10,
    tokenScore: Math.round(tokenScore * 10) / 10,
    participationBonus: Math.round(participationBonus * 10) / 10,
    goatBonus,
    skipPenaltyApplied: skippedEarly,
  };
}
