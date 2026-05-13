// public/account.js

const LOGIN_USER_KEY = "schoolBotLoginUser";
const REDIRECTING_TO_LOCALHOST = window.location.hostname === "127.0.0.1";

let firebaseAuth = null;
let firebaseReadyPromise = null;
let deleteModalResolver = null;
let accountTokenValue = "";
let accountTokenTimerInterval = null;

if (REDIRECTING_TO_LOCALHOST) {
  const url = new URL(window.location.href);
  url.hostname = "localhost";
  window.location.replace(url.toString());
}

// ── Local account state and rendering ─────────────────────

function qs(id) {
  return document.getElementById(id);
}

function readLoggedInUser() {
  try {
    const raw = localStorage.getItem(LOGIN_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    localStorage.removeItem(LOGIN_USER_KEY);
    return null;
  }
}

function writeLoggedInUser(user) {
  try {
    localStorage.setItem(LOGIN_USER_KEY, JSON.stringify(user));
  } catch {
    // Account state is restored on the next successful login if storage fails.
  }
}

function getAuthToken() {
  const user = readLoggedInUser();
  return String(user?.authToken || "").trim();
}

function clearStoredUser() {
  localStorage.removeItem(LOGIN_USER_KEY);
  localStorage.removeItem("favoriteSchool");
  localStorage.removeItem("search.state.v1");
}

function setText(id, value) {
  const el = qs(id);
  if (el) el.textContent = value || "-";
}

function setStatus(message, isReady = false, isError = false) {
  const el = qs("accountStatus");
  if (!el) return;
  el.textContent = message || "";
  el.classList.toggle("is-ready", isReady);
  el.classList.toggle("is-error", isError);
}

function setDeleteConfirmMessage(message, type = "") {
  const el = qs("deleteConfirmMsg");
  if (!el) return;
  el.textContent = message || "";
  el.className = `reg-msg ${type}`.trim();
}

function formatDateTime(value) {
  const date = new Date(Number(value || 0));
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("ko-KR");
}

function renderAccount() {
  const user = readLoggedInUser();
  const userId = String(user?.userId || "").trim();
  const hasConfirmedUserId = Boolean(user?.loggedInAt && userId);

  qs("accountEmpty").hidden = hasConfirmedUserId;
  qs("accountDetails").hidden = !hasConfirmedUserId;
  if (!hasConfirmedUserId) return;

  const school = user.school || {};
  setText("accountUserId", userId);
  setText("accountSchoolName", school.name);
  setText("accountSchoolType", school.type);
  setText("accountOfficeName", school.officeName);
  setText("accountGrade", user.grade ? `${user.grade}학년` : "");
  setText("accountClassNo", user.classNo ? `${user.classNo}반` : "");
  setText("accountLoggedInAt", formatDateTime(user.loggedInAt));
}

// ── Firebase session helpers ──────────────────────────────

async function waitForAuthState(auth) {
  return new Promise(resolve => {
    const unsubscribe = auth.onAuthStateChanged(() => {
      unsubscribe();
      resolve();
    });
  });
}

async function initFirebaseAuth() {
  if (REDIRECTING_TO_LOCALHOST) return null;
  if (firebaseReadyPromise) return firebaseReadyPromise;

  firebaseReadyPromise = (async () => {
    const deleteBtn = qs("deleteAccountBtn");
    const linkGoogleBtn = qs("linkGoogleBtn");
    const resetEmailBtn = qs("sendResetEmailBtn");

    if (!window.firebase) {
      if (deleteBtn) deleteBtn.disabled = true;
      if (linkGoogleBtn) linkGoogleBtn.disabled = true;
      if (resetEmailBtn) resetEmailBtn.disabled = true;
      setStatus("Firebase SDK를 불러오지 못했습니다. 네트워크를 확인해 주세요.", false, true);
      return null;
    }

    try {
      const response = await fetch("/api/firebase-config", { cache: "no-store" });
      const config = await response.json();
      if (!response.ok) throw new Error(config.error || "FIREBASE_CONFIG_MISSING");

      const firebaseConfig = {
        apiKey: config.apiKey,
        authDomain: config.authDomain,
        projectId: config.projectId,
        appId: config.appId,
        messagingSenderId: config.messagingSenderId
      };

      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      firebaseAuth = firebase.auth();
      firebaseAuth.languageCode = "ko";
      await waitForAuthState(firebaseAuth);
      if (deleteBtn) deleteBtn.disabled = false;
      if (linkGoogleBtn) linkGoogleBtn.disabled = false;
      if (resetEmailBtn) resetEmailBtn.disabled = false;
      return firebaseAuth;
    } catch (e) {
      if (deleteBtn) deleteBtn.disabled = true;
      if (linkGoogleBtn) linkGoogleBtn.disabled = true;
      if (resetEmailBtn) resetEmailBtn.disabled = true;
      setStatus(`Firebase 인증 설정을 확인해 주세요: ${e.message}`, false, true);
      return null;
    }
  })();

  return firebaseReadyPromise;
}

async function getFirebaseIdToken() {
  const auth = await initFirebaseAuth();
  const user = auth?.currentUser;
  if (!user) {
    throw new Error("현재 Firebase 로그인 세션이 없습니다. 다시 로그인한 뒤 탈퇴를 진행해 주세요.");
  }
  return user.getIdToken(true);
}

async function logout() {
  clearStoredUser();
  try {
    const auth = firebaseAuth || await initFirebaseAuth();
    await auth?.signOut();
  } catch {
    // Local logout should still finish even if Firebase is temporarily unavailable.
  }
  window.location.href = "/";
}

async function linkGoogleAccount() {
  const btn = qs("linkGoogleBtn");
  const authToken = getAuthToken();
  if (!authToken) {
    setStatus("로그인 세션이 없습니다. 다시 로그인해 주세요.", false, true);
    return;
  }

  const auth = await initFirebaseAuth();
  if (!auth) return;

  if (btn) btn.disabled = true;
  setStatus("Google 계정 연동을 진행하는 중입니다...");
  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const result = await auth.signInWithPopup(provider);
    if (!result?.user) throw new Error("Google 사용자 정보를 확인할 수 없습니다.");
    const firebaseIdToken = await result.user.getIdToken(true);

    const response = await fetch("/api/account/link-google", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${authToken}`
      },
      body: JSON.stringify({ firebaseIdToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "Google 계정 연동에 실패했습니다.");

    const current = readLoggedInUser() || {};
    const nextUser = data.user || {};
    writeLoggedInUser({
      ...current,
      userId: nextUser.userId || current.userId || "",
      authToken: data.authToken || current.authToken || "",
      school: {
        name: nextUser.schoolName || current.school?.name || "",
        schoolCode: nextUser.schoolCode || current.school?.schoolCode || "",
        officeCode: nextUser.officeCode || current.school?.officeCode || "",
        officeName: nextUser.officeName || current.school?.officeName || "",
        type: nextUser.type || current.school?.type || ""
      },
      grade: nextUser.grade || current.grade || "",
      classNo: nextUser.classNo || current.classNo || "",
      loggedInAt: current.loggedInAt || Date.now()
    });
    renderAccount();
    if (result.user.email && qs("resetEmailInput")) qs("resetEmailInput").value = result.user.email;
    setStatus("Google 계정 연동이 완료되었습니다. 이제 Google 로그인으로도 같은 계정을 사용할 수 있습니다.", true, false);
  } catch (e) {
    setStatus(e.message, false, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function sendPasswordResetEmail() {
  const btn = qs("sendResetEmailBtn");
  const emailInput = qs("resetEmailInput");
  const email = String(emailInput?.value || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    setStatus("비밀번호 재설정 이메일 주소를 올바르게 입력해 주세요.", false, true);
    emailInput?.focus();
    return;
  }

  const auth = await initFirebaseAuth();
  if (!auth) return;

  if (btn) btn.disabled = true;
  setStatus("비밀번호 재설정 이메일을 발송하는 중입니다...");
  try {
    await auth.sendPasswordResetEmail(email);
    setStatus("비밀번호 재설정 이메일을 발송했습니다. 메일함을 확인해 주세요.", true, false);
  } catch (e) {
    if (e.code === "auth/user-not-found") {
      setStatus("Firebase에 등록된 이메일 계정이 없습니다. Google 연동 계정이거나 로컬 ID/비밀번호 계정이면 재설정 메일을 보낼 수 없습니다.", false, true);
      return;
    }
    setStatus(`비밀번호 재설정 이메일 발송에 실패했습니다: ${e.message}`, false, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function initPasswordToggles() {
  document.querySelectorAll("[data-password-toggle]").forEach(button => {
    const targetId = button.dataset.passwordToggle;
    const input = qs(targetId);
    if (!input) return;

    input.type = "password";
    button.textContent = "표시";
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      const shouldShow = input.type === "password";
      input.type = shouldShow ? "text" : "password";
      button.textContent = shouldShow ? "숨김" : "표시";
      button.setAttribute("aria-pressed", String(shouldShow));
    });
  });
}

// ── Account deletion flow ─────────────────────────────────

function closeDeleteConfirmModal(result = null) {
  const modal = qs("deleteConfirmModal");
  if (modal) modal.setAttribute("aria-hidden", "true");
  if (deleteModalResolver) {
    deleteModalResolver(result);
    deleteModalResolver = null;
  }
}

function openDeleteConfirmModal(userId, needsPassword) {
  const modal = qs("deleteConfirmModal");
  const userIdInput = qs("deleteConfirmUserId");
  const passwordInput = qs("deleteConfirmPassword");
  if (!modal || !userIdInput || !passwordInput) return Promise.resolve(null);

  userIdInput.value = "";
  passwordInput.value = "";
  passwordInput.type = "password";
  passwordInput.closest(".password-field").hidden = !needsPassword;
  document.querySelector('label[for="deleteConfirmPassword"]').hidden = !needsPassword;
  setDeleteConfirmMessage(needsPassword ? "ID/비밀번호 계정은 비밀번호 확인이 필요합니다." : "Firebase 로그인 세션이 확인되면 비밀번호 없이 탈퇴할 수 있습니다.");
  modal.setAttribute("aria-hidden", "false");
  userIdInput.placeholder = userId;
  userIdInput.focus();

  return new Promise(resolve => {
    deleteModalResolver = resolve;
  });
}

async function requestDeleteConfirmation(userId, needsPassword) {
  const resultPromise = openDeleteConfirmModal(userId, needsPassword);
  const result = await resultPromise;
  return result;
}

async function deleteAccount() {
  const deleteBtn = qs("deleteAccountBtn");
  const user = readLoggedInUser();
  const userId = String(user?.userId || "").trim();

  if (!user?.loggedInAt || !userId) {
    setStatus("로그인 정보가 없습니다. 다시 로그인해 주세요.", false, true);
    return;
  }

  let firebaseIdToken = "";
  let confirmPassword = "";
  let needsPassword = false;

  try {
    try {
      firebaseIdToken = await getFirebaseIdToken();
    } catch {
      needsPassword = true;
    }
    const confirmation = await requestDeleteConfirmation(userId, needsPassword);
    if (!confirmation) return;
    if (confirmation.confirmUserId !== userId) {
      setStatus("회원 ID가 일치하지 않아 탈퇴를 취소했습니다.", false, true);
      return;
    }
    confirmPassword = confirmation.confirmPassword;
    if (needsPassword && !confirmPassword) {
      setStatus("비밀번호 확인이 없어 탈퇴를 취소했습니다.", false, true);
      return;
    }

    if (deleteBtn) deleteBtn.disabled = true;
    setStatus("회원탈퇴를 처리하는 중입니다...");

    const response = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firebaseIdToken, confirmUserId: confirmation.confirmUserId, confirmPassword })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "회원탈퇴에 실패했습니다.");

    clearStoredUser();
    try {
      await firebaseAuth?.signOut();
    } catch {
      // The DB account was deleted already; the local session cleanup can continue.
    }

    window.alert("회원탈퇴가 완료되었습니다.");
    window.location.href = "/";
  } catch (e) {
    setStatus(e.message, false, true);
    if (deleteBtn) deleteBtn.disabled = false;
  }
}

// ── Discord token reissue flow ────────────────────────────

function setAccountToken(token) {
  accountTokenValue = token || "";
  const box = qs("accountTokenBox");
  const valueEl = qs("accountTokenValue");
  if (valueEl) valueEl.textContent = accountTokenValue || "------";
  if (box) box.hidden = !accountTokenValue;
}

function startAccountTokenTimer(seconds) {
  if (accountTokenTimerInterval) clearInterval(accountTokenTimerInterval);
  let remaining = seconds;
  const timerEl = qs("accountTokenTimer");
  function update() {
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    if (timerEl) timerEl.textContent = `⏱ ${m}:${s} 후 만료`;
    if (remaining <= 0) {
      clearInterval(accountTokenTimerInterval);
      if (timerEl) timerEl.textContent = "⛔ 토큰이 만료되었습니다. 다시 재발급해 주세요.";
    }
    remaining -= 1;
  }
  update();
  accountTokenTimerInterval = setInterval(update, 1000);
}

async function reissueDiscordToken() {
  const btn = qs("reissueTokenBtn");
  const user = readLoggedInUser();
  const userId = String(user?.userId || "").trim();
  if (!user?.loggedInAt || !userId) {
    setStatus("로그인 정보가 없습니다. 다시 로그인해 주세요.", false, true);
    return;
  }

  let firebaseIdToken = "";
  try {
    firebaseIdToken = await getFirebaseIdToken();
  } catch {
    firebaseIdToken = "";
  }

  const confirmPassword = qs("reissueTokenPassword")?.value || "";
  if (!firebaseIdToken && !confirmPassword) {
    setStatus("Firebase 세션이 없으면 비밀번호를 입력해야 토큰을 재발급할 수 있습니다.", false, true);
    qs("reissueTokenPassword")?.focus();
    return;
  }

  if (btn) btn.disabled = true;
  setStatus("Discord 연동 토큰을 재발급하는 중입니다...");
  try {
    const response = await fetch("/api/account/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firebaseIdToken, confirmUserId: userId, confirmPassword })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error || "토큰 재발급에 실패했습니다.");

    setAccountToken(data.token);
    startAccountTokenTimer(5 * 60);
    setStatus("Discord 연동 토큰이 재발급되었습니다.", true, false);
    const passwordInput = qs("reissueTokenPassword");
    if (passwordInput) passwordInput.value = "";
  } catch (e) {
    setStatus(e.message, false, true);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function copyAccountToken() {
  if (!accountTokenValue) return;
  navigator.clipboard.writeText(accountTokenValue).then(() => {
    const btn = qs("accountTokenCopyBtn");
    if (!btn) return;
    btn.textContent = "✅ 복사됨!";
    setTimeout(() => {
      btn.textContent = "📋 복사하기";
    }, 2000);
  });
}

// ── Page initialization ───────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  renderAccount();
  initPasswordToggles();
  initFirebaseAuth();
  qs("logoutBtn")?.addEventListener("click", logout);
  qs("linkGoogleBtn")?.addEventListener("click", linkGoogleAccount);
  qs("sendResetEmailBtn")?.addEventListener("click", sendPasswordResetEmail);
  qs("deleteAccountBtn")?.addEventListener("click", deleteAccount);
  qs("reissueTokenBtn")?.addEventListener("click", reissueDiscordToken);
  qs("accountTokenCopyBtn")?.addEventListener("click", copyAccountToken);
  qs("deleteCancelBtn")?.addEventListener("click", () => closeDeleteConfirmModal(null));
  qs("deleteConfirmModal")?.addEventListener("click", event => {
    if (event.target === qs("deleteConfirmModal")) closeDeleteConfirmModal(null);
  });
  qs("deleteConfirmBtn")?.addEventListener("click", () => {
    const confirmUserId = String(qs("deleteConfirmUserId")?.value || "").trim();
    const confirmPassword = qs("deleteConfirmPassword")?.value || "";
    if (!confirmUserId) {
      setDeleteConfirmMessage("회원 ID를 입력하세요.", "error");
      return;
    }
    closeDeleteConfirmModal({ confirmUserId, confirmPassword });
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && qs("deleteConfirmModal")?.getAttribute("aria-hidden") === "false") {
      closeDeleteConfirmModal(null);
    }
  });
});
