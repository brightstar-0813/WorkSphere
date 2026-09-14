/** Curated emoji set for Discuss — keep in sync with apps/api/src/chatEmoji.ts */

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

export type ChatReaction = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
};

export function aggregateReactionsForViewer(
  rows: Array<{ emoji: string; userId: string }>,
  viewerId: string,
): ChatReaction[] {
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

export function insertAtCursor(
  value: string,
  insert: string,
  start: number,
  end: number,
  maxLength = 4000,
): { value: string; caret: number } {
  const before = value.slice(0, start);
  const after = value.slice(end);
  const next = `${before}${insert}${after}`.slice(0, maxLength);
  const caret = Math.min(before.length + insert.length, next.length);
  return { value: next, caret };
}
