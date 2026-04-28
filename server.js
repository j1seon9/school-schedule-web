import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import { timingSafeEqual, randomBytes } from "crypto";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

dotenv.config();

const API_KEY     = (process.env.API_KEY     || "").trim();
const PORT        = Number(process.env.PORT  || 8000);
const BASE_URL    = "https://open.neis.go.kr/hub";
const MONGODB_URI = process.env.MONGODB_URI  || "mongodb://localhost:27017/discord_bot";

const ADMIN_ID       = (process.env.ADMIN_ID       || "admin").trim();
const ADMIN_PASSWORD =  process.env.ADMIN_PASSWORD || "admin1234";
const hasAdminAuthKeyConfig = typeof process.env.ADMIN_AUTH_KEY === "string";
const ADMIN_AUTH_KEY = hasAdminAuthKeyConfig ? process.env.ADMIN_AUTH_KEY.trim() : "change-this-admin-key";
const ADMIN_AUTH_KEY_REQUIRED = ADMIN_AUTH_KEY.length > 0;

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const RATE_LIMIT          = 120;
const WINDOW_MS           = 60_000;
const DDOS_ALERT_THRESHOLD = Math.ceil(RATE_LIMIT * 0.8);
const NOTICE_MAX_LENGTH   = 300;
const NOTICE_MAX_ITEMS    = 100;
const TOKEN_TTL_MS        = 5 * 60 * 1000; // 5분

if (!API_KEY) console.warn("[WARN] API_KEY is not set.");

// ── MongoDB 스키마 ────────────────────────────────────────

// 공지사항
const noticeSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  text:      { type: String, required: true },
  date:      { type: String, required: true },
  createdAt: { type: Number, required: true }
});
const Notice = mongoose.model("Notice", noticeSchema);

// 사용자
const userSchema = new mongoose.Schema({
  discordId:  { type: String, default: "" },
  schoolCode: { type: String, required: true },
  officeCode: { type: String, required: true },
  schoolName: { type: String, required: true },
  officeName: { type: String, default: "" },
  type:       { type: String, default: "" },
  grade:      { type: String, required: true },
  classNo:    { type: String, required: true },
  agreedAt:   { type: Date, default: Date.now },
  createdAt:  { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

// 임시 토큰
const pendingTokenSchema = new mongoose.Schema({
  token:     { type: String, required: true, unique: true },
  userData:  { type: Object, required: true },
  expiresAt: { type: Date,   required: true }
});
const PendingToken = mongoose.model("PendingToken", pendingTokenSchema);

// ── MongoDB 연결 ──────────────────────────────────────────
let dbConnected = false;

async function initDb() {
  while (true) {
    try {
      await mongoose.connect(MONGODB_URI);
      dbConnected = true;
      console.log("✅ MongoDB 연결 완료");
      break;
    } catch (e) {
      dbConnected = false;
      console.error(`⚠️ MongoDB 연결 실패: ${e.message} → 5초 후 재시도`);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

mongoose.connection.on("disconnected", () => {
  dbConnected = false;
  console.warn("⚠️ MongoDB 연결 끊김 → 재연결 시도");
  initDb();
});

mongoose.connection.on("connected", () => {
  dbConnected = true;
});

// ── 공지사항 헬퍼 ─────────────────────────────────────────
async function readNotices() {
  if (!dbConnected) return [];
  try {
    const docs = await Notice.find().sort({ createdAt: -1 }).limit(NOTICE_MAX_ITEMS);
    return docs.map(d => ({ id: d.id, text: d.text, date: d.date, createdAt: d.createdAt }));
  } catch (e) {
    console.error("공지 읽기 오류:", e.message);
    return [];
  }
}

// ── Express 앱 ────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

let totalRequests = 0;
let todayRequests = 0;
let todayDateKey  = "";
const ipCounter   = new Map();

function toKstDateKey() {
  const now = new Date();
  const utcTime = now.getTime() + now.getTimezoneOffset() * 60_000;
  return new Date(utcTime + 9 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
}

function toKstDashDate() {
  const ymd = toKstDateKey();
  return `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`;
}

function normalizeIp(ip = "") {
  if (!ip) return "unknown";
  if (ip === "::1") return "127.0.0.1";
  if (ip.startsWith("::ffff:")) return ip.slice(7);
  return ip;
}

function safeEqualText(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function requireAdminAuth(req, res, next) {
  const id       = String(req.get("x-admin-id")       || "").trim();
  const password = String(req.get("x-admin-password") || "");
  const key      = String(req.get("x-admin-key")      || "").trim();
  const keyValid = ADMIN_AUTH_KEY_REQUIRED ? safeEqualText(key, ADMIN_AUTH_KEY) : true;
  const valid    = safeEqualText(id, ADMIN_ID) && safeEqualText(password, ADMIN_PASSWORD) && keyValid;
  if (!valid) return res.status(401).json({ error: "UNAUTHORIZED" });
  return next();
}

function pruneIpCounter(now = Date.now()) {
  for (const [ip, hits] of ipCounter.entries()) {
    const recent = hits.filter(t => now - t < WINDOW_MS);
    if (recent.length === 0) { ipCounter.delete(ip); continue; }
    ipCounter.set(ip, recent);
  }
}

function getDdosSnapshot() {
  pruneIpCounter();
  const suspicious = [];
  for (const [ip, hits] of ipCounter.entries()) {
    if (hits.length >= DDOS_ALERT_THRESHOLD) suspicious.push({ ip, count: hits.length });
  }
  suspicious.sort((a, b) => b.count - a.count);
  return { trackedIps: ipCounter.size, windowMs: WINDOW_MS, rateLimit: RATE_LIMIT, alertThreshold: DDOS_ALERT_THRESHOLD, suspicious };
}

function getSystemSnapshot() {
  const mem = process.memoryUsage();
  return {
    cpuLoad:   Number(os.loadavg()[0].toFixed(2)),
    memoryMb:  Number((mem.rss / 1024 / 1024).toFixed(2)),
    uptimeSec: Math.floor(process.uptime())
  };
}

// Rate limit 미들웨어
app.use((req, res, next) => {
  totalRequests += 1;
  const nowDate = toKstDateKey();
  if (todayDateKey !== nowDate) { todayDateKey = nowDate; todayRequests = 0; }
  todayRequests += 1;

  const ip = normalizeIp(req.ip);
  const now = Date.now();
  const current = ipCounter.get(ip) || [];
  const recent = current.filter(t => now - t < WINDOW_MS);
  recent.push(now);
  ipCounter.set(ip, recent);

  if (recent.length > RATE_LIMIT) return res.status(429).json({ error: "RATE_LIMIT" });
  return next();
});

function sanitizeNoticeText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim().slice(0, NOTICE_MAX_LENGTH);
}

function requireApiKey(res) {
  if (API_KEY) return true;
  res.status(500).json({ error: "API_KEY_MISSING" });
  return false;
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function parseNeisResult(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.RESULT && typeof payload.RESULT.CODE === "string") return payload.RESULT;
  for (const value of Object.values(payload)) {
    if (!Array.isArray(value)) continue;
    const fromHead = value?.[0]?.head?.[1]?.RESULT;
    if (fromHead && typeof fromHead.CODE === "string") return fromHead;
  }
  return null;
}

function mapKindToDataset(kind = "") {
  const k = String(kind).toLowerCase();
  if (k.includes("\uCD08")) return "elsTimetable";
  if (k.includes("\uC911")) return "misTimetable";
  if (k.includes("\uACE0")) return "hisTimetable";
  return "hisTimetable";
}

async function resolveDatasetBySchoolCode(schoolCode) {
  if (!API_KEY) return "hisTimetable";
  try {
    const url = `${BASE_URL}/schoolInfo?KEY=${API_KEY}&Type=json&SD_SCHUL_CODE=${schoolCode}`;
    const payload = await fetchJson(url);
    const kind = payload?.schoolInfo?.[1]?.row?.[0]?.SCHUL_KND_SC_NM || "";
    return mapKindToDataset(kind);
  } catch { return "hisTimetable"; }
}

function normalizeYmdInput(value) {
  const raw = String(value || "").trim();
  if (/^\d{8}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.replace(/-/g, "");
  return "";
}

function formatDateToYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// ── 회원가입 라우트 ───────────────────────────────────────

// 회원가입 페이지
app.get("/register", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "register.html"));
});

// 회원가입 처리 → 임시 토큰 발급
app.post("/api/register", async (req, res) => {
  try {
    const { schoolCode, officeCode, schoolName, officeName, type, grade, classNo } = req.body;
    if (!schoolCode || !officeCode || !schoolName || !grade || !classNo) {
      return res.status(400).json({ error: "필수 항목이 누락되었습니다." });
    }

    // 6자리 숫자 토큰 생성
    const token = String(Math.floor(100000 + randomBytes(3).readUIntBE(0, 3) % 900000));
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

    await PendingToken.findOneAndDelete({ token }); // 혹시 중복이면 삭제
    await PendingToken.create({
      token,
      userData: { schoolCode, officeCode, schoolName, officeName: officeName || "", type: type || "", grade, classNo },
      expiresAt
    });

    // 만료된 토큰 정리
    await PendingToken.deleteMany({ expiresAt: { $lt: new Date() } });

    res.json({ ok: true, token, expiresAt });
  } catch (e) {
    res.status(500).json({ error: "REGISTER_ERROR", message: e.message });
  }
});

// 토큰 검증 + Discord ID 연결 (봇에서 호출)
app.post("/api/verify", async (req, res) => {
  try {
    const { token, discordId, guildId } = req.body;
    if (!token || !discordId) return res.status(400).json({ error: "TOKEN_AND_DISCORDID_REQUIRED" });

    const pending = await PendingToken.findOne({ token });
    if (!pending) return res.status(404).json({ error: "TOKEN_NOT_FOUND" });
    if (pending.expiresAt < new Date()) {
      await PendingToken.deleteOne({ token });
      return res.status(410).json({ error: "TOKEN_EXPIRED" });
    }

    // 사용자 저장 (discordId 기준 upsert)
    const userData = {
      ...pending.userData,
      discordId,
      guildId: guildId || ""
    };

    await User.findOneAndUpdate(
      { discordId },
      { ...userData, createdAt: new Date() },
      { upsert: true, new: true }
    );

    await PendingToken.deleteOne({ token });

    res.json({ ok: true, user: userData });
  } catch (e) {
    res.status(500).json({ error: "VERIFY_ERROR", message: e.message });
  }
});

// 사용자 정보 조회 (봇에서 호출)
app.get("/api/user/:discordId", async (req, res) => {
  try {
    const discordId = String(req.params.discordId || "").trim();
    if (!discordId) return res.status(400).json({ error: "DISCORDID_REQUIRED" });

    const user = await User.findOne({ discordId });
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND" });

    res.json({
      schoolCode: user.schoolCode,
      officeCode: user.officeCode,
      schoolName: user.schoolName,
      officeName: user.officeName,
      type:       user.type,
      grade:      user.grade,
      classNo:    user.classNo
    });
  } catch (e) {
    res.status(500).json({ error: "USER_FETCH_ERROR", message: e.message });
  }
});

// ── 기존 라우트 ───────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString(), db: dbConnected });
});

app.get("/api/notices", async (req, res) => {
  try {
    const notices = await readNotices();
    res.json(notices.map(({ id, date, text }) => ({ id, date, text })));
  } catch (err) {
    res.status(500).json({ error: "NOTICE_READ_ERROR", message: err.message });
  }
});

app.get("/admin/monitor", requireAdminAuth, async (req, res) => {
  try {
    const notices = await readNotices();
    const ddos = getDdosSnapshot();
    res.json({
      traffic:  { total: totalRequests, today: todayRequests },
      system:   getSystemSnapshot(),
      security: { trackedIps: ddos.trackedIps, suspiciousCount: ddos.suspicious.length, rateLimit: RATE_LIMIT, windowMs: WINDOW_MS },
      notices:  { total: notices.length }
    });
  } catch (err) {
    res.status(500).json({ error: "ADMIN_MONITOR_ERROR", message: err.message });
  }
});

app.get("/admin/ddos", requireAdminAuth, (req, res) => {
  res.json(getDdosSnapshot());
});

app.get("/admin/notices", requireAdminAuth, async (req, res) => {
  try {
    const notices = await readNotices();
    res.json(notices.map(({ id, date, text }) => ({ id, date, text })));
  } catch (err) {
    res.status(500).json({ error: "NOTICE_LIST_ERROR", message: err.message });
  }
});

app.post("/admin/notices", requireAdminAuth, async (req, res) => {
  try {
    const text = sanitizeNoticeText(req.body?.text);
    if (!text) return res.status(400).json({ error: "NOTICE_TEXT_REQUIRED" });

    const notice = {
      id:        `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`,
      text,
      date:      toKstDashDate(),
      createdAt: Date.now()
    };

    await Notice.create(notice);
    const notices = await readNotices();
    res.status(201).json({ ok: true, notice: { id: notice.id, date: notice.date, text: notice.text }, total: notices.length });
  } catch (err) {
    res.status(500).json({ error: "NOTICE_CREATE_ERROR", message: err.message });
  }
});

app.patch("/admin/notices/:id", requireAdminAuth, async (req, res) => {
  try {
    const id   = String(req.params.id || "").trim();
    const text = sanitizeNoticeText(req.body?.text);
    if (!id)   return res.status(400).json({ error: "NOTICE_ID_REQUIRED" });
    if (!text) return res.status(400).json({ error: "NOTICE_TEXT_REQUIRED" });

    const updated = await Notice.findOneAndUpdate({ id }, { text, date: toKstDashDate() }, { new: true });
    if (!updated) return res.status(404).json({ error: "NOTICE_NOT_FOUND" });

    const notices = await readNotices();
    res.json({ ok: true, notice: { id: updated.id, date: updated.date, text: updated.text }, total: notices.length });
  } catch (err) {
    res.status(500).json({ error: "NOTICE_UPDATE_ERROR", message: err.message });
  }
});

app.delete("/admin/notices/:id", requireAdminAuth, async (req, res) => {
  try {
    const id = String(req.params.id || "").trim();
    if (!id) return res.status(400).json({ error: "NOTICE_ID_REQUIRED" });

    const removed = await Notice.findOneAndDelete({ id });
    if (!removed) return res.status(404).json({ error: "NOTICE_NOT_FOUND" });

    const notices = await readNotices();
    res.json({ ok: true, total: notices.length });
  } catch (err) {
    res.status(500).json({ error: "NOTICE_DELETE_ERROR", message: err.message });
  }
});

app.get("/api/searchSchool", async (req, res) => {
  if (!requireApiKey(res)) return;
  try {
    const name = String(req.query.name || "").trim();
    if (!name) return res.json([]);

    const url = `${BASE_URL}/schoolInfo?KEY=${API_KEY}&Type=json&SCHUL_NM=${encodeURIComponent(name)}`;
    const payload = await fetchJson(url);
    const result = parseNeisResult(payload);
    if (result?.CODE && result.CODE !== "INFO-000" && result.CODE !== "INFO-200") {
      return res.status(502).json({ error: "NEIS_API_ERROR", code: result.CODE, message: result.MESSAGE || "" });
    }

    const rows = payload?.schoolInfo?.[1]?.row;
    if (!Array.isArray(rows)) return res.json([]);

    res.json(rows.map(item => ({
      name:       item.SCHUL_NM,
      schoolCode: item.SD_SCHUL_CODE,
      officeCode: item.ATPT_OFCDC_SC_CODE,
      officeName: item.ATPT_OFCDC_SC_NM,
      type:       item.SCHUL_KND_SC_NM
    })));
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

app.get("/api/dailyTimetable", async (req, res) => {
  if (!requireApiKey(res)) return;
  try {
    const schoolCode = String(req.query.schoolCode || "").trim();
    const officeCode = String(req.query.officeCode || "").trim();
    const grade      = String(req.query.grade      || "").trim();
    const classNo    = String(req.query.classNo    || "").trim();
    if (!schoolCode || !officeCode || !grade || !classNo) return res.json([]);

    const date    = toKstDateKey();
    const dataset = await resolveDatasetBySchoolCode(schoolCode);
    const url = `${BASE_URL}/${dataset}?KEY=${API_KEY}&Type=json` +
      `&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&ALL_TI_YMD=${date}` +
      `&GRADE=${grade}&CLASS_NM=${classNo}`;

    const payload = await fetchJson(url);
    const rows = payload?.[dataset]?.[1]?.row;
    if (!Array.isArray(rows)) return res.json([]);

    res.json(rows.map(item => ({ date: item.ALL_TI_YMD, period: item.PERIO, subject: item.ITRT_CNTNT })));
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

app.get("/api/weeklyTimetable", async (req, res) => {
  if (!requireApiKey(res)) return;
  try {
    const schoolCode = String(req.query.schoolCode || "").trim();
    const officeCode = String(req.query.officeCode || "").trim();
    const grade      = String(req.query.grade      || "").trim();
    const classNo    = String(req.query.classNo    || "").trim();
    const startDate  = normalizeYmdInput(req.query.startDate);
    if (!schoolCode || !officeCode || !grade || !classNo || !startDate) return res.json([]);

    const start = new Date(Number(startDate.slice(0, 4)), Number(startDate.slice(4, 6)) - 1, Number(startDate.slice(6, 8)));
    const end = new Date(start);
    end.setDate(end.getDate() + 4);
    const endDate = formatDateToYmd(end);

    const dataset = await resolveDatasetBySchoolCode(schoolCode);
    const url = `${BASE_URL}/${dataset}?KEY=${API_KEY}&Type=json` +
      `&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}` +
      `&GRADE=${grade}&CLASS_NM=${classNo}&TI_FROM_YMD=${startDate}&TI_TO_YMD=${endDate}`;

    const payload = await fetchJson(url);
    const rows = payload?.[dataset]?.[1]?.row;
    if (!Array.isArray(rows)) return res.json([]);

    res.json(rows.map(item => ({ date: item.ALL_TI_YMD, period: item.PERIO, subject: item.ITRT_CNTNT })));
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

app.get("/api/dailyMeal", async (req, res) => {
  if (!requireApiKey(res)) return;
  try {
    const schoolCode = String(req.query.schoolCode || "").trim();
    const officeCode = String(req.query.officeCode || "").trim();
    if (!schoolCode || !officeCode) return res.json({ menu: "" });

    const date = toKstDateKey();
    const url = `${BASE_URL}/mealServiceDietInfo?KEY=${API_KEY}&Type=json` +
      `&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}&MLSV_YMD=${date}`;

    const payload = await fetchJson(url);
    const row = payload?.mealServiceDietInfo?.[1]?.row?.[0];
    res.json({ menu: row?.DDISH_NM || "" });
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

app.get("/api/monthlyMeal", async (req, res) => {
  if (!requireApiKey(res)) return;
  try {
    const schoolCode = String(req.query.schoolCode || "").trim();
    const officeCode = String(req.query.officeCode || "").trim();
    const startDate  = normalizeYmdInput(req.query.startDate);
    const endDate    = normalizeYmdInput(req.query.endDate);
    if (!schoolCode || !officeCode || !startDate || !endDate) return res.json([]);

    const url = `${BASE_URL}/mealServiceDietInfo?KEY=${API_KEY}&Type=json` +
      `&ATPT_OFCDC_SC_CODE=${officeCode}&SD_SCHUL_CODE=${schoolCode}` +
      `&MLSV_FROM_YMD=${startDate}&MLSV_TO_YMD=${endDate}`;

    const payload = await fetchJson(url);
    const rows = payload?.mealServiceDietInfo?.[1]?.row;
    if (!Array.isArray(rows)) return res.json([]);

    res.json(rows.map(item => ({ date: item.MLSV_YMD, menu: item.DDISH_NM })));
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

// ── 서버 시작 ─────────────────────────────────────────────
initDb().finally(() => {
  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
  });
});