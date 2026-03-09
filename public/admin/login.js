const STORAGE_KEY = "admin.credentials.v1";
const STATUS_PATH = "/admin/admin.html";

const adminIdInputEl = document.getElementById("adminIdInput");
const adminPasswordInputEl = document.getElementById("adminPasswordInput");
const adminKeyInputEl = document.getElementById("adminKeyInput");
const loginBtnEl = document.getElementById("loginBtn");
const authMessageEl = document.getElementById("authMessage");

function setMessage(message, type = "") {
  if (!authMessageEl) return;
  authMessageEl.textContent = message;
  authMessageEl.classList.remove("error", "ok");
  if (type) authMessageEl.classList.add(type);
}

function getInputCredentials() {
  return {
    id: String(adminIdInputEl?.value || "").trim(),
    password: String(adminPasswordInputEl?.value || ""),
    key: String(adminKeyInputEl?.value || "").trim()
  };
}

function saveCredentials(creds) {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(creds));
}

function clearCredentials() {
  sessionStorage.removeItem(STORAGE_KEY);
}

function getSavedCredentials() {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.id || !parsed?.password) return null;
    return {
      id: String(parsed.id).trim(),
      password: String(parsed.password),
      key: String(parsed.key || "").trim()
    };
  } catch {
    return null;
  }
}

function fillInputs(creds) {
  if (!creds) return;
  if (adminIdInputEl) adminIdInputEl.value = creds.id || "";
  if (adminPasswordInputEl) adminPasswordInputEl.value = creds.password || "";
  if (adminKeyInputEl) adminKeyInputEl.value = creds.key || "";
}

function buildAuthHeaders(creds) {
  const headers = {
    "x-admin-id": creds.id,
    "x-admin-password": creds.password
  };
  if (creds.key) headers["x-admin-key"] = creds.key;
  return headers;
}

async function verifyCredentials(creds) {
  const response = await fetch("/admin/monitor", {
    headers: buildAuthHeaders(creds)
  });

  if (response.status === 401) return false;
  if (!response.ok) throw new Error("AUTH_REQUEST_FAILED");
  return true;
}

function moveToStatus() {
  window.location.replace(STATUS_PATH);
}

function getReason() {
  return new URLSearchParams(window.location.search).get("reason") || "";
}

function applyReasonMessage(reason) {
  if (reason === "expired") {
    setMessage("세션이 만료되었습니다. 다시 로그인하세요.", "error");
    return;
  }
  if (reason === "required") {
    setMessage("로그인이 필요합니다.", "error");
    return;
  }
  if (reason === "logout") {
    setMessage("로그아웃되었습니다.");
  }
}

async function applyLogin() {
  const creds = getInputCredentials();
  if (!creds.id || !creds.password) {
    setMessage("ID와 비밀번호를 입력하세요.", "error");
    return;
  }

  if (loginBtnEl) loginBtnEl.disabled = true;
  try {
    const valid = await verifyCredentials(creds);
    if (!valid) {
      setMessage("인증 실패. 관리자 정보를 확인하세요.", "error");
      return;
    }

    saveCredentials(creds);
    setMessage("인증 완료", "ok");
    moveToStatus();
  } catch {
    setMessage("서버 연결에 실패했습니다. 잠시 후 다시 시도하세요.", "error");
  } finally {
    if (loginBtnEl) loginBtnEl.disabled = false;
  }
}

function bindEnter(el) {
  el?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    applyLogin();
  });
}

async function init() {
  const reason = getReason();
  applyReasonMessage(reason);

  const saved = getSavedCredentials();
  fillInputs(saved);

  if (!reason && saved) {
    try {
      const valid = await verifyCredentials(saved);
      if (valid) {
        moveToStatus();
        return;
      }
      clearCredentials();
    } catch {
      // keep current page and let user login manually on request error
    }
  }

  loginBtnEl?.addEventListener("click", applyLogin);
  bindEnter(adminIdInputEl);
  bindEnter(adminPasswordInputEl);
  bindEnter(adminKeyInputEl);
}

init();