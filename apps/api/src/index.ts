import "dotenv/config";
import cors from "cors";
import express from "express";
import { createServer } from "node:http";
import { authRouter, uploadsRoot } from "./routes/auth.js";
import { jobsRouter } from "./routes/jobs.js";
import { huntingRouter } from "./routes/hunting.js";
import { calendarRouter } from "./routes/calendar.js";
import { calendarSharesRouter } from "./routes/calendarShares.js";
import { transactionsRouter } from "./routes/transactions.js";
import { discussionsRouter } from "./routes/discussions.js";
import { chatRouter } from "./routes/chat.js";
import { reportsRouter } from "./routes/reports.js";
import { adminRouter } from "./routes/admin.js";
import { integrationsRouter } from "./routes/integrations.js";
import { attachChatRealtime } from "./realtime/chat.js";

const app = express();
const port = Number(process.env.PORT ?? 4000);
const httpServer = createServer(app);

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "3mb" }));
app.use("/uploads", express.static(uploadsRoot));

app.get("/api/v1/health", (_req, res) => {
  res.json({ data: { ok: true, service: "worksphere-api" } });
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/jobs", jobsRouter);
app.use("/api/v1/hunting", huntingRouter);
app.use("/api/v1/calendar/shares", calendarSharesRouter);
app.use("/api/v1/calendar", calendarRouter);
app.use("/api/v1/integrations", integrationsRouter);
app.use("/api/v1/transactions", transactionsRouter);
app.use("/api/v1/discussions", discussionsRouter);
app.use("/api/v1/chat", chatRouter);
app.use("/api/v1/reports", reportsRouter);
app.use("/api/v1/admin", adminRouter);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: { code: "INTERNAL", message: "Server error" } });
});

attachChatRealtime(httpServer);

httpServer.listen(port, () => {
  console.log(`WorkSphere API listening on http://localhost:${port}`);
});
