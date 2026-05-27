// public/admin/account.js

const STORAGE_KEY = "admin.credentials.v1";
const LOGIN_PATH = "/admin/login.html?reason=required";

const adminAccountIdEl = document.getElementById("adminAccountId");
const adminAccountRoleEl = document.getElementById("adminAccountRole");
const adminAccountDiscordEl = document.getElementById("adminAccountDiscord");
const adminAccountCreatedEl = document.getElementById("adminAccountCreated");
const adminAccountMessageEl = document.getElementById("adminAccountMessage");
const issueDiscordTokenBtnEl = document.getElementById("issueDiscordTokenBtn");
const copyDiscordTokenBtnEl = document.getElementById("copyDiscordTokenBtn");
const adminDiscordTokenEl = document.getElementById("adminDiscordToken");
const adminDiscordMessageEl = document.getElementById("adminDiscordMessage");

function setMessage(el, message, type = "") {
  if (!el) return;
  el.textContent = message;
  el.classList.remove("error", "ok");
  if (type) el.classList.add(type);
}

function getSavedCredentials() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.adminToken) return null;
    return {
      id: String(parsed.id || "").trim(),
      adminToken: String(parsed.adminToken || "").trim(),
      displayName: String(parsed.displayName || "").trim(),
      role: String(parsed.role || "admin").trim()
    };
  } catch {
    sessionStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

function saveCredentials(creds) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
    adminToken: creds.adminToken || "",
    id: creds.id || "",
    displayName: creds.displayName || "",
    role: creds.role || "admin",
    discordLinked: Boolean(creds.discordLinked)
  }));
}

function buildAuthHeaders(creds) {
  return { Authorization: `Bearer ${creds.adminToken}` };
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("ko-KR");
}

function requireCredentials() {
  const creds = getSavedCredentials();
  if (!creds) {
    window.location.replace(LOGIN_PATH);
    return null;
  }
  return creds;
}

async function adminFetch(url, options = {}) {
  const creds = requireCredentials();
  if (!creds) throw new Error("NO_CREDENTIALS");
  return fetch(url, {
    ...options,
    headers: {
      ...buildAuthHeaders(creds),
      ...(options.headers || {})
    }
  });
}

function renderAdmin(admin) {
  if (adminAccountIdEl) adminAccountIdEl.textContent = admin.displayName || admin.adminId || "-";
  if (adminAccountRoleEl) adminAccountRoleEl.textContent = admin.role || "admin";
  if (adminAccountDiscordEl) adminAccountDiscordEl.textContent = admin.discordLinked ? "연동됨" : "미연동";
  if (adminAccountCreatedEl) adminAccountCreatedEl.textContent = formatDate(admin.createdAt);

  const saved = getSavedCredentials();
  if (saved) {
    saveCredentials({
      ...saved,
      id: saved.id || admin.adminId || "",
      displayName: admin.displayName || admin.adminId || saved.displayName || "",
      role: admin.role || saved.role || "admin",
      discordLinked: Boolean(admin.discordLinked)
    });
  }
}

async function loadAdminAccount() {
  try {
    const response = await adminFetch("/api/admin/me");
    if (response.status === 401) {
      sessionStorage.removeItem(STORAGE_KEY);
      window.location.replace(LOGIN_PATH);
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "ADMIN_ME_ERROR");
    renderAdmin(data.admin || {});
    setMessage(adminAccountMessageEl, "관리자 정보를 불러왔습니다.", "ok");
  } catch (error) {
    setMessage(adminAccountMessageEl, `관리자 정보 조회 실패: ${error.message}`, "error");
  }
}

async function issueDiscordToken() {
  if (issueDiscordTokenBtnEl) issueDiscordTokenBtnEl.disabled = true;
  setMessage(adminDiscordMessageEl, "Discord 연동 토큰을 발급하는 중입니다.");
  try {
    const response = await adminFetch("/api/admin/discord-token", { method: "POST" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "TOKEN_ERROR");
    if (adminDiscordTokenEl) adminDiscordTokenEl.textContent = data.token || "------";
    if (copyDiscordTokenBtnEl) copyDiscordTokenBtnEl.disabled = !data.token;
    setMessage(adminDiscordMessageEl, "토큰이 발급되었습니다. 5분 안에 Discord 봇에서 입력하세요.", "ok");
  } catch (error) {
    setMessage(adminDiscordMessageEl, `토큰 발급 실패: ${error.message}`, "error");
  } finally {
    if (issueDiscordTokenBtnEl) issueDiscordTokenBtnEl.disabled = false;
  }
}

async function copyDiscordToken() {
  const token = adminDiscordTokenEl?.textContent?.trim();
  if (!token || token === "------") return;
  await navigator.clipboard?.writeText(token);
  setMessage(adminDiscordMessageEl, "토큰을 복사했습니다.", "ok");
}

function init() {
  issueDiscordTokenBtnEl?.addEventListener("click", issueDiscordToken);
  copyDiscordTokenBtnEl?.addEventListener("click", copyDiscordToken);
  loadAdminAccount();
}

init();
