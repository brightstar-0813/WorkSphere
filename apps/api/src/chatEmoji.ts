/** Curated emoji set for Discuss (composer + reactions), Slack/Teams-style. */

export const CHAT_QUICK_EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🎉", "👏", "✅"] as const;

export const CHAT_EMOJI_ALLOWLIST = [
  ...CHAT_QUICK_EMOJIS,
  "😀",
  "😁",
  "😊",
  "🙂",
  "😉",
  "😎",
  "🤔",
  "😴",
  "🙌",
  "👋",
  "🙏",
  "💪",
  "🔥",
  "✨",
  "⭐",
  "💯",
  "👀",
  "🚀",
  "💡",
  "📌",
  "📎",
  "🗓️",
  "⏰",
  "💼",
  "🤝",
  "📣",
  "📝",
  "❗",
  "❓",
  "🆗",
  "🟢",
  "🟡",
  "🔴",
] as const;

const ALLOWED = new Set<string>(CHAT_EMOJI_ALLOWLIST);

export function isAllowedChatEmoji(emoji: string): boolean {
  return ALLOWED.has(String(emoji || "").trim());
}

export type ReactionAgg = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

export function aggregateReactions(
  rows: Array<{ emoji: string; userId: string }>,
  viewerId: string,
): ReactionAgg[] {
  const map = new Map<string, { count: number; reactedByMe: boolean }>();
  for (const row of rows) {
    const cur = map.get(row.emoji) ?? { count: 0, reactedByMe: false };
    cur.count += 1;
    if (row.userId === viewerId) cur.reactedByMe = true;
    map.set(row.emoji, cur);
  }
  return [...map.entries()]
    .map(([emoji, v]) => ({ emoji, count: v.count, reactedByMe: v.reactedByMe }))
    .sort((a, b) => b.count - a.count || a.emoji.localeCompare(b.emoji));
}
