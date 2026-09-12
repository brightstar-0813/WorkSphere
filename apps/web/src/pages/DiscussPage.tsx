import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api";

type Reply = { id: string; body: string; author: { name: string } };
type Discussion = {
  id: string;
  title: string;
  body: string;
  replies: Reply[];
};

export function DiscussPage() {
  const { t } = useTranslation();
  const [items, setItems] = useState<Discussion[]>([]);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});

  async function load() {
    setItems(await api<Discussion[]>("/discussions"));
  }

  useEffect(() => {
    void load();
  }, []);

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    await api("/discussions", { method: "POST", body: JSON.stringify({ title, body }) });
    setTitle("");
    setBody("");
    await load();
  }

  async function reply(id: string) {
    const text = replyDrafts[id]?.trim();
    if (!text) return;
    await api(`/discussions/${id}/replies`, {
      method: "POST",
      body: JSON.stringify({ body: text }),
    });
    setReplyDrafts((d) => ({ ...d, [id]: "" }));
    await load();
  }

  return (
    <section className="page">
      <h1>{t("discuss.heading")}</h1>
      <form className="stack panel" onSubmit={onAdd}>
        <input
          placeholder={`${t("common.title")}…`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <textarea
          placeholder={`${t("common.body")}…`}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          required
          rows={3}
        />
        <button className="btn primary">{t("discuss.new")}</button>
      </form>
      <div className="list">
        {items.length === 0 && <p className="muted">{t("common.empty")}</p>}
        {items.map((d) => (
          <article key={d.id} className="panel">
            <strong>{d.title}</strong>
            <p>{d.body}</p>
            <div className="replies">
              {d.replies.map((r) => (
                <p key={r.id} className="muted">
                  <strong>{r.author.name}</strong>: {r.body}
                </p>
              ))}
            </div>
            <div className="toolbar">
              <input
                placeholder={t("common.reply")}
                value={replyDrafts[d.id] ?? ""}
                onChange={(e) => setReplyDrafts((x) => ({ ...x, [d.id]: e.target.value }))}
              />
              <button type="button" className="btn" onClick={() => void reply(d.id)}>
                {t("common.reply")}
              </button>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
