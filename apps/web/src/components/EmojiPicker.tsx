import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { CHAT_EMOJI_ALLOWLIST, CHAT_QUICK_EMOJIS } from "../lib/chatEmoji";

type Props = {
  open: boolean;
  onClose: () => void;
  onPick: (emoji: string) => void;
  /** Prefer anchoring above for message rows, below for composer */
  placement?: "above" | "below";
};

export function EmojiPicker({ open, onClose, onPick, placement = "above" }: Props) {
  const { t } = useTranslation();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    function onPointer(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) onClose();
    }
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={rootRef}
      id={panelId}
      className={`discuss-emoji-picker ${placement === "below" ? "below" : "above"}`}
      role="dialog"
      aria-label={t("discuss.emojiPicker")}
    >
      <div className="discuss-emoji-quick" role="group" aria-label={t("discuss.quickReactions")}>
        {CHAT_QUICK_EMOJIS.map((emoji) => (
          <button
            key={`q-${emoji}`}
            type="button"
            className="discuss-emoji-btn"
            onClick={() => {
              onPick(emoji);
              onClose();
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
      <div className="discuss-emoji-grid" role="listbox" aria-label={t("discuss.allEmojis")}>
        {CHAT_EMOJI_ALLOWLIST.map((emoji) => (
          <button
            key={emoji}
            type="button"
            className="discuss-emoji-btn"
            role="option"
            onClick={() => {
              onPick(emoji);
              onClose();
            }}
          >
            {emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
