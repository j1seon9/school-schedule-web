// server.js

import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import { createCipheriv, createDecipheriv, createHmac, pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import { fileURLToPath } from "url";
import mongoose from "mongoose";

dotenv.config();
mongoose.set("strictQuery", true);

// ── Runtime configuration ─────────────────────────────────

const API_KEY     = (process.env.API_KEY     || "").trim();
const PORT        = Number(process.env.PORT  || 8000);
const BASE_URL    = "https://open.neis.go.kr/hub";
const MONGODB_URI = process.env.MONGODB_URI  || "mongodb://localhost:27017/discord_bot";

const ADMIN_ID       = (process.env.ADMIN_ID       || "").trim();
const ADMIN_PASSWORD =  process.env.ADMIN_PASSWORD || "";

const hasAdminAuthKeyConfig = typeof process.env.ADMIN_AUTH_KEY === "string";
const ADMIN_AUTH_KEY = hasAdminAuthKeyConfig ? process.env.ADMIN_AUTH_KEY.trim() : "change-this-admin-key";
const ADMIN_AUTH_KEY_REQUIRED = hasAdminAuthKeyConfig && ADMIN_AUTH_KEY.length > 0;
const BOT_API_KEY = (process.env.BOT_API_KEY || "").trim();
const BOT_API_KEY_REQUIRED = BOT_API_KEY.length > 0;
const CORS_ORIGINS = String(process.env.CORS_ORIGINS || "")
  .split(",")
  .map(origin => origin.trim())
  .filter(Boolean);

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const RATE_LIMIT          = 120;
const WINDOW_MS           = 60_000;
const DDOS_ALERT_THRESHOLD = Math.ceil(RATE_LIMIT * 0.8);
const NOTICE_MAX_LENGTH   = 300;
const NOTICE_MAX_ITEMS    = 100;
const FAVORITE_LIMIT      = 3;
const TOKEN_TTL_MS        = 5 * 60 * 1000; // 5분
const SESSION_TTL_MS      = 30 * 24 * 60 * 60 * 1000;
const PRIVACY_READ_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const FIREBASE_WEB_API_KEY = (process.env.FIREBASE_WEB_API_KEY || "").trim();
const FIREBASE_AUTH_DOMAIN = (process.env.FIREBASE_AUTH_DOMAIN || "").trim();
const FIREBASE_PROJECT_ID  = (process.env.FIREBASE_PROJECT_ID  || "").trim();
const FIREBASE_APP_ID      = (process.env.FIREBASE_APP_ID      || "").trim();
const FIREBASE_MESSAGING_SENDER_ID = (process.env.FIREBASE_MESSAGING_SENDER_ID || "").trim();
const DATA_ENCRYPTION_KEY = (process.env.DATA_ENCRYPTION_KEY || "").trim();
const TEST_PHONE_AUTH_ENABLED = process.env.ENABLE_TEST_PHONE_AUTH === "true" && process.env.NODE_ENV !== "production";
const PHONE_AUTH_TEST_TOKEN = (process.env.PHONE_AUTH_TEST_TOKEN || "").trim();
const PHONE_AUTH_TEST_UID = (process.env.PHONE_AUTH_TEST_UID || "test-phone-user").trim();
const PHONE_AUTH_TEST_PHONE = (process.env.PHONE_AUTH_TEST_PHONE || "+821012345678").trim();
const ADMIN_VISIBLE_USER_ID = (process.env.ADMIN_VISIBLE_USER_ID || "example_admin").trim();

if (!API_KEY) console.warn("[WARN] API_KEY is not set.");
if (!DATA_ENCRYPTION_KEY) console.warn("[WARN] DATA_ENCRYPTION_KEY is not set; private data cannot be stored.");
if (TEST_PHONE_AUTH_ENABLED) console.warn("[WARN] Test phone auth is enabled. Do not enable it in production.");
if (!ADMIN_ID || !ADMIN_PASSWORD) {
  console.error("[FATAL] Admin_ID 또는 ADMIN_PASSWORD가 설정되지 않았습니다.");
  process.exit(1);
}

// ── Encryption and identity helpers ───────────────────────

function parseEncryptionKey(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const decoders = [
    () => Buffer.from(raw, "base64"),
    () => /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : null,
    () => Buffer.from(raw, "utf8")
  ];

  for (const decode of decoders) {
    const key = decode();
    if (key?.length === 32) return key;
  }
  throw new Error("DATA_ENCRYPTION_KEY must be 32 bytes. Use a base64 value from crypto.randomBytes(32).");
}

const encryptionKey = parseEncryptionKey(DATA_ENCRYPTION_KEY);

function requireEncryptionKey() {
  if (!encryptionKey) throw new Error("DATA_ENCRYPTION_KEY is required to store private data.");
  return encryptionKey;
}

function encryptJson(value) {
  const key = requireEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

function decryptJson(payload) {
  const key = requireEncryptionKey();
  const [version, ivText, tagText, encryptedText] = String(payload || "").split(":");
  if (version !== "v1" || !ivText || !tagText || !encryptedText) {
    throw new Error("Unsupported encrypted payload.");
  }
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedText, "base64url")),
    decipher.final()
  ]);
  return JSON.parse(decrypted.toString("utf8"));
}

function hashLookup(namespace, value) {
  const key = requireEncryptionKey();
  const normalized = String(value || "").trim();
  if (!normalized) return "";
  return createHmac("sha256", key).update(`${namespace}:${normalized}`).digest("hex");
}

function isFirebaseConfigReady() {
  return Boolean(FIREBASE_WEB_API_KEY && FIREBASE_AUTH_DOMAIN && FIREBASE_PROJECT_ID && FIREBASE_APP_ID);
}

function resolveProfileUserId(profile = {}) {
  const explicitUserId = normalizeUserId(profile.userId);
  if (explicitUserId) return explicitUserId;
  if (PHONE_AUTH_TEST_PHONE && String(profile.phoneNumber || "") === PHONE_AUTH_TEST_PHONE) {
    return ADMIN_VISIBLE_USER_ID;
  }
  return "";
}

// ── MongoDB models ────────────────────────────────────────

// 공지사항
const noticeSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  text:      { type: String, required: true },
  date:      { type: String, required: true },
  createdAt: { type: Number, required: true }
});
noticeSchema.index({ createdAt: -1 });
const Notice = mongoose.model("Notice", noticeSchema);

const adminSchema = new mongoose.Schema({
  adminIdHash: { type: String, required: true, unique: true },
  discordIdHash: { type: String, unique: true, sparse: true },
  encryptedAdmin: { type: String, required: true },
  passwordAuth: { type: Object, required: true },
  role: { type: String, default: "admin" },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});
const Admin = mongoose.model("Admin", adminSchema);

// 사용자
const userSchema = new mongoose.Schema({
  discordIdHash:   { type: String, unique: true, sparse: true },
  firebaseUidHash: { type: String, unique: true, sparse: true },
  userIdHash:      { type: String, unique: true, sparse: true },
  phoneHash:       { type: String, index: true, sparse: true },
  emailHash:       { type: String, index: true, sparse: true },
  encryptedProfile: { type: String },
  dataVersion: { type: Number, default: 2 },
  privacyReadAt: { type: Date },
  termsReadAt: { type: Date },
  agreedAt:   { type: Date, default: Date.now },
  createdAt:  { type: Date, default: Date.now }
});
const User = mongoose.model("User", userSchema);

// 임시 토큰
const pendingTokenSchema = new mongoose.Schema({
  token:     { type: String, required: true, unique: true },
  encryptedUserData: { type: String },
  userData:  { type: Object, select: false },
  expiresAt: { type: Date,   required: true }
});
// MongoDB's TTL monitor is periodic, so expired token cleanup can be slightly delayed.
pendingTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
const PendingToken = mongoose.model("PendingToken", pendingTokenSchema);

// ── MongoDB lifecycle ─────────────────────────────────────
let dbConnected = false;
let dbConnecting = false;

async function migrateLegacyUsers() {
  if (!encryptionKey) return;

  const legacyUsers = await User.collection.find({
    encryptedProfile: { $exists: false },
    discordId: { $exists: true, $nin: ["", null] }
  }).toArray();
  if (legacyUsers.length === 0) return;

  for (const legacy of legacyUsers) {
    const profile = {
      schoolCode: legacy.schoolCode,
      officeCode: legacy.officeCode,
      schoolName: legacy.schoolName,
      officeName: legacy.officeName || "",
      type: legacy.type || "",
      grade: legacy.grade,
      classNo: legacy.classNo,
      userId: normalizeUserId(legacy.userId),
      firebaseUid: legacy.firebaseUid || "",
      phoneNumber: legacy.phoneNumber || "",
      email: legacy.email || "",
      displayName: legacy.displayName || "",
      authProvider: legacy.authProvider || (legacy.phoneNumber ? "phone" : ""),
      privacyReadAt: legacy.privacyReadAt || legacy.agreedAt || legacy.createdAt || new Date(),
      agreedAt: legacy.agreedAt || legacy.createdAt || new Date(),
      migratedAt: new Date().toISOString()
    };
    const encryptedUpdate = buildEncryptedUserUpdate(profile, legacy.discordId, legacy.guildId || "");
    await User.collection.updateOne(
      { _id: legacy._id },
      {
        $set: encryptedUpdate,
        $unset: {
          discordId: "",
          guildId: "",
          schoolCode: "",
          officeCode: "",
          schoolName: "",
          officeName: "",
          type: "",
          grade: "",
          classNo: "",
          userId: "",
          firebaseUid: "",
          phoneNumber: "",
          email: "",
          displayName: "",
          authProvider: ""
        }
      }
    );
  }

  console.log(`Migrated ${legacyUsers.length} legacy user document(s) to encrypted storage`);
}

async function ensureDbIndexes() {
  try {
    const userIndexes = await User.collection.indexes();
    if (userIndexes.some(index => index.name === "discordId_1")) {
      await User.collection.dropIndex("discordId_1");
      console.log("Dropped legacy users.discordId index");
    }
    await migrateLegacyUsers();
    await ensureDefaultAdmin();
    await Promise.all([
      Notice.createIndexes(),
      Admin.createIndexes(),
      User.createIndexes(),
      PendingToken.createIndexes()
    ]);
    console.log("MongoDB indexes ready");
  } catch (e) {
    console.warn(`MongoDB index setup warning: ${e.message}`);
  }
}

async function initDb() {
  if (dbConnecting) return;
  dbConnecting = true;
  try {
    while (true) {
      try {
        await mongoose.connect(MONGODB_URI);
        await ensureDbIndexes();
        dbConnected = true;
        console.log("MongoDB connected");
        break;
      } catch (e) {
        dbConnected = false;
        console.error(`MongoDB connection failed: ${e.message}. Retrying in 5 seconds.`);
        await new Promise(r => setTimeout(r, 5000));
      }
    }
  } finally {
    dbConnecting = false;
  }
}

mongoose.connection.on("disconnected", () => {
  dbConnected = false;
  console.warn("⚠️ MongoDB disconnected → trying to reconnect...");
  initDb();
});

mongoose.connection.on("connected", () => {
  dbConnected = true;
});

// ── Notice helpers ────────────────────────────────────────
async function readNotices() {
  if (!dbConnected) return [];
  try {
    const docs = await Notice.find().sort({ createdAt: -1 }).limit(NOTICE_MAX_ITEMS);
    return docs.map(d => ({ id: d.id, text: d.text, date: d.date, createdAt: d.createdAt }));
  } catch (e) {
    console.error("Error reading notices:", e.message);
    return [];
  }
}

// ── Express app and middleware ────────────────────────────
const app = express();
app.disable("x-powered-by");
app.use(cors({
  origin(origin, callback) {
    if (!origin || CORS_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    return callback(null, false);
  }
}));
app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.setHeader("Content-Security-Policy", [
    "default-src 'self'",
    "script-src 'self' https://www.gstatic.com https://www.googleapis.com https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.gstatic.com https://www.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/",
    "frame-src 'self' https://*.firebaseapp.com https://www.google.com/recaptcha/ https://recaptcha.google.com/recaptcha/ https://www.recaptcha.net/recaptcha/",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'"
  ].join("; "));
  next();
});
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));
app.get("/register.js", (req, res) => {
  res.type("application/javascript").sendFile(path.join(__dirname, "public", "Register.js"));
});
app.get("/Register.js", (req, res) => {
  res.type("application/javascript").sendFile(path.join(__dirname, "public", "Register.js"));
});

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

function normalizeUserId(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 24);
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 8 || password.length > 72) return false;
  return /[A-Za-z]/.test(password) && /\d/.test(password);
}

function createPasswordAuth(password) {
  if (!validatePassword(password)) {
    throw httpError(400, "PASSWORD_INVALID", "비밀번호는 영문과 숫자를 포함한 8~72자로 입력해 주세요.");
  }
  const salt = randomBytes(16).toString("base64url");
  const iterations = 210000;
  const digest = "sha256";
  const hash = pbkdf2Sync(password, salt, iterations, 32, digest).toString("base64url");
  return { algorithm: "pbkdf2", digest, iterations, salt, hash };
}

function verifyPasswordAuth(password, passwordAuth = {}) {
  if (!passwordAuth?.salt || !passwordAuth?.hash || !passwordAuth?.iterations) return false;
  const digest = passwordAuth.digest || "sha256";
  const actual = pbkdf2Sync(String(password || ""), passwordAuth.salt, Number(passwordAuth.iterations), 32, digest);
  const expected = Buffer.from(String(passwordAuth.hash), "base64url");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function signSessionPayload(body) {
  const key = requireEncryptionKey();
  return createHmac("sha256", key).update(`session:${body}`).digest("base64url");
}

function createSessionToken(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) throw httpError(400, "USER_ID_REQUIRED", "회원 ID가 필요합니다.");
  const body = Buffer.from(JSON.stringify({
    userId: normalizedUserId,
    exp: Date.now() + SESSION_TTL_MS
  }), "utf8").toString("base64url");
  return `${body}.${signSessionPayload(body)}`;
}

function createAdminSessionToken(adminId) {
  const normalizedAdminId = normalizeUserId(adminId);
  if (!normalizedAdminId) throw httpError(400, "ADMIN_ID_REQUIRED", "관리자 ID가 필요합니다.");
  const body = Buffer.from(JSON.stringify({
    role: "admin",
    adminId: normalizedAdminId,
    exp: Date.now() + SESSION_TTL_MS
  }), "utf8").toString("base64url");
  return `${body}.${signSessionPayload(body)}`;
}

function verifySessionToken(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature || !safeEqualText(signature, signSessionPayload(body))) {
    throw httpError(401, "SESSION_INVALID", "로그인 세션이 유효하지 않습니다.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw httpError(401, "SESSION_INVALID", "로그인 세션이 유효하지 않습니다.");
  }
  const userId = normalizeUserId(payload?.userId);
  if (!userId || Number(payload?.exp) < Date.now()) {
    throw httpError(401, "SESSION_EXPIRED", "로그인 세션이 만료되었습니다.");
  }
  return userId;
}

function verifyAdminSessionToken(token) {
  const [body, signature] = String(token || "").split(".");
  if (!body || !signature || !safeEqualText(signature, signSessionPayload(body))) {
    throw httpError(401, "SESSION_INVALID", "관리자 세션이 유효하지 않습니다.");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw httpError(401, "SESSION_INVALID", "관리자 세션이 유효하지 않습니다.");
  }
  const adminId = normalizeUserId(payload?.adminId);
  if (payload?.role !== "admin" || !adminId || Number(payload?.exp) < Date.now()) {
    throw httpError(401, "SESSION_EXPIRED", "관리자 세션이 만료되었습니다.");
  }
  return adminId;
}

function pickAdminResponse(profile = {}, doc = {}) {
  return {
    adminId: normalizeUserId(profile.adminId),
    displayName: profile.displayName || profile.adminId || "",
    role: profile.role || doc.role || "admin",
    discordLinked: Boolean(profile.discordId || doc.discordIdHash),
    discordLinkedAt: firstDateText(profile.discordLinkedAt, profile.updatedAt, doc.updatedAt),
    createdAt: firstDateText(profile.createdAt, doc.createdAt),
    updatedAt: firstDateText(profile.updatedAt, doc.updatedAt)
  };
}

function buildEncryptedAdmin(adminId, password, existingProfile = {}) {
  const now = new Date();
  const normalizedAdminId = normalizeUserId(adminId);
  const profile = {
    ...existingProfile,
    adminId: normalizedAdminId,
    displayName: existingProfile.displayName || normalizedAdminId,
    role: existingProfile.role || "admin",
    updatedAt: now.toISOString()
  };
  if (!profile.createdAt) profile.createdAt = now.toISOString();
  return {
    adminIdHash: hashLookup("adminId", normalizedAdminId),
    encryptedAdmin: encryptJson(profile),
    passwordAuth: createPasswordAuth(password),
    role: profile.role,
    updatedAt: now
  };
}

function buildAdminProfileUpdate(profile, discordId = "", guildId = "") {
  const now = new Date();
  const normalizedAdminId = normalizeUserId(profile.adminId);
  const normalizedDiscordId = String(discordId || "").trim();
  const nextProfile = {
    ...profile,
    adminId: normalizedAdminId,
    role: profile.role || "admin",
    discordId: normalizedDiscordId,
    guildId: guildId || "",
    updatedAt: now.toISOString()
  };
  return {
    adminIdHash: hashLookup("adminId", normalizedAdminId),
    discordIdHash: normalizedDiscordId ? hashLookup("discordId", normalizedDiscordId) : undefined,
    encryptedAdmin: encryptJson(nextProfile),
    role: nextProfile.role,
    updatedAt: now
  };
}

function buildAdminDiscordUnlinkUpdate(profile = {}) {
  const now = new Date();
  const normalizedAdminId = normalizeUserId(profile.adminId);
  const nextProfile = {
    ...profile,
    adminId: normalizedAdminId,
    discordId: "",
    guildId: "",
    discordLinkedAt: "",
    discordUnlinkedAt: now.toISOString(),
    updatedAt: now.toISOString()
  };
  return {
    adminIdHash: hashLookup("adminId", normalizedAdminId),
    encryptedAdmin: encryptJson(nextProfile),
    role: nextProfile.role || "admin",
    updatedAt: now
  };
}

async function findAdminByCredentials(adminId, password) {
  const normalizedAdminId = normalizeUserId(adminId);
  if (!normalizedAdminId || !password) return null;
  const admin = await Admin.findOne({ adminIdHash: hashLookup("adminId", normalizedAdminId) });
  if (!admin?.encryptedAdmin || !verifyPasswordAuth(password, admin.passwordAuth)) return null;
  const profile = decryptJson(admin.encryptedAdmin);
  return { admin, profile };
}

async function ensureDefaultAdmin() {
  if (!ADMIN_ID || !ADMIN_PASSWORD || !encryptionKey) return;
  const normalizedAdminId = normalizeUserId(ADMIN_ID);
  if (!normalizedAdminId) return;
  const adminIdHash = hashLookup("adminId", normalizedAdminId);
  const existing = await Admin.findOne({ adminIdHash });
  if (existing) return;
  await Admin.create({
    ...buildEncryptedAdmin(normalizedAdminId, ADMIN_PASSWORD),
    createdAt: new Date()
  });
  console.log("Default admin account saved to MongoDB");
}

async function requireAdminAuth(req, res, next) {
  const bearerToken = getBearerToken(req);
  if (bearerToken) {
    try {
      const adminId = verifyAdminSessionToken(bearerToken);
      const admin = await Admin.findOne({ adminIdHash: hashLookup("adminId", adminId) });
      if (admin) {
        req.admin = { id: adminId, doc: admin };
        return next();
      }
    } catch {
      // Fall through to legacy header auth below.
    }
  }

  const id       = String(req.get("x-admin-id")       || "").trim();
  const password = String(req.get("x-admin-password") || "");
  const key      = String(req.get("x-admin-key")      || "").trim();
  const keyValid = ADMIN_AUTH_KEY_REQUIRED ? safeEqualText(key, ADMIN_AUTH_KEY) : true;
  const adminAuth = keyValid ? await findAdminByCredentials(id, password) : null;
  const envValid = keyValid && safeEqualText(id, ADMIN_ID) && safeEqualText(password, ADMIN_PASSWORD);
  if (!adminAuth && !envValid) return res.status(401).json({ error: "UNAUTHORIZED" });
  req.admin = { id: normalizeUserId(id), doc: adminAuth?.admin || null };
  return next();
}

function requireBotAuth(req, res, next) {
  if (!BOT_API_KEY_REQUIRED) return next();

  const key = String(req.get("x-bot-key") || "").trim();
  if (!safeEqualText(key, BOT_API_KEY)) return sendError(res, 401, "UNAUTHORIZED");
  return next();
}

const ERROR_MESSAGES = Object.freeze({
  UNAUTHORIZED: "봇 인증 키가 올바르지 않습니다.",
  TOKEN_NOT_FOUND: "토큰을 찾을 수 없습니다.",
  TOKEN_EXPIRED: "토큰이 만료되었습니다.",
  USER_NOT_FOUND: "서버에 연결된 회원 정보가 없습니다.",
  RATE_LIMIT: "요청이 너무 많습니다. 잠시 후 다시 시도하세요.",
  TOKEN_AND_DISCORDID_REQUIRED: "토큰과 Discord ID가 필요합니다.",
  DISCORDID_REQUIRED: "Discord ID가 필요합니다.",
  ADMIN_NOT_FOUND: "관리자 계정을 찾을 수 없습니다."
});

function errorBody(code, message = "") {
  return { error: code, message: message || ERROR_MESSAGES[code] || code };
}

function sendError(res, status, code, message = "") {
  return res.status(status).json(errorBody(code, message));
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

  if (recent.length > RATE_LIMIT) return sendError(res, 429, "RATE_LIMIT");
  return next();
});

// ── External API and Firebase helpers ─────────────────────

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

async function verifyFirebaseAuth(idToken) {
  if (!idToken || typeof idToken !== "string") throw new Error("FIREBASE_ID_TOKEN_REQUIRED");
  if (TEST_PHONE_AUTH_ENABLED && PHONE_AUTH_TEST_TOKEN && safeEqualText(idToken, PHONE_AUTH_TEST_TOKEN)) {
    return {
      firebaseUid: PHONE_AUTH_TEST_UID,
      authProvider: "test-phone",
      providerIds: ["phone"],
      phoneNumber: PHONE_AUTH_TEST_PHONE
    };
  }
  if (!FIREBASE_WEB_API_KEY) throw new Error("FIREBASE_CONFIG_MISSING");

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(FIREBASE_WEB_API_KEY)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken })
    }
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.error?.message || "FIREBASE_ID_TOKEN_INVALID");
  }

  const user = Array.isArray(payload.users) ? payload.users[0] : null;
  const providers = Array.isArray(user?.providerUserInfo) ? user.providerUserInfo : [];
  const phoneProvider = providers.find(provider => provider.providerId === "phone");
  const googleProvider = providers.find(provider => provider.providerId === "google.com");
  const phoneNumber = user?.phoneNumber || phoneProvider?.phoneNumber || phoneProvider?.rawId || "";
  const email = user?.email || googleProvider?.email || "";
  const displayName = user?.displayName || googleProvider?.displayName || "";
  const providerIds = providers.map(provider => provider.providerId).filter(Boolean);
  if (!user?.localId) throw new Error("FIREBASE_ID_TOKEN_INVALID");
  if (!phoneNumber && !googleProvider) throw new Error("SMS_OR_GOOGLE_AUTH_REQUIRED");

  return {
    firebaseUid: user.localId,
    authProvider: phoneNumber ? "phone" : "google.com",
    providerIds,
    phoneNumber,
    email,
    displayName
  };
}

// ── User profile and registration helpers ─────────────────

function decryptPendingUserData(pending) {
  if (pending?.encryptedUserData) return decryptJson(pending.encryptedUserData);
  if (pending?.userData) return pending.userData;
  throw new Error("PENDING_DATA_MISSING");
}

function firstDateText(...values) {
  for (const value of values) {
    if (!value) continue;
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  }
  return "";
}

function pickUserResponse(profile, documentDates = {}) {
  const agreedAt = firstDateText(profile.agreedAt, documentDates.agreedAt);
  const createdAt = firstDateText(profile.createdAt, documentDates.createdAt);
  const updatedAt = firstDateText(profile.updatedAt, documentDates.updatedAt);

  return {
    userId: resolveProfileUserId(profile),
    schoolCode: profile.schoolCode,
    officeCode: profile.officeCode,
    schoolName: profile.schoolName,
    officeName: profile.officeName || "",
    type:       profile.type || "",
    grade:      profile.grade,
    classNo:    profile.classNo,
    email:      profile.email || "",
    displayName: profile.displayName || "",
    authProvider: profile.authProvider || "",
    providerIds: Array.isArray(profile.providerIds) ? profile.providerIds : [],
    googleLinkedAt: profile.googleLinkedAt || "",
    serviceJoinedAt: firstDateText(agreedAt, createdAt, updatedAt),
    agreedAt,
    createdAt,
    updatedAt,
    favorites:  normalizeFavorites(profile.favorites)
  };
}

function pickBotUserResponse(profile, documentDates = {}) {
  const user = pickUserResponse(profile, documentDates);
  return {
    accountType: "user",
    userId: user.userId,
    schoolCode: user.schoolCode,
    officeCode: user.officeCode,
    schoolName: user.schoolName,
    officeName: user.officeName,
    type: user.type,
    grade: user.grade,
    classNo: user.classNo,
    serviceJoinedAt: user.serviceJoinedAt,
    agreedAt: user.agreedAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt
  };
}

function pickBotAdminResponse(profile = {}, doc = {}) {
  const admin = pickAdminResponse(profile, doc);
  return {
    accountType: "admin",
    adminId: admin.adminId,
    userId: admin.adminId,
    displayName: admin.displayName || admin.adminId,
    role: admin.role,
    serviceJoinedAt: firstDateText(profile.serviceJoinedAt, profile.createdAt, doc.createdAt, profile.updatedAt, doc.updatedAt),
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
    discordLinkedAt: admin.discordLinkedAt,
    discordLinked: admin.discordLinked
  };
}

function normalizeFavorites(list) {
  if (!Array.isArray(list)) return [];
  return list
    .map(item => {
      const school = item?.school || {};
      const schoolCode = String(school.schoolCode || "").trim();
      const officeCode = String(school.officeCode || "").trim();
      const grade = String(item?.grade || "").trim();
      const classNo = String(item?.classNo || "").trim();
      if (!schoolCode || !officeCode || !grade || !classNo) return null;
      return {
        id: String(item.id || `${schoolCode}|${officeCode}|${grade}|${classNo}`),
        school: {
          name: String(school.name || "").trim(),
          schoolCode,
          officeCode,
          officeName: String(school.officeName || "").trim(),
          type: String(school.type || "").trim()
        },
        grade,
        classNo,
        createdAt: Number(item.createdAt || Date.now())
      };
    })
    .filter(Boolean)
    .slice(0, FAVORITE_LIMIT);
}

function buildEncryptedUserUpdate(profile, discordId, guildId) {
  const now = new Date();
  const normalizedDiscordId = String(discordId || "").trim();
  const fullProfile = {
    ...profile,
    discordId: normalizedDiscordId,
    guildId: guildId || "",
    updatedAt: now.toISOString()
  };

  const update = {
    discordIdHash: normalizedDiscordId ? hashLookup("discordId", normalizedDiscordId) : undefined,
    firebaseUidHash: profile.firebaseUid ? hashLookup("firebaseUid", profile.firebaseUid) : undefined,
    userIdHash: profile.userId ? hashLookup("userId", normalizeUserId(profile.userId)) : undefined,
    phoneHash: profile.phoneNumber ? hashLookup("phone", profile.phoneNumber) : undefined,
    emailHash: profile.email ? hashLookup("email", String(profile.email).toLowerCase()) : undefined,
    encryptedProfile: encryptJson(fullProfile),
    dataVersion: 2,
    privacyReadAt: profile.privacyReadAt ? new Date(profile.privacyReadAt) : undefined,
    termsReadAt: profile.termsReadAt ? new Date(profile.termsReadAt) : undefined,
    agreedAt: profile.agreedAt ? new Date(profile.agreedAt) : now
  };
  return Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
}

const LEGACY_USER_UNSET = {
  discordId: "",
  guildId: "",
  schoolCode: "",
  officeCode: "",
  schoolName: "",
  officeName: "",
  type: "",
  grade: "",
  classNo: "",
  userId: "",
  phoneNumber: "",
  email: "",
  displayName: "",
  authProvider: "",
  providerIds: ""
};

function httpError(status, code, message) {
  const error = new Error(message || code);
  error.status = status;
  error.code = code;
  return error;
}

function sameUserDocument(left, right) {
  return Boolean(left && right && String(left._id) === String(right._id));
}

async function assertWebRegistrationIsNew(encryptedUpdate) {
  const existingByUserId = encryptedUpdate.userIdHash
    ? await User.findOne({ userIdHash: encryptedUpdate.userIdHash })
    : null;
  if (existingByUserId) {
    throw httpError(409, "USER_ID_DUPLICATE", "이미 사용 중인 회원 ID입니다.");
  }

  const existingByFirebase = encryptedUpdate.firebaseUidHash
    ? await User.findOne({ firebaseUidHash: encryptedUpdate.firebaseUidHash })
    : null;
  if (existingByFirebase) {
    throw httpError(409, "FIREBASE_USER_DUPLICATE", "이미 가입된 Firebase 계정입니다. 로그인해 주세요.");
  }
}

function requirePasswordAccount(profile) {
  if (!profile?.passwordAuth) {
    throw httpError(400, "PASSWORD_REQUIRED", "웹 회원가입에는 ID/비밀번호 설정이 필요합니다.");
  }
}

async function createPendingToken(userData) {
  const token = String(Math.floor(100000 + randomBytes(3).readUIntBE(0, 3) % 900000));
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await PendingToken.findOneAndDelete({ token });
  await PendingToken.create({
    token,
    encryptedUserData: encryptJson(userData),
    expiresAt
  });
  await PendingToken.deleteMany({ expiresAt: { $lt: new Date() } });

  return { token, expiresAt };
}

async function assertUserIdIsAvailable(userId) {
  const normalizedUserId = normalizeUserId(userId);
  if (!normalizedUserId) return;
  const existingByUserId = await User.findOne({ userIdHash: hashLookup("userId", normalizedUserId) });
  if (existingByUserId) {
    throw httpError(409, "USER_ID_DUPLICATE", "이미 사용 중인 회원 ID입니다.");
  }
}

async function resolveDiscordLinkTarget(encryptedUpdate) {
  const existingDiscordUser = encryptedUpdate.discordIdHash
    ? await User.findOne({ discordIdHash: encryptedUpdate.discordIdHash })
    : null;
  const existingFirebaseUser = encryptedUpdate.firebaseUidHash
    ? await User.findOne({ firebaseUidHash: encryptedUpdate.firebaseUidHash })
    : null;
  const existingUserIdUser = encryptedUpdate.userIdHash
    ? await User.findOne({ userIdHash: encryptedUpdate.userIdHash })
    : null;

  const selectedUser = existingDiscordUser || existingFirebaseUser || null;

  if (existingDiscordUser && existingFirebaseUser && !sameUserDocument(existingDiscordUser, existingFirebaseUser)) {
    throw httpError(409, "ACCOUNT_LINK_CONFLICT", "Discord 계정과 Firebase 계정이 서로 다른 회원정보에 연결되어 있습니다.");
  }
  if (selectedUser && existingUserIdUser && !sameUserDocument(selectedUser, existingUserIdUser)) {
    throw httpError(409, "USER_ID_DUPLICATE", "이미 사용 중인 회원 ID입니다.");
  }
  if (!selectedUser && existingUserIdUser) {
    throw httpError(409, "USER_ID_DUPLICATE", "이미 사용 중인 회원 ID입니다.");
  }

  return selectedUser ? { _id: selectedUser._id } : { discordIdHash: encryptedUpdate.discordIdHash };
}

async function buildRegistrationProfile(body = {}) {
  const {
    schoolCode,
    officeCode,
    schoolName,
    officeName,
    type,
    grade,
    classNo,
    privacyAgreed,
    privacyConfirmed,
    termsAgreed,
    termsConfirmed,
    ageConfirmed,
    userId,
    password,
    privacyReadAt,
    termsReadAt,
    firebaseIdToken
  } = body;

  if (!schoolCode || !officeCode || !schoolName || !grade || !classNo) {
    throw httpError(400, "MISSING_REQUIRED_FIELDS", "필수 항목이 누락되었습니다.");
  }
  if (!privacyAgreed || !privacyConfirmed || !ageConfirmed) {
    throw httpError(400, "PRIVACY_CONSENT_REQUIRED", "개인정보 수집 및 이용 동의가 필요합니다.");
  }
  if (!termsAgreed || !termsConfirmed) {
    throw httpError(400, "TERMS_CONSENT_REQUIRED", "이용약관 동의가 필요합니다.");
  }

  const rawUserId = String(userId || "").trim().toLowerCase();
  const normalizedUserId = normalizeUserId(userId);
  if (rawUserId && (rawUserId !== normalizedUserId || normalizedUserId.length < 3)) {
    throw httpError(400, "USER_ID_INVALID", "회원 ID는 영문 소문자, 숫자, _, - 조합의 3~24자로 입력해 주세요.");
  }

  const privacyReadTime = Number(privacyReadAt);
  const termsReadTime = Number(termsReadAt);
  const now = Date.now();
  if (
    !Number.isFinite(privacyReadTime) ||
    privacyReadTime > now + 60_000 ||
    now - privacyReadTime > PRIVACY_READ_MAX_AGE_MS
  ) {
    throw httpError(400, "PRIVACY_READ_REQUIRED", "개인정보처리방침 전문을 먼저 확인해 주세요.");
  }
  if (
    !Number.isFinite(termsReadTime) ||
    termsReadTime > now + 60_000 ||
    now - termsReadTime > PRIVACY_READ_MAX_AGE_MS
  ) {
    throw httpError(400, "TERMS_READ_REQUIRED", "이용약관 전문을 먼저 확인해 주세요.");
  }

  const passwordAuth = password ? createPasswordAuth(password) : null;
  let firebaseAuth = null;
  if (firebaseIdToken) {
    try {
      firebaseAuth = await verifyFirebaseAuth(firebaseIdToken);
    } catch (e) {
      throw httpError(401, "FIREBASE_AUTH_REQUIRED", e.message);
    }
  }
  if (!firebaseAuth && !passwordAuth) {
    throw httpError(401, "AUTH_REQUIRED", "SMS, Google 또는 ID/비밀번호 인증 정보가 필요합니다.");
  }

  const finalUserId = normalizedUserId || resolveProfileUserId({
    phoneNumber: firebaseAuth?.phoneNumber,
    displayName: firebaseAuth?.displayName
  });
  if (!finalUserId) {
    throw httpError(400, "USER_ID_REQUIRED", "회원 ID를 입력해 주세요.");
  }

  return {
    schoolCode,
    officeCode,
    schoolName,
    officeName: officeName || "",
    type: type || "",
    grade,
    classNo,
    userId: finalUserId,
    passwordAuth,
    firebaseUid: firebaseAuth?.firebaseUid || "",
    authProvider: firebaseAuth?.authProvider || "password",
    providerIds: firebaseAuth?.providerIds || ["password"],
    phoneNumber: firebaseAuth?.phoneNumber || "",
    email: firebaseAuth?.email || "",
    displayName: firebaseAuth?.displayName || "",
    privacyReadAt: new Date(privacyReadTime),
    termsReadAt: new Date(termsReadTime),
    agreedAt: new Date(now)
  };
}

function getBearerToken(req) {
  const header = String(req.get("authorization") || "");
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match ? match[1].trim() : "";
}

async function getSessionUser(req) {
  const userId = verifySessionToken(getBearerToken(req));
  const user = await User.findOne({ userIdHash: hashLookup("userId", userId) });
  if (!user?.encryptedProfile) throw httpError(404, "USER_NOT_FOUND", "회원정보가 없습니다.");
  const profile = decryptJson(user.encryptedProfile);
  const storedUserId = resolveProfileUserId(profile);
  if (storedUserId !== userId) throw httpError(403, "SESSION_USER_MISMATCH", "로그인 세션과 회원정보가 일치하지 않습니다.");
  return { user, profile, userId };
}

// ── NEIS data helpers ─────────────────────────────────────

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

function pickQuery(req, fields) {
  return Object.fromEntries(
    fields.map(field => [field, String(req.query[field] || "").trim()])
  );
}

function buildNeisUrl(dataset, params = {}) {
  const query = new URLSearchParams({
    KEY: API_KEY,
    Type: "json",
    ...params
  });
  return `${BASE_URL}/${dataset}?${query.toString()}`;
}

function getNeisRows(payload, dataset) {
  const rows = payload?.[dataset]?.[1]?.row;
  return Array.isArray(rows) ? rows : [];
}

function mapTimetableRows(rows) {
  return rows.map(item => ({
    date: item.ALL_TI_YMD,
    period: item.PERIO,
    subject: item.ITRT_CNTNT
  }));
}

// ── Static pages and client configuration APIs ────────────

// 회원가입 페이지
app.get(["/register", "/register/auth", "/register/firebase"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Register.html"));
});

app.get(["/login", "/login.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Login.html"));
});

app.get(["/account", "/account.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Account.html"));
});

app.get(["/privacy", "/privacy.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Privacy.html"));
});

app.get(["/terms", "/terms.html"], (req, res) => {
  res.sendFile(path.join(__dirname, "public", "Terms.html"));
});

app.get("/api/firebase-config", (req, res) => {
  if (!isFirebaseConfigReady()) {
    return res.status(503).json({ error: "FIREBASE_CONFIG_MISSING" });
  }
  res.json({
    apiKey: FIREBASE_WEB_API_KEY,
    authDomain: FIREBASE_AUTH_DOMAIN,
    projectId: FIREBASE_PROJECT_ID,
    appId: FIREBASE_APP_ID,
    messagingSenderId: FIREBASE_MESSAGING_SENDER_ID || undefined,
    testPhoneAuthEnabled: TEST_PHONE_AUTH_ENABLED,
    testPhoneNumber: TEST_PHONE_AUTH_ENABLED ? PHONE_AUTH_TEST_PHONE : ""
  });
});

app.get("/api/app-config", (req, res) => {
  res.json({
    adminVisibleUserId: ADMIN_VISIBLE_USER_ID
  });
});

// ── Login and account APIs ────────────────────────────────

app.post("/api/login", async (req, res) => {
  try {
    const { firebaseIdToken } = req.body || {};
    let firebaseAuth;
    try {
      firebaseAuth = await verifyFirebaseAuth(firebaseIdToken);
    } catch (e) {
      return res.status(401).json({ error: "FIREBASE_AUTH_REQUIRED", message: e.message });
    }

    const firebaseUidHash = hashLookup("firebaseUid", firebaseAuth.firebaseUid);
    const user = await User.findOne({ firebaseUidHash });
    if (!user?.encryptedProfile) {
      return res.status(404).json({
        error: "USER_NOT_FOUND",
        message: "회원정보가 없습니다."
      });
    }

    const profile = decryptJson(user.encryptedProfile);
    res.json({
      ok: true,
      user: pickUserResponse(profile),
      authToken: createSessionToken(resolveProfileUserId(profile))
    });
  } catch (e) {
    res.status(500).json({ error: "LOGIN_ERROR", message: e.message });
  }
});

app.post("/api/login/password", async (req, res) => {
  try {
    const { userId, password } = req.body || {};
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId || normalizedUserId !== String(userId || "").trim().toLowerCase()) {
      return res.status(400).json({ error: "USER_ID_INVALID", message: "회원 ID를 확인해 주세요." });
    }
    if (!password) {
      return res.status(400).json({ error: "PASSWORD_REQUIRED", message: "비밀번호를 입력해 주세요." });
    }

    const user = await User.findOne({ userIdHash: hashLookup("userId", normalizedUserId) });
    if (!user?.encryptedProfile) {
      return res.status(404).json({ error: "USER_NOT_FOUND", message: "회원정보가 없습니다." });
    }

    const profile = decryptJson(user.encryptedProfile);
    if (!verifyPasswordAuth(password, profile.passwordAuth)) {
      return res.status(401).json({ error: "PASSWORD_INVALID", message: "회원 ID 또는 비밀번호가 올바르지 않습니다." });
    }

    res.json({ ok: true, user: pickUserResponse(profile), authToken: createSessionToken(resolveProfileUserId(profile)) });
  } catch (e) {
    res.status(500).json({ error: "PASSWORD_LOGIN_ERROR", message: e.message });
  }
});

app.post("/api/account/delete", async (req, res) => {
  try {
    const { firebaseIdToken, confirmUserId, confirmPassword } = req.body || {};
    const requestedUserId = normalizeUserId(confirmUserId);
    if (!requestedUserId) {
      return res.status(400).json({
        error: "USER_ID_CONFIRMATION_REQUIRED",
        message: "회원 ID 확인값이 필요합니다."
      });
    }

    let user = null;
    if (firebaseIdToken) {
      let firebaseAuth;
      try {
        firebaseAuth = await verifyFirebaseAuth(firebaseIdToken);
      } catch (e) {
        return res.status(401).json({ error: "FIREBASE_AUTH_REQUIRED", message: e.message });
      }
      const firebaseUidHash = hashLookup("firebaseUid", firebaseAuth.firebaseUid);
      user = await User.findOne({ firebaseUidHash });
    } else {
      user = await User.findOne({ userIdHash: hashLookup("userId", requestedUserId) });
    }

    if (!user?.encryptedProfile) {
      return res.status(404).json({ error: "USER_NOT_FOUND", message: "삭제할 회원정보가 없습니다." });
    }

    const profile = decryptJson(user.encryptedProfile);
    const storedUserId = resolveProfileUserId(profile);
    if (!requestedUserId || requestedUserId !== storedUserId) {
      return res.status(400).json({
        error: "USER_ID_CONFIRMATION_MISMATCH",
        message: "회원 ID 확인값이 일치하지 않습니다."
      });
    }
    if (!firebaseIdToken) {
      if (!confirmPassword || !verifyPasswordAuth(confirmPassword, profile.passwordAuth)) {
        return res.status(401).json({
          error: "PASSWORD_CONFIRMATION_FAILED",
          message: "비밀번호 확인에 실패했습니다."
        });
      }
    }

    await User.deleteOne({ _id: user._id });

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "ACCOUNT_DELETE_ERROR", message: e.message });
  }
});

app.post("/api/account/token", async (req, res) => {
  try {
    const { firebaseIdToken, confirmUserId, confirmPassword } = req.body || {};
    const requestedUserId = normalizeUserId(confirmUserId);
    if (!requestedUserId) {
      return res.status(400).json({ error: "USER_ID_REQUIRED", message: "회원 ID가 필요합니다." });
    }

    let user = null;
    if (firebaseIdToken) {
      let firebaseAuth;
      try {
        firebaseAuth = await verifyFirebaseAuth(firebaseIdToken);
      } catch {
        return res.status(401).json({ error: "FIREBASE_AUTH_INVALID", message: "Firebase 인증 확인에 실패했습니다." });
      }
      user = await User.findOne({ firebaseUidHash: hashLookup("firebaseUid", firebaseAuth.firebaseUid) });
    }
    if (!user) {
      user = await User.findOne({ userIdHash: hashLookup("userId", requestedUserId) });
    }
    if (!user) return res.status(404).json({ error: "USER_NOT_FOUND", message: "회원정보가 없습니다." });

    const profile = decryptJson(user.encryptedProfile);
    const storedUserId = resolveProfileUserId(profile);
    if (storedUserId !== requestedUserId) {
      return res.status(403).json({ error: "USER_ID_MISMATCH", message: "회원 ID가 일치하지 않습니다." });
    }

    if (!firebaseIdToken) {
      if (!verifyPasswordAuth(confirmPassword, profile.passwordAuth)) {
        return res.status(401).json({ error: "PASSWORD_CONFIRMATION_FAILED", message: "비밀번호 확인에 실패했습니다." });
      }
    }

    const { token, expiresAt } = await createPendingToken({
      ...profile,
      userId: storedUserId,
      tokenReissuedAt: new Date().toISOString()
    });
    res.json({ ok: true, token, expiresAt });
  } catch (e) {
    res.status(500).json({ error: "TOKEN_REISSUE_ERROR", message: e.message });
  }
});

app.get("/api/account/favorites", async (req, res) => {
  try {
    const { profile } = await getSessionUser(req);
    res.json({ ok: true, favorites: normalizeFavorites(profile.favorites) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.code || "FAVORITES_READ_ERROR", message: e.message });
  }
});

app.put("/api/account/favorites", async (req, res) => {
  try {
    const { user, profile } = await getSessionUser(req);
    const favorites = normalizeFavorites(req.body?.favorites);
    const update = buildEncryptedUserUpdate(
      { ...profile, favorites },
      profile.discordId || "",
      profile.guildId || ""
    );
    await User.updateOne({ _id: user._id }, { $set: update, $unset: LEGACY_USER_UNSET });
    res.json({ ok: true, favorites });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.code || "FAVORITES_SAVE_ERROR", message: e.message });
  }
});

app.post("/api/account/link-google", async (req, res) => {
  try {
    const { user, profile } = await getSessionUser(req);
    const { firebaseIdToken } = req.body || {};
    let firebaseAuth;
    try {
      firebaseAuth = await verifyFirebaseAuth(firebaseIdToken);
    } catch (e) {
      return res.status(401).json({ error: "FIREBASE_AUTH_REQUIRED", message: e.message });
    }

    if (!firebaseAuth.firebaseUid) {
      return res.status(400).json({ error: "FIREBASE_UID_MISSING", message: "Google 인증 정보를 확인할 수 없습니다." });
    }

    const existingFirebaseUser = await User.findOne({ firebaseUidHash: hashLookup("firebaseUid", firebaseAuth.firebaseUid) });
    if (existingFirebaseUser && !sameUserDocument(existingFirebaseUser, user)) {
      return res.status(409).json({ error: "FIREBASE_USER_DUPLICATE", message: "이미 다른 회원정보에 연결된 Google 계정입니다." });
    }

    const providerIds = Array.from(new Set([
      ...(Array.isArray(profile.providerIds) ? profile.providerIds : []),
      ...(Array.isArray(firebaseAuth.providerIds) ? firebaseAuth.providerIds : []),
      "google.com"
    ].filter(Boolean)));
    const linkedProfile = {
      ...profile,
      firebaseUid: firebaseAuth.firebaseUid,
      authProvider: profile.passwordAuth ? "password+firebase" : firebaseAuth.authProvider,
      providerIds,
      phoneNumber: profile.phoneNumber || firebaseAuth.phoneNumber || "",
      email: firebaseAuth.email || profile.email || "",
      displayName: firebaseAuth.displayName || profile.displayName || "",
      googleLinkedAt: new Date().toISOString()
    };
    const update = buildEncryptedUserUpdate(
      linkedProfile,
      profile.discordId || "",
      profile.guildId || ""
    );
    await User.updateOne({ _id: user._id }, { $set: update, $unset: LEGACY_USER_UNSET });

    res.json({ ok: true, user: pickUserResponse(linkedProfile), authToken: createSessionToken(resolveProfileUserId(linkedProfile)) });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.code || "GOOGLE_LINK_ERROR", message: e.message });
  }
});

// ── Registration and Discord token APIs ───────────────────

// 회원가입 처리 → 임시 토큰 발급
app.post("/api/register", async (req, res) => {
  try {
    const userData = await buildRegistrationProfile(req.body);
    await assertUserIdIsAvailable(userData.userId);

    const { token, expiresAt } = await createPendingToken(userData);

    res.json({ ok: true, token, expiresAt });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.code || "REGISTER_ERROR", message: e.message });
  }
});

app.post("/api/register/web", async (req, res) => {
  try {
    const userData = await buildRegistrationProfile(req.body);
    const registrationMode = req.body?.registrationMode === "firebase" ? "firebase" : "password";
    if (registrationMode === "firebase") {
      if (!userData.firebaseUid) {
        throw httpError(401, "FIREBASE_AUTH_REQUIRED", "SMS 또는 Google 인증이 필요합니다.");
      }
    } else {
      requirePasswordAccount(userData);
    }
    const encryptedUpdate = buildEncryptedUserUpdate(
      { ...userData, registrationSource: "web" },
      "",
      ""
    );

    await assertWebRegistrationIsNew(encryptedUpdate);

    await User.create(
      {
        ...encryptedUpdate,
        createdAt: new Date()
      }
    );

    res.json({ ok: true, user: pickUserResponse(userData), authToken: createSessionToken(userData.userId) });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ error: "USER_ID_DUPLICATE", message: "이미 사용 중인 회원 ID입니다." });
    }
    res.status(e.status || 500).json({ error: e.code || "WEB_REGISTER_ERROR", message: e.message });
  }
});

// 토큰 검증 + Discord ID 연결 (봇에서 호출)
app.post("/api/verify", requireBotAuth, async (req, res) => {
  try {
    const { token, discordId, guildId } = req.body;
    if (!token || !discordId) return sendError(res, 400, "TOKEN_AND_DISCORDID_REQUIRED");

    const pending = await PendingToken.findOne({ token }).select("+userData");
    if (!pending) return sendError(res, 404, "TOKEN_NOT_FOUND");
    if (pending.expiresAt < new Date()) {
      await PendingToken.deleteOne({ token });
      return sendError(res, 410, "TOKEN_EXPIRED");
    }

    // 사용자 저장 (검색용 해시 + 암호화된 프로필)
    const userData = decryptPendingUserData(pending);
    if (userData.accountType === "admin") {
      const adminId = normalizeUserId(userData.adminId);
      const admin = adminId ? await Admin.findOne({ adminIdHash: hashLookup("adminId", adminId) }) : null;
      if (!admin?.encryptedAdmin) {
        await PendingToken.deleteOne({ token });
        return sendError(res, 404, "ADMIN_NOT_FOUND");
      }
      const profile = decryptJson(admin.encryptedAdmin);
      const discordLinkedAt = new Date().toISOString();
      const update = buildAdminProfileUpdate(
        { ...profile, discordLinkedAt },
        discordId,
        guildId
      );
      await Admin.updateOne({ _id: admin._id }, { $set: update });
      await PendingToken.deleteOne({ token });
      return res.json({
        ok: true,
        user: pickBotAdminResponse(
          { ...profile, discordId, guildId, discordLinkedAt },
          { ...admin.toObject(), ...update }
        )
      });
    }

    const encryptedUpdate = buildEncryptedUserUpdate(userData, discordId, guildId);
    const userFilter = await resolveDiscordLinkTarget(encryptedUpdate);

    const linkedUser = await User.findOneAndUpdate(
      userFilter,
      {
        $set: encryptedUpdate,
        $setOnInsert: { createdAt: new Date() },
        $unset: LEGACY_USER_UNSET
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    await PendingToken.deleteOne({ token });

    res.json({ ok: true, user: pickBotUserResponse(userData, linkedUser) });
  } catch (e) {
    if (e?.code === 11000) {
      return res.status(409).json({ error: "USER_ID_DUPLICATE", message: "이미 사용 중인 회원 ID입니다." });
    }
    res.status(e.status || 500).json({ error: e.code || "VERIFY_ERROR", message: e.message });
  }
});

// Discord bot account APIs
app.post("/api/discord/unlink", requireBotAuth, async (req, res) => {
  try {
    const discordId = String(req.body?.discordId || "").trim();
    if (!discordId) return sendError(res, 400, "DISCORDID_REQUIRED");

    const discordIdHash = hashLookup("discordId", discordId);
    const user = await User.findOne({ discordIdHash });
    if (!user) {
      const admin = await Admin.findOne({ discordIdHash });
      if (!admin?.encryptedAdmin) return sendError(res, 404, "USER_NOT_FOUND");
      const adminProfile = decryptJson(admin.encryptedAdmin);
      const update = buildAdminDiscordUnlinkUpdate(adminProfile);
      await Admin.updateOne(
        { _id: admin._id },
        {
          $set: update,
          $unset: { discordIdHash: "" }
        }
      );
      return res.json({ ok: true });
    }

    const profile = decryptJson(user.encryptedProfile);
    const cleanedProfile = {
      ...profile,
      discordId: "",
      guildId: "",
      discordUnlinkedAt: new Date().toISOString()
    };
    const encryptedUpdate = buildEncryptedUserUpdate(cleanedProfile, "", "");

    await User.updateOne(
      { _id: user._id },
      {
        $set: encryptedUpdate,
        $unset: {
          ...LEGACY_USER_UNSET,
          discordIdHash: ""
        }
      }
    );

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "DISCORD_UNLINK_ERROR", message: e.message });
  }
});

app.get("/api/user/:discordId", requireBotAuth, async (req, res) => {
  try {
    const discordId = String(req.params.discordId || "").trim();
    if (!discordId) return sendError(res, 400, "DISCORDID_REQUIRED");

    const discordIdHash = hashLookup("discordId", discordId);
    const user = await User.findOne({ discordIdHash });
    if (!user) {
      const admin = await Admin.findOne({ discordIdHash });
      if (!admin?.encryptedAdmin) return sendError(res, 404, "USER_NOT_FOUND");
      const adminProfile = decryptJson(admin.encryptedAdmin);
      return res.json(pickBotAdminResponse(adminProfile, admin));
    }

    const profile = decryptJson(user.encryptedProfile);
    res.json(pickBotUserResponse(profile, user));
  } catch (e) {
    res.status(500).json({ error: "USER_FETCH_ERROR", message: e.message });
  }
});

// ── Health, notice, and admin APIs ────────────────────────
app.get("/health", (req, res) => {
  const botKey = String(req.get("x-bot-key") || "").trim();
  const includeDbStatus = BOT_API_KEY_REQUIRED && safeEqualText(botKey, BOT_API_KEY);
  res.json({
    status: "ok",
    time: new Date().toISOString(),
    ...(includeDbStatus ? { db: dbConnected } : {})
  });
});

app.get("/api/notices", async (req, res) => {
  try {
    const notices = await readNotices();
    res.json(notices.map(({ id, date, text }) => ({ id, date, text })));
  } catch (err) {
    res.status(500).json({ error: "NOTICE_READ_ERROR", message: err.message });
  }
});

app.get("/api/admin/me", requireAdminAuth, async (req, res) => {
  try {
    const admin = req.admin?.doc || await Admin.findOne({ adminIdHash: hashLookup("adminId", req.admin?.id || "") });
    if (!admin?.encryptedAdmin) return res.status(404).json({ error: "ADMIN_NOT_FOUND" });
    const profile = decryptJson(admin.encryptedAdmin);
    res.json({ ok: true, admin: pickAdminResponse(profile, admin) });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.code || "ADMIN_ME_ERROR", message: err.message });
  }
});

app.post("/api/admin/login", async (req, res) => {
  try {
    const adminId = normalizeUserId(req.body?.adminId);
    const password = String(req.body?.password || "");
    const key = String(req.body?.key || "").trim();
    const keyValid = ADMIN_AUTH_KEY_REQUIRED ? safeEqualText(key, ADMIN_AUTH_KEY) : true;
    const adminAuth = keyValid ? await findAdminByCredentials(adminId, password) : null;
    if (!adminAuth) return res.status(401).json({ error: "UNAUTHORIZED" });

    res.json({
      ok: true,
      admin: pickAdminResponse(adminAuth.profile, adminAuth.admin),
      adminToken: createAdminSessionToken(adminId)
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.code || "ADMIN_LOGIN_ERROR", message: err.message });
  }
});

app.post("/api/admin/discord-token", requireAdminAuth, async (req, res) => {
  try {
    const admin = req.admin?.doc || await Admin.findOne({ adminIdHash: hashLookup("adminId", req.admin?.id || "") });
    if (!admin?.encryptedAdmin) return res.status(404).json({ error: "ADMIN_NOT_FOUND" });
    const profile = decryptJson(admin.encryptedAdmin);
    const adminId = normalizeUserId(profile.adminId || req.admin?.id);
    if (!adminId) return res.status(400).json({ error: "ADMIN_ID_REQUIRED" });
    const { token, expiresAt } = await createPendingToken({
      accountType: "admin",
      adminId,
      displayName: profile.displayName || adminId,
      role: profile.role || "admin",
      createdAt: profile.createdAt || admin.createdAt,
      tokenReissuedAt: new Date().toISOString()
    });
    res.json({ ok: true, token, expiresAt });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.code || "ADMIN_TOKEN_ERROR", message: err.message });
  }
});

app.get("/admin/monitor", requireAdminAuth, async (req, res) => {
  try {
    const notices = await readNotices();
    const ddos = getDdosSnapshot();
    const adminProfile = req.admin?.doc?.encryptedAdmin ? decryptJson(req.admin.doc.encryptedAdmin) : null;
    res.json({
      admin: adminProfile ? pickAdminResponse(adminProfile, req.admin.doc) : { adminId: req.admin?.id || "", role: "admin" },
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

// ── NEIS timetable and meal APIs ──────────────────────────

app.get("/api/searchSchool", async (req, res) => {
  if (!requireApiKey(res)) return;
  try {
    const name = String(req.query.name || "").trim();
    if (!name) return res.json([]);

    const url = buildNeisUrl("schoolInfo", { SCHUL_NM: name });
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
    const { schoolCode, officeCode, grade, classNo } = pickQuery(req, ["schoolCode", "officeCode", "grade", "classNo"]);
    if (!schoolCode || !officeCode || !grade || !classNo) return res.json([]);

    const date    = toKstDateKey();
    const dataset = await resolveDatasetBySchoolCode(schoolCode);
    const url = buildNeisUrl(dataset, {
      ATPT_OFCDC_SC_CODE: officeCode,
      SD_SCHUL_CODE: schoolCode,
      ALL_TI_YMD: date,
      GRADE: grade,
      CLASS_NM: classNo
    });

    const payload = await fetchJson(url);
    res.json(mapTimetableRows(getNeisRows(payload, dataset)).map(row => ({ ...row, date: row.date || date })));
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

app.get("/api/weeklyTimetable", async (req, res) => {
  if (!requireApiKey(res)) return;
  try {
    const { schoolCode, officeCode, grade, classNo } = pickQuery(req, ["schoolCode", "officeCode", "grade", "classNo"]);
    const startDate  = normalizeYmdInput(req.query.startDate);
    if (!schoolCode || !officeCode || !grade || !classNo || !startDate) return res.json([]);

    const start = new Date(Number(startDate.slice(0, 4)), Number(startDate.slice(4, 6)) - 1, Number(startDate.slice(6, 8)));
    const end = new Date(start);
    end.setDate(end.getDate() + 4);
    const endDate = formatDateToYmd(end);

    const dataset = await resolveDatasetBySchoolCode(schoolCode);
    const url = buildNeisUrl(dataset, {
      ATPT_OFCDC_SC_CODE: officeCode,
      SD_SCHUL_CODE: schoolCode,
      GRADE: grade,
      CLASS_NM: classNo,
      TI_FROM_YMD: startDate,
      TI_TO_YMD: endDate
    });

    const payload = await fetchJson(url);
    res.json(mapTimetableRows(getNeisRows(payload, dataset)));
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

app.get("/api/dailyMeal", async (req, res) => {
  if (!requireApiKey(res)) return;
  try {
    const { schoolCode, officeCode } = pickQuery(req, ["schoolCode", "officeCode"]);
    const date = toKstDateKey();
    if (!schoolCode || !officeCode) return res.json({ date, menu: "" });

    const url = buildNeisUrl("mealServiceDietInfo", {
      ATPT_OFCDC_SC_CODE: officeCode,
      SD_SCHUL_CODE: schoolCode,
      MLSV_YMD: date
    });

    const payload = await fetchJson(url);
    const row = payload?.mealServiceDietInfo?.[1]?.row?.[0];
    res.json({ date, menu: row?.DDISH_NM || "" });
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

app.get("/api/monthlyMeal", async (req, res) => {
  if (!requireApiKey(res)) return;
  try {
    const { schoolCode, officeCode } = pickQuery(req, ["schoolCode", "officeCode"]);
    const startDate  = normalizeYmdInput(req.query.startDate);
    const endDate    = normalizeYmdInput(req.query.endDate);
    if (!schoolCode || !officeCode || !startDate || !endDate) return res.json([]);

    const url = buildNeisUrl("mealServiceDietInfo", {
      ATPT_OFCDC_SC_CODE: officeCode,
      SD_SCHUL_CODE: schoolCode,
      MLSV_FROM_YMD: startDate,
      MLSV_TO_YMD: endDate
    });

    const payload = await fetchJson(url);
    const rows = payload?.mealServiceDietInfo?.[1]?.row;
    if (!Array.isArray(rows)) return res.json([]);

    res.json(rows.map(item => ({ date: item.MLSV_YMD, menu: item.DDISH_NM })));
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

// ── Startup ───────────────────────────────────────────────
function startHttpServer() {
  app.listen(PORT, () => {
    console.log(`Server running on ${PORT}`);
  });
}

function startBackgroundServices() {
  initDb().catch(error => {
    dbConnected = false;
    console.error(`MongoDB background init failed: ${error.message}`);
  });
}

startHttpServer();
startBackgroundServices();
