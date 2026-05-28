// public/admin/account.js

const STORAGE_KEY = "admin.credentials.v1";
const LOGIN_PATH = "/admin/login.html?reason=required";

const adminAccountIdEl = document.getElementById("adminAccountId");
const adminAccountRoleEl = document.getElementById("adminAccountRole");
const adminAccountDiscordEl = document.getElementById("adminAccountDiscord");
const adminAccountCreatedEl = document.getElementById("adminAccountCreated");
const adminAccountMessageEl = document.getElementById("adminAccountMessage");
const adminSchoolInputEl = document.getElementById("adminSchoolInput");
const searchAdminSchoolBtnEl = document.getElementById("searchAdminSchoolBtn");
const adminSchoolResultsEl = document.getElementById("adminSchoolResults");
const adminSelectedSchoolEl = document.getElementById("adminSelectedSchool");
const adminGradeEl = document.getElementById("adminGrade");
const adminClassNoEl = document.getElementById("adminClassNo");
const saveAdminSchoolBtnEl = document.getElementById("saveAdminSchoolBtn");
const adminSchoolMessageEl = document.getElementById("adminSchoolMessage");
const issueDiscordTokenBtnEl = document.getElementById("issueDiscordTokenBtn");
const copyDiscordTokenBtnEl = document.getElementById("copyDiscordTokenBtn");
const adminDiscordTokenEl = document.getElementById("adminDiscordToken");
const adminDiscordMessageEl = document.getElementById("adminDiscordMessage");

let selectedAdminSchool = null;

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
  if (admin.schoolCode && admin.officeCode) {
    selectAdminSchool({
      name: admin.schoolName || "",
      schoolCode: admin.schoolCode,
      officeCode: admin.officeCode,
      officeName: admin.officeName || "",
      type: admin.type || ""
    });
  }
  if (adminGradeEl) adminGradeEl.value = admin.grade || "";
  if (adminClassNoEl) adminClassNoEl.value = admin.classNo || "";

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

function selectAdminSchool(school) {
  selectedAdminSchool = school;
  if (adminSchoolInputEl) adminSchoolInputEl.value = school.name || "";
  if (adminSelectedSchoolEl) {
    const details = [school.type, school.officeName].filter(Boolean).join(" / ");
    adminSelectedSchoolEl.textContent = details ? `${school.name} (${details})` : school.name;
  }
  if (adminSchoolResultsEl) {
    adminSchoolResultsEl.innerHTML = "";
    adminSchoolResultsEl.hidden = true;
  }
}

async function searchAdminSchool() {
  const name = String(adminSchoolInputEl?.value || "").trim();
  if (!name) {
    setMessage(adminSchoolMessageEl, "학교 이름을 입력해 주세요.", "error");
    return;
  }
  if (searchAdminSchoolBtnEl) searchAdminSchoolBtnEl.disabled = true;
  setMessage(adminSchoolMessageEl, "학교를 검색하는 중입니다.");
  try {
    const response = await fetch(`/api/searchSchool?name=${encodeURIComponent(name)}`);
    const schools = await response.json().catch(() => []);
    if (!response.ok) throw new Error(schools.message || schools.error || "SCHOOL_SEARCH_ERROR");
    if (!Array.isArray(schools) || schools.length === 0) {
      if (adminSchoolResultsEl) adminSchoolResultsEl.hidden = true;
      setMessage(adminSchoolMessageEl, "검색 결과가 없습니다.", "error");
      return;
    }
    if (adminSchoolResultsEl) {
      adminSchoolResultsEl.innerHTML = "";
      schools.forEach(school => {
        const li = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = [school.name, school.type, school.officeName].filter(Boolean).join(" / ");
        button.addEventListener("click", () => {
          selectAdminSchool(school);
          setMessage(adminSchoolMessageEl, "학교를 선택했습니다.", "ok");
        });
        li.appendChild(button);
        adminSchoolResultsEl.appendChild(li);
      });
      adminSchoolResultsEl.hidden = false;
    }
    setMessage(adminSchoolMessageEl, "저장할 학교를 선택해 주세요.");
  } catch (error) {
    setMessage(adminSchoolMessageEl, `학교 검색 실패: ${error.message}`, "error");
  } finally {
    if (searchAdminSchoolBtnEl) searchAdminSchoolBtnEl.disabled = false;
  }
}

async function saveAdminSchool() {
  if (!selectedAdminSchool) {
    setMessage(adminSchoolMessageEl, "학교를 먼저 검색하여 선택해 주세요.", "error");
    return;
  }
  const grade = String(adminGradeEl?.value || "").trim();
  const classNo = String(adminClassNoEl?.value || "").trim();
  if (!grade || !classNo) {
    setMessage(adminSchoolMessageEl, "학년과 반을 입력해 주세요.", "error");
    return;
  }
  if (saveAdminSchoolBtnEl) saveAdminSchoolBtnEl.disabled = true;
  setMessage(adminSchoolMessageEl, "학교 정보를 저장하는 중입니다.");
  try {
    const response = await adminFetch("/api/admin/school", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schoolCode: selectedAdminSchool.schoolCode,
        officeCode: selectedAdminSchool.officeCode,
        schoolName: selectedAdminSchool.name,
        officeName: selectedAdminSchool.officeName || "",
        type: selectedAdminSchool.type || "",
        grade,
        classNo
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "ADMIN_SCHOOL_UPDATE_ERROR");
    renderAdmin(data.admin || {});
    setMessage(adminSchoolMessageEl, "학교 정보를 저장했습니다.", "ok");
  } catch (error) {
    setMessage(adminSchoolMessageEl, `학교 정보 저장 실패: ${error.message}`, "error");
  } finally {
    if (saveAdminSchoolBtnEl) saveAdminSchoolBtnEl.disabled = false;
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
  searchAdminSchoolBtnEl?.addEventListener("click", searchAdminSchool);
  adminSchoolInputEl?.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchAdminSchool();
  });
  saveAdminSchoolBtnEl?.addEventListener("click", saveAdminSchool);
  issueDiscordTokenBtnEl?.addEventListener("click", issueDiscordToken);
  copyDiscordTokenBtnEl?.addEventListener("click", copyDiscordToken);
  loadAdminAccount();
}

init();
