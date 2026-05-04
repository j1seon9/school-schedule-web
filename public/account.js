// public/account.js

const LOGIN_USER_KEY = "schoolBotLoginUser";
const REDIRECTING_TO_LOCALHOST = window.location.hostname === "127.0.0.1";

let firebaseAuth = null;
let firebaseReadyPromise = null;

if (REDIRECTING_TO_LOCALHOST) {
  const url = new URL(window.location.href);
  url.hostname = "localhost";
  window.location.replace(url.toString());
}

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

    if (!window.firebase) {
      if (deleteBtn) deleteBtn.disabled = true;
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
      return firebaseAuth;
    } catch (e) {
      if (deleteBtn) deleteBtn.disabled = true;
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

async function deleteAccount() {
  const deleteBtn = qs("deleteAccountBtn");
  const user = readLoggedInUser();
  const userId = String(user?.userId || "").trim();

  if (!user?.loggedInAt || !userId) {
    setStatus("로그인 정보가 없습니다. 다시 로그인해 주세요.", false, true);
    return;
  }

  if (!window.confirm("회원탈퇴 시 DB의 계정정보가 삭제됩니다. 계속할까요?")) return;

  const typedUserId = window.prompt(`탈퇴하려면 회원 ID (${userId})를 입력하세요.`);
  if (typedUserId === null) return;
  if (typedUserId.trim() !== userId) {
    setStatus("회원 ID가 일치하지 않아 탈퇴를 취소했습니다.", false, true);
    return;
  }

  if (deleteBtn) deleteBtn.disabled = true;
  setStatus("회원탈퇴를 처리하는 중입니다...");

  try {
    const firebaseIdToken = await getFirebaseIdToken();
    const response = await fetch("/api/account/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ firebaseIdToken, confirmUserId: userId })
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

document.addEventListener("DOMContentLoaded", () => {
  renderAccount();
  initFirebaseAuth();
  qs("logoutBtn")?.addEventListener("click", logout);
  qs("deleteAccountBtn")?.addEventListener("click", deleteAccount);
});
