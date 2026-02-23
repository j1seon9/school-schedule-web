// server.js
import express from "express";
import fetch from "node-fetch";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT || 4000;

if (!API_KEY) {
  console.error("API_KEY가 필요합니다.");
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ===== cache =====
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

async function fetchWithRetry(url, retries = 3) {
  let lastErr;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      lastErr = err;
      await new Promise(r => setTimeout(r, 500 * (2 ** i)));
    }
  }
  throw lastErr;
}

async function getCached(url) {
  const now = Date.now();
  const entry = cache.get(url);
  if (entry && entry.expiry > now) return entry.data;
  const data = await fetchWithRetry(url);
  cache.set(url, { data, expiry: now + CACHE_TTL });
  return data;
}

// ===== KST =====
function todayKSTString() {
  const now = new Date();
  const utc = now.getTime() + now.getTimezoneOffset() * 60000;
  return new Date(utc + 9 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, "");
}

// ===== dataset =====
function mapKindToDataset(kind = "") {
  const k = kind.toLowerCase();
  if (k.includes("초")) return "elsTimetable";
  if (k.includes("중")) return "misTimetable";
  if (k.includes("고")) return "hisTimetable";
  return "elsTimetable";
}

async function resolveDatasetBySchoolCode(schoolCode) {
  try {
    const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${API_KEY}&Type=json&SD_SCHUL_CODE=${schoolCode}`;
    const j = await getCached(url);
    const kind = j?.schoolInfo?.[1]?.row?.[0]?.SCHUL_KND_SC_NM || "";
    return mapKindToDataset(kind);
  } catch {
    return "elsTimetable";
  }
}

// 헬스체크 엔드포인트

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    time: new Date().toISOString()
  });
});

app.get("/api/searchSchool", async (req, res) => {
  try {
    const name = (req.query.name || "").trim();
    if (!name) return res.json([]);

    const url = `https://open.neis.go.kr/hub/schoolInfo?KEY=${API_KEY}&Type=json&SCHUL_NM=${encodeURIComponent(name)}`;
    const j = await getCached(url);
    const rows = j?.schoolInfo?.[1]?.row;
    if (!Array.isArray(rows)) return res.json([]);

    res.json(
      rows.map(s => ({
        name: s.SCHUL_NM,
        schoolCode: s.SD_SCHUL_CODE,
        officeCode: s.ATPT_OFCDC_SC_CODE,
        officeName: s.ATPT_OFCDC_SC_NM,
        type: s.SCHUL_KND_SC_NM,
        gender: s.COEDU_SC_NM
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});


// 일간시간표 엔드포인트
app.get("/api/dailyTimetable", async (req, res) => {
  try {
    const { schoolCode, officeCode, grade, classNo } = req.query;
    if (!schoolCode || !officeCode || !grade || !classNo) return res.json([]);

    const date = todayKSTString();
    const dataset = await resolveDatasetBySchoolCode(schoolCode);

    const url = `https://open.neis.go.kr/hub/${dataset}?KEY=${API_KEY}&Type=json`
      + `&ATPT_OFCDC_SC_CODE=${officeCode}`
      + `&SD_SCHUL_CODE=${schoolCode}`
      + `&ALL_TI_YMD=${date}`
      + `&GRADE=${grade}&CLASS_NM=${classNo}`;

    const j = await getCached(url);
    const rows = j?.[dataset]?.[1]?.row;
    if (!Array.isArray(rows)) return res.json([]);

    res.json(
      rows.map(r => ({
        date: r.ALL_TI_YMD,
        period: r.PERIO,
        subject: r.ITRT_CNTNT
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

// 일간급식 엔드포인트
app.get("/api/dailyMeal", async (req, res) => {
  try {
    const { schoolCode, officeCode } = req.query;
    if (!schoolCode || !officeCode) return res.json({ menu: "" });

    const date = todayKSTString();
    const url = `https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=${API_KEY}&Type=json`
      + `&ATPT_OFCDC_SC_CODE=${officeCode}`
      + `&SD_SCHUL_CODE=${schoolCode}`
      + `&MLSV_YMD=${date}`;

    const j = await getCached(url);
    const row = j?.mealServiceDietInfo?.[1]?.row?.[0];
    res.json({ menu: row?.DDISH_NM || "" });
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});


// 주간시간표 엔드포인트
app.get("/api/weeklyTimetable", async (req, res) => {
  try {
    const { schoolCode, officeCode, grade, classNo, startDate } = req.query;
    if (!schoolCode || !officeCode || !grade || !classNo || !startDate) return res.json([]);

    const dataset = await resolveDatasetBySchoolCode(schoolCode);
    const sd = startDate;
    const end = new Date(
      sd.slice(0, 4),
      sd.slice(4, 6) - 1,
      Number(sd.slice(6, 8)) + 4
    ).toISOString().slice(0, 10).replace(/-/g, "");

    const url = `https://open.neis.go.kr/hub/${dataset}?KEY=${API_KEY}&Type=json`
      + `&ATPT_OFCDC_SC_CODE=${officeCode}`
      + `&SD_SCHUL_CODE=${schoolCode}`
      + `&GRADE=${grade}&CLASS_NM=${classNo}`
      + `&TI_FROM_YMD=${sd}&TI_TO_YMD=${end}`;

    const j = await getCached(url);
    const rows = j?.[dataset]?.[1]?.row;
    if (!Array.isArray(rows)) return res.json([]);

    res.json(
      rows.map(r => ({
        date: r.ALL_TI_YMD,
        period: r.PERIO,
        subject: r.ITRT_CNTNT
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});


// 월간급식 엔드포인트

app.get("/api/monthlyMeal", async (req, res) => {
  try {
    const { schoolCode, officeCode, startDate, endDate } = req.query;
    if (!schoolCode || !officeCode || !startDate || !endDate) {
      return res.json([]);
    }

    const url =
      `https://open.neis.go.kr/hub/mealServiceDietInfo?KEY=${API_KEY}&Type=json` +
      `&ATPT_OFCDC_SC_CODE=${officeCode}` +
      `&SD_SCHUL_CODE=${schoolCode}` +
      `&MLSV_FROM_YMD=${startDate}` +
      `&MLSV_TO_YMD=${endDate}`;

    const j = await getCached(url);
    const rows = j?.mealServiceDietInfo?.[1]?.row;
    if (!Array.isArray(rows)) return res.json([]);

    res.json(
      rows.map(r => ({
        date: r.MLSV_YMD,
        menu: r.DDISH_NM
      }))
    );
  } catch (err) {
    res.status(500).json({ error: "NEIS_ERROR", message: err.message });
  }
});

// ===== start server =====
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
