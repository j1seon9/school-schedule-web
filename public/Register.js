// public/Register.js

let selectedSchool = null;
let tokenValue = "";
let timerInterval = null;
let firebaseAuth = null;
let recaptchaVerifier = null;
let phoneConfirmationResult = null;
let firebaseIdToken = "";
let firebaseAuthMethod = "";
let firebaseClientConfig = null;
let activeLegalModalType = "";
const REGISTER_AUTH_PATHS = new Set(["/register/auth", "/register/firebase"]);
const IS_FIREBASE_REGISTER_PAGE = REGISTER_AUTH_PATHS.has(window.location.pathname.toLowerCase());
const PRIVACY_READ_KEY = "schoolBotPrivacyReadAt";
const TERMS_READ_KEY = "schoolBotTermsReadAt";
const PRIVACY_READ_NONCE_KEY = "schoolBotPrivacyReadNonce";
const TERMS_READ_NONCE_KEY = "schoolBotTermsReadNonce";
const REGISTER_READ_NONCE_KEY = "schoolBotRegisterReadNonce";
const REGISTER_DRAFT_KEY = IS_FIREBASE_REGISTER_PAGE ? "schoolBotRegisterAuthDraft" : "schoolBotRegisterDraft";
const PRIVACY_READ_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const REDIRECTING_TO_LOCALHOST = window.location.hostname === "127.0.0.1";

if (window.location.protocol === "file:") {
  window.location.replace("http://localhost:8000/register");
}

if (REDIRECTING_TO_LOCALHOST) {
  const url = new URL(window.location.href);
  url.hostname = "localhost";
  window.location.replace(url.toString());
}

const registerReadNonce = getRegisterReadNonce();

function isFirebaseRegisterMode() {
  return IS_FIREBASE_REGISTER_PAGE;
}

function isPasswordRegisterMode() {
  return !isFirebaseRegisterMode();
}

// ── Legal document read state ─────────────────────────────

function getRegisterReadNonce() {
  try {
    const urlNonce = new URLSearchParams(window.location.search).get("readNonce");
    if (urlNonce) {
      sessionStorage.setItem(REGISTER_READ_NONCE_KEY, urlNonce);
      return urlNonce;
    }
    const saved = sessionStorage.getItem(REGISTER_READ_NONCE_KEY);
    if (saved) return saved;
    const nonce = createReadNonce();
    sessionStorage.setItem(REGISTER_READ_NONCE_KEY, nonce);
    return nonce;
  } catch {
    return createReadNonce();
  }
}

function createReadNonce() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getPrivacyReadAt() {
  return getStoredReadAt(PRIVACY_READ_KEY);
}

function getTermsReadAt() {
  return getStoredReadAt(TERMS_READ_KEY);
}

function getStoredReadAt(key) {
  try {
    const value = Number(localStorage.getItem(key));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function hasReadPrivacy() {
  return isRecentReadAt(getPrivacyReadAt(), PRIVACY_READ_NONCE_KEY);
}

function hasReadTerms() {
  return isRecentReadAt(getTermsReadAt(), TERMS_READ_NONCE_KEY);
}

function getStoredText(key) {
  try {
    return localStorage.getItem(key) || "";
  } catch {
    return "";
  }
}

function isRecentReadAt(readAt, nonceKey) {
  const now = Date.now();
  return (
    readAt > 0 &&
    getStoredText(nonceKey) === registerReadNonce &&
    readAt <= now + 60_000 &&
    now - readAt <= PRIVACY_READ_MAX_AGE_MS
  );
}

function updateLegalLinks() {
  document.querySelectorAll('a[href^="/privacy"], a[href^="/terms"]').forEach(link => {
    const path = link.getAttribute("href");
    const pathname = new URL(path, window.location.origin).pathname;
    const modalType = pathname === "/terms" ? "terms" : "privacy";
    link.href = pathname;
    link.dataset.legalModal = modalType;
    link.removeAttribute("target");
    if (!link.dataset.registerDraftBound) {
      link.addEventListener("click", event => {
        event.preventDefault();
        saveRegisterDraft();
        openLegalModal(modalType);
      });
      link.dataset.registerDraftBound = "true";
    }
  });
}

// ── Legal modal ───────────────────────────────────────────

function markLegalRead(type) {
  const now = Date.now();
  try {
    if (type === "terms") {
      localStorage.setItem(TERMS_READ_KEY, String(now));
      localStorage.setItem(TERMS_READ_NONCE_KEY, registerReadNonce);
    } else {
      localStorage.setItem(PRIVACY_READ_KEY, String(now));
      localStorage.setItem(PRIVACY_READ_NONCE_KEY, registerReadNonce);
    }
  } catch {
    // Reading the modal still works even if local storage is unavailable.
  }
  updatePrivacyGate();
}

function hasReachedScrollEnd(el) {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - 8;
}

function updateLegalModalStatus(isReady = false) {
  const statusEl = document.getElementById("legalModalStatus");
  if (!statusEl) return;
  statusEl.textContent = isReady
    ? "전문 확인이 완료되었습니다. 동의 체크박스를 사용할 수 있습니다."
    : "전문을 끝까지 스크롤하면 확인이 완료됩니다.";
  statusEl.classList.toggle("is-ready", isReady);
}

function extractLegalContent(htmlText) {
  const doc = new DOMParser().parseFromString(htmlText, "text/html");
  const wrap = doc.querySelector(".legal-wrap");
  if (!wrap) return "<p>전문을 불러오지 못했습니다.</p>";
  wrap.querySelector(".legal-back")?.remove();
  return wrap.innerHTML;
}

async function openLegalModal(type) {
  activeLegalModalType = type === "terms" ? "terms" : "privacy";
  const modal = document.getElementById("legalModal");
  const titleEl = document.getElementById("legalModalTitle");
  const bodyEl = document.getElementById("legalModalBody");
  if (!modal || !titleEl || !bodyEl) return;

  titleEl.textContent = activeLegalModalType === "terms" ? "이용약관" : "개인정보처리방침";
  bodyEl.innerHTML = "<p>전문을 불러오는 중입니다...</p>";
  bodyEl.dataset.legalLoaded = "false";
  updateLegalModalStatus(false);
  modal.setAttribute("aria-hidden", "false");
  let loaded = false;

  try {
    const response = await fetch(activeLegalModalType === "terms" ? "/terms" : "/privacy", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bodyEl.innerHTML = extractLegalContent(await response.text());
    loaded = true;
    bodyEl.dataset.legalLoaded = "true";
  } catch {
    bodyEl.innerHTML = "<p>전문을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</p>";
  }

  bodyEl.scrollTop = 0;
  bodyEl.focus();
  requestAnimationFrame(() => {
    if (loaded && hasReachedScrollEnd(bodyEl)) {
      markLegalRead(activeLegalModalType);
      updateLegalModalStatus(true);
    }
  });
}

function closeLegalModal() {
  const modal = document.getElementById("legalModal");
  if (modal) modal.setAttribute("aria-hidden", "true");
  activeLegalModalType = "";
}

function initLegalModal() {
  const modal = document.getElementById("legalModal");
  const bodyEl = document.getElementById("legalModalBody");
  document.getElementById("legalModalClose")?.addEventListener("click", closeLegalModal);
  modal?.addEventListener("click", event => {
    if (event.target === modal) closeLegalModal();
  });
  bodyEl?.addEventListener("scroll", () => {
    if (!activeLegalModalType || bodyEl.dataset.legalLoaded !== "true" || !hasReachedScrollEnd(bodyEl)) return;
    markLegalRead(activeLegalModalType);
    updateLegalModalStatus(true);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && modal?.getAttribute("aria-hidden") === "false") closeLegalModal();
  });
}

// ── Register draft restore ────────────────────────────────

function clearResumeQuery() {
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("resume")) return;
    url.searchParams.delete("resume");
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState(null, "", next || window.location.pathname || "/register");
  } catch {
    // Query cleanup is cosmetic; draft restore should continue even if it fails.
  }
}

function readRegisterDraft() {
  try {
    const raw = sessionStorage.getItem(REGISTER_DRAFT_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeRegisterDraft(patch = {}) {
  try {
    const draft = {
      ...readRegisterDraft(),
      ...patch,
      updatedAt: Date.now()
    };
    sessionStorage.setItem(REGISTER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Draft restore is optional; registration can still continue without storage.
  }
}

function clearRegisterDraft() {
  try {
    sessionStorage.removeItem(REGISTER_DRAFT_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function getCurrentStepId() {
  const active = document.querySelector(".reg-step.active");
  return active?.id || "step1";
}

function saveRegisterDraft() {
  writeRegisterDraft({
    currentStep: getCurrentStepId(),
    selectedSchool,
    schoolInput: document.getElementById("schoolInput")?.value || "",
    grade: document.getElementById("grade")?.value || "",
    classNo: document.getElementById("classNo")?.value || "",
    userId: document.getElementById("userId")?.value || "",
    phoneNumber: document.getElementById("phoneNumber")?.value || "",
    agreeChecked: Boolean(document.getElementById("agreeCheck")?.checked),
    termsAgreeChecked: Boolean(document.getElementById("termsAgreeCheck")?.checked),
    ageChecked: Boolean(document.getElementById("ageCheck")?.checked)
  });
}

function restoreRegisterDraft() {
  const draft = readRegisterDraft();
  if (!draft || Object.keys(draft).length === 0) return;

  const setValue = (id, value) => {
    const el = document.getElementById(id);
    if (el && value !== undefined && value !== null) el.value = value;
  };
  const setChecked = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(value);
  };

  selectedSchool = draft.selectedSchool || null;
  setValue("schoolInput", draft.schoolInput);
  setValue("grade", draft.grade);
  setValue("classNo", draft.classNo);
  setValue("userId", draft.userId);
  setValue("phoneNumber", draft.phoneNumber);
  setChecked("agreeCheck", draft.agreeChecked);
  setChecked("termsAgreeCheck", draft.termsAgreeChecked);
  setChecked("ageCheck", draft.ageChecked);

  if (selectedSchool) {
    const selectedEl = document.getElementById("selectedSchool");
    const officeText = selectedSchool.officeName ? `, ${selectedSchool.officeName}` : "";
    selectedEl.textContent = `${selectedSchool.name} (${selectedSchool.type || ""}${officeText})`;
    selectedEl.style.display = "block";
  }

  if (draft.currentStep === "step2" && selectedSchool) {
    showStep("step2", false);
  }
}

// ── Step gates and auth state ─────────────────────────────

function updatePrivacyGate() {
  const isPrivacyRead = hasReadPrivacy();
  const isTermsRead = hasReadTerms();
  const statusEl = document.getElementById("privacyStatus");
  const termsStatusEl = document.getElementById("termsStatus");
  const agreeCheck = document.getElementById("agreeCheck");
  const termsAgreeCheck = document.getElementById("termsAgreeCheck");

  if (agreeCheck) agreeCheck.disabled = !isPrivacyRead;
  if (!isPrivacyRead) {
    if (agreeCheck) agreeCheck.checked = false;
  }

  if (termsAgreeCheck) termsAgreeCheck.disabled = !isTermsRead;
  if (!isTermsRead) {
    if (termsAgreeCheck) termsAgreeCheck.checked = false;
  }

  if (statusEl) {
    statusEl.textContent = isPrivacyRead
      ? "개인정보처리방침 전문 확인이 완료되었습니다."
      : "현재 회원가입 과정에서 개인정보처리방침 전문을 끝까지 읽은 뒤 동의할 수 있습니다.";
    statusEl.classList.toggle("is-ready", isPrivacyRead);
  }
  if (termsStatusEl) {
    termsStatusEl.textContent = isTermsRead
      ? "이용약관 전문 확인이 완료되었습니다."
      : "현재 회원가입 과정에서 이용약관 전문을 끝까지 읽은 뒤 동의할 수 있습니다.";
    termsStatusEl.classList.toggle("is-ready", isTermsRead);
  }
  updateSubmitGate();
  saveRegisterDraft();
}

function updateSubmitGate() {
  const authReady = isFirebaseRegisterMode() ? Boolean(firebaseIdToken) : isPasswordAuthReady();
  const canSubmit =
    isRegistrationBasicsReady() &&
    hasReadPrivacy() &&
    hasReadTerms() &&
    authReady;
  const submitBtn = document.getElementById("submitBtn");
  const tokenSubmitBtn = document.getElementById("tokenSubmitBtn");
  if (submitBtn) submitBtn.disabled = !canSubmit;
  if (tokenSubmitBtn) tokenSubmitBtn.disabled = !canSubmit;
}

function setPhoneStatus(text, isReady = false) {
  const el = document.getElementById("phoneStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-ready", isReady);
}

function getPhoneAuthErrorMessage(error) {
  if (error?.code === "auth/billing-not-enabled") {
    return "Firebase 결제 설정이 꺼져 있어 실제 SMS를 보낼 수 없습니다. Firebase Console에서 Blaze 결제를 활성화하거나 Authentication > Phone numbers for testing에 등록한 테스트 번호/인증번호를 사용해 주세요. Google 인증은 계속 사용할 수 있습니다.";
  }
  return `인증 문자 발송에 실패했습니다: ${error?.message || "알 수 없는 오류"}`;
}

function setFirebaseAuthToken(idToken, method, statusText) {
  firebaseIdToken = idToken || "";
  firebaseAuthMethod = method || "";
  if (statusText) setPhoneStatus(statusText, Boolean(idToken));
  updateSubmitGate();
  saveRegisterDraft();
}

function clearFirebaseAuthToken(statusText) {
  firebaseIdToken = "";
  firebaseAuthMethod = "";
  if (statusText) setPhoneStatus(statusText);
  updateSubmitGate();
  saveRegisterDraft();
}

function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("010")) return `+82${digits.slice(1)}`;
  if (digits.startsWith("8210")) return `+${digits}`;
  return raw;
}

// ── Firebase SMS and Google auth ──────────────────────────

async function initFirebaseAuth() {
  if (REDIRECTING_TO_LOCALHOST) return;

  const sendBtn = document.getElementById("sendPhoneBtn");
  const googleBtn = document.getElementById("googleAuthBtn");
  if (!window.firebase) {
    if (sendBtn) sendBtn.disabled = true;
    if (googleBtn) googleBtn.disabled = true;
    setPhoneStatus("Firebase SDK를 불러오지 못했습니다. 네트워크를 확인해 주세요.");
    updateSubmitGate();
    return;
  }

  try {
    const response = await fetch("/api/firebase-config", { cache: "no-store" });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "FIREBASE_CONFIG_MISSING");
    firebaseClientConfig = config;

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
    if (googleBtn) googleBtn.disabled = false;

    try {
      const redirectResult = await firebaseAuth.getRedirectResult();
      if (redirectResult?.user) {
        const idToken = await redirectResult.user.getIdToken(true);
        const email = redirectResult.user.email ? ` (${redirectResult.user.email})` : "";
        setFirebaseAuthToken(idToken, "google", `Google 인증이 완료되었습니다${email}.`);
      }
    } catch (e) {
      setPhoneStatus(`Google 인증 결과를 확인하지 못했습니다: ${e.message}`);
    }

    if (!firebaseIdToken) {
      try {
        await new Promise(resolve => {
          const unsubscribe = firebaseAuth.onAuthStateChanged(async user => {
            unsubscribe();
            if (user && !firebaseIdToken) {
              const idToken = await user.getIdToken(true);
              const providerIds = (user.providerData || []).map(provider => provider.providerId);
              const method = providerIds.includes("google.com") ? "google" : "sms";
              setFirebaseAuthToken(idToken, method, "Firebase 인증 세션이 복원되었습니다.");
            }
            resolve();
          }, () => resolve());
        });
      } catch {
        // A missing restored session should not block fresh SMS/Google authentication.
      }
    }

    try {
      recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptchaContainer", {
        size: "normal"
      });
      await recaptchaVerifier.render();
      if (sendBtn) sendBtn.disabled = false;
      if (!firebaseIdToken) setPhoneStatus("SMS 또는 Google 인증 중 하나를 완료해 주세요.");
    } catch (e) {
      if (sendBtn) sendBtn.disabled = true;
      if (!firebaseIdToken) setPhoneStatus(`SMS 인증 설정을 확인해 주세요: ${e.message} Google 인증은 사용할 수 있습니다.`);
    }
  } catch (e) {
    if (sendBtn) sendBtn.disabled = true;
    if (googleBtn) googleBtn.disabled = true;
    setPhoneStatus(`Firebase 설정이 필요합니다: ${e.message}`);
  } finally {
    updateSubmitGate();
  }
}

async function resetRecaptcha() {
  if (!recaptchaVerifier) return;
  const widgetId = await recaptchaVerifier.render();
  if (window.grecaptcha) window.grecaptcha.reset(widgetId);
}

async function signInWithGoogle() {
  if (!firebaseAuth) return setPhoneStatus("Firebase 인증 설정을 먼저 확인해 주세요.");

  const googleBtn = document.getElementById("googleAuthBtn");
  googleBtn.disabled = true;
  clearFirebaseAuthToken("Google 인증 창을 여는 중입니다...");

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    const result = await firebaseAuth.signInWithPopup(provider);
    if (!result?.user) throw new Error("GOOGLE_USER_MISSING");
    const idToken = await result.user.getIdToken(true);
    const email = result.user.email ? ` (${result.user.email})` : "";
    setFirebaseAuthToken(idToken, "google", `Google 인증이 완료되었습니다${email}.`);
  } catch (e) {
    if (e.code === "auth/unauthorized-domain") {
      setPhoneStatus("Google 인증 허용 도메인 문제가 있습니다. 로컬은 http://localhost:8000/register 로 접속하거나 Firebase Authorized domains에 현재 도메인을 추가해 주세요.");
      return;
    }
    if (["auth/popup-blocked", "auth/operation-not-supported-in-this-environment"].includes(e.code)) {
      try {
        setPhoneStatus("팝업을 열 수 없어 Google 인증 페이지로 이동합니다...");
        const provider = new firebase.auth.GoogleAuthProvider();
        provider.setCustomParameters({ prompt: "select_account" });
        await firebaseAuth.signInWithRedirect(provider);
        return;
      } catch (redirectError) {
        setPhoneStatus(`Google 인증에 실패했습니다: ${redirectError.message}`);
        return;
      }
    }
    setPhoneStatus(`Google 인증에 실패했습니다: ${e.message}`);
  } finally {
    googleBtn.disabled = false;
  }
}

async function sendPhoneCode() {
  if (!firebaseAuth || !recaptchaVerifier) {
    return setPhoneStatus("Firebase 인증 설정을 먼저 확인해 주세요.");
  }

  const phoneInput = document.getElementById("phoneNumber");
  const phoneNumber = normalizePhoneNumber(phoneInput.value);
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    return setPhoneStatus("휴대폰 번호를 010-1234-5678 또는 +821012345678 형식으로 입력해 주세요.");
  }
  phoneInput.value = phoneNumber;

  const sendBtn = document.getElementById("sendPhoneBtn");
  const confirmBtn = document.getElementById("confirmPhoneBtn");
  sendBtn.disabled = true;
  clearFirebaseAuthToken();
  setPhoneStatus("인증 문자를 보내는 중입니다...");

  try {
    phoneConfirmationResult = await firebaseAuth.signInWithPhoneNumber(phoneNumber, recaptchaVerifier);
    if (confirmBtn) confirmBtn.disabled = false;
    if (firebaseClientConfig?.testPhoneAuthEnabled && phoneNumber === firebaseClientConfig.testPhoneNumber) {
      setPhoneStatus("테스트 번호입니다. 실제 SMS는 오지 않습니다. Firebase Console에 등록한 6자리 테스트 인증번호를 입력해 주세요.");
    } else {
      setPhoneStatus("인증 문자를 보냈습니다. 받은 6자리 코드를 입력해 주세요.");
    }
  } catch (e) {
    await resetRecaptcha();
    setPhoneStatus(`인증 문자 발송에 실패했습니다: ${e.message}`);
  } finally {
    sendBtn.disabled = false;
  }
}

async function confirmPhoneCode() {
  if (!phoneConfirmationResult) return setPhoneStatus("먼저 인증 문자를 받아 주세요.");

  const code = document.getElementById("phoneCode").value.trim();
  if (!/^\d{6}$/.test(code)) return setPhoneStatus("6자리 인증번호를 입력해 주세요.");

  const confirmBtn = document.getElementById("confirmPhoneBtn");
  confirmBtn.disabled = true;
  setPhoneStatus("인증번호를 확인하는 중입니다...");

  try {
    const result = await phoneConfirmationResult.confirm(code);
    const idToken = await result.user.getIdToken(true);
    setFirebaseAuthToken(idToken, "sms", "휴대폰 번호 인증이 완료되었습니다.");
  } catch (e) {
    confirmBtn.disabled = false;
    setPhoneStatus(`인증번호 확인에 실패했습니다: ${e.message}`);
  } finally {
    updateSubmitGate();
  }
}

// ── School search and account credentials ─────────────────

async function searchSchool() {
  const name = document.getElementById("schoolInput").value.trim();
  if (!name) return showMsg("step1Msg", "학교 이름을 입력하세요.", "error");

  const btn = document.getElementById("searchBtn");
  btn.disabled = true;
  btn.textContent = "검색 중...";

  try {
    const res = await fetch(`/api/searchSchool?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    const listEl = document.getElementById("schoolList");
    listEl.innerHTML = "";

    if (!Array.isArray(data) || data.length === 0) {
      showMsg("step1Msg", "검색 결과가 없습니다.", "error");
      listEl.style.display = "none";
      return;
    }

    clearMsg("step1Msg");
    data.forEach(school => {
      const li = document.createElement("li");
      const officeText = school.officeName ? `, ${school.officeName}` : "";
      li.textContent = `${school.name} (${school.type}${officeText})`;
      li.addEventListener("click", () => selectSchool(school, li));
      listEl.appendChild(li);
    });
    listEl.style.display = "block";
  } catch {
    showMsg("step1Msg", "검색 중 오류가 발생했습니다.", "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "검색";
  }
}

function selectSchool(school, liEl) {
  selectedSchool = school;
  document.querySelectorAll(".reg-school-list li").forEach(el => el.classList.remove("selected"));
  if (liEl) liEl.classList.add("selected");
  const selectedEl = document.getElementById("selectedSchool");
  const officeText = school.officeName ? `, ${school.officeName}` : "";
  selectedEl.textContent = `✅ ${school.name} (${school.type}${officeText})`;
  selectedEl.style.display = "block";
  clearMsg("step1Msg");
  saveRegisterDraft();
}

function goStep2() {
  if (!validateRegistrationBasics("step1Msg")) return;
  clearMsg("step1Msg");
  updatePrivacyGate();
  showStep("step2");
}

function normalizeUserIdInput(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidUserId(value) {
  return /^[a-z0-9_-]{3,24}$/.test(String(value || ""));
}

function isValidPassword(value) {
  const password = String(value || "");
  return password.length >= 8 && password.length <= 72 && /[A-Za-z]/.test(password) && /\d/.test(password);
}

function isPasswordAuthReady() {
  const password = document.getElementById("password")?.value || "";
  const passwordConfirm = document.getElementById("passwordConfirm")?.value || "";
  return isValidPassword(password) && password === passwordConfirm;
}

function focusRegisterField(id) {
  const field = document.getElementById(id);
  if (!field) return;
  field.focus();
  if (typeof field.select === "function") field.select();
}

function isRegistrationBasicsReady() {
  const grade = document.getElementById("grade")?.value.trim() || "";
  const classNo = document.getElementById("classNo")?.value.trim() || "";
  const userId = normalizeUserIdInput(document.getElementById("userId")?.value || "");
  return Boolean(selectedSchool?.schoolCode && selectedSchool?.officeCode) &&
    Boolean(grade) &&
    Boolean(classNo) &&
    isValidUserId(userId) &&
    isPasswordAuthReady();
}

function validateRegistrationBasics(messageId, options = {}) {
  const { returnToStep1 = false } = options;
  const targetMessageId = returnToStep1 ? "step1Msg" : messageId;
  const showAndFocus = (message, fieldId) => {
    if (returnToStep1) showStep("step1", false);
    showMsg(targetMessageId, message, "error");
    if (fieldId) focusRegisterField(fieldId);
    return false;
  };

  if (!selectedSchool?.schoolCode || !selectedSchool?.officeCode) {
    if (returnToStep1) showStep("step1", false);
    showMsg(targetMessageId, "학교를 먼저 검색하고 선택해 주세요.", "error");
    focusRegisterField("schoolInput");
    return false;
  }

  const grade = document.getElementById("grade")?.value.trim() || "";
  const classNo = document.getElementById("classNo")?.value.trim() || "";
  const userId = normalizeUserIdInput(document.getElementById("userId")?.value || "");
  const password = document.getElementById("password")?.value || "";
  const passwordConfirm = document.getElementById("passwordConfirm")?.value || "";

  if (!grade) return showAndFocus("학년을 입력해 주세요.", "grade");
  if (!classNo) return showAndFocus("반을 입력해 주세요.", "classNo");
  if (!isValidUserId(userId)) {
    return showAndFocus("회원 ID는 영문 소문자, 숫자, _, - 조합의 3~24자로 입력해 주세요.", "userId");
  }
  if (!isValidPassword(password)) {
    return showAndFocus("비밀번호는 영문과 숫자를 포함해 8~72자로 입력해 주세요.", "password");
  }
  if (password !== passwordConfirm) {
    return showAndFocus("비밀번호 확인이 일치하지 않습니다.", "passwordConfirm");
  }

  document.getElementById("userId").value = userId;
  return true;
}

function goStep1() { showStep("step1"); }

// ── Registration submit and token display ─────────────────

function showStep(id, shouldSave = true) {
  document.querySelectorAll(".reg-step").forEach(el => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
  if (shouldSave) saveRegisterDraft();
}

function setStep3Mode(mode) {
  const title = document.getElementById("step3Title");
  const webSuccessBox = document.getElementById("webSuccessBox");
  const tokenResultBox = document.getElementById("tokenResultBox");
  const tokenNotice = document.getElementById("tokenNotice");

  if (timerInterval) clearInterval(timerInterval);
  if (mode === "discord") {
    title.textContent = "③ 가입 완료 — 토큰 발급";
    webSuccessBox.hidden = true;
    tokenResultBox.hidden = false;
    tokenNotice.hidden = false;
    return;
  }

  title.textContent = "③ 웹 회원가입 완료";
  webSuccessBox.hidden = false;
  tokenResultBox.hidden = true;
  tokenNotice.hidden = true;
}

function persistRegisteredUser(user, authToken = "") {
  const school = {
    name: user.schoolName || "",
    schoolCode: user.schoolCode || "",
    officeCode: user.officeCode || "",
    officeName: user.officeName || "",
    type: user.type || ""
  };
  localStorage.setItem("favoriteSchool", JSON.stringify(school));
  localStorage.setItem("search.state.v1", JSON.stringify({
    schoolName: user.schoolName || "",
    grade: user.grade || "",
    classNo: user.classNo || "",
    weekStartDate: "",
    mealMonthDate: ""
  }));
  localStorage.setItem("schoolBotLoginUser", JSON.stringify({
    userId: user.userId || "",
    authToken,
    school,
    grade: user.grade || "",
    classNo: user.classNo || "",
    loggedInAt: Date.now()
  }));
  if (Array.isArray(user.favorites)) {
    localStorage.setItem(`favorite.list.v1:${user.userId || ""}`, JSON.stringify(user.favorites));
  }
}

async function submitRegister(mode = "web") {
  if (!validateRegistrationBasics("step2Msg", { returnToStep1: true })) return;
  if (!hasReadPrivacy()) {
    updatePrivacyGate();
    return showMsg("step2Msg", "개인정보처리방침 전문을 먼저 끝까지 확인해 주세요.", "error");
  }
  if (!hasReadTerms()) {
    updatePrivacyGate();
    return showMsg("step2Msg", "이용약관 전문을 먼저 끝까지 확인해 주세요.", "error");
  }
  if (!document.getElementById("agreeCheck").checked) {
    return showMsg("step2Msg", "개인정보 수집 및 이용에 동의해주세요.", "error");
  }
  if (!document.getElementById("termsAgreeCheck").checked) {
    return showMsg("step2Msg", "이용약관에 동의해주세요.", "error");
  }
  if (!document.getElementById("ageCheck").checked) {
    return showMsg("step2Msg", "만 14세 이상인 경우에만 가입할 수 있습니다.", "error");
  }
  if (!firebaseIdToken && !isPasswordAuthReady()) {
    return showMsg("step2Msg", "ID/비밀번호를 확인하거나 SMS 또는 Google 인증을 완료해 주세요.", "error");
  }

  const isDiscordMode = mode === "discord";
  const btn = document.getElementById(isDiscordMode ? "tokenSubmitBtn" : "submitBtn");
  const originalText = btn.textContent;
  document.getElementById("submitBtn").disabled = true;
  document.getElementById("tokenSubmitBtn").disabled = true;
  btn.innerHTML = '<span class="reg-spinner"></span>처리 중...';

  try {
    const body = {
      schoolCode: selectedSchool.schoolCode,
      officeCode: selectedSchool.officeCode,
      schoolName: selectedSchool.name,
      officeName: selectedSchool.officeName || "",
      type:       selectedSchool.type || "",
      grade:      document.getElementById("grade").value.trim(),
      classNo:    document.getElementById("classNo").value.trim(),
      userId:     normalizeUserIdInput(document.getElementById("userId").value),
      password:   document.getElementById("password").value,
      privacyAgreed: document.getElementById("agreeCheck").checked,
      privacyConfirmed: document.getElementById("agreeCheck").checked,
      termsAgreed: document.getElementById("termsAgreeCheck").checked,
      termsConfirmed: document.getElementById("termsAgreeCheck").checked,
      ageConfirmed: document.getElementById("ageCheck").checked,
      privacyReadAt: getPrivacyReadAt(),
      termsReadAt: getTermsReadAt(),
      firebaseIdToken,
      firebaseAuthMethod
    };

    const res = await fetch(isDiscordMode ? "/api/register" : "/api/register/web", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) return showMsg("step2Msg", data.message || data.error || "오류가 발생했습니다.", "error");

    setStep3Mode(isDiscordMode ? "discord" : "web");
    if (isDiscordMode) {
      tokenValue = data.token;
      document.getElementById("tokenValue").textContent = tokenValue;
      startTimer(5 * 60);
    } else {
      tokenValue = "";
      persistRegisteredUser(data.user || {}, data.authToken);
    }
    clearRegisterDraft();
    showStep("step3", false);
  } catch {
    showMsg("step2Msg", "서버 연결에 실패했습니다.", "error");
  } finally {
    updateSubmitGate();
    btn.textContent = originalText;
  }
}

function copyToken() {
  navigator.clipboard.writeText(tokenValue).then(() => {
    const btn = document.querySelector(".reg-token-copy");
    btn.textContent = "✅ 복사됨!";
    setTimeout(() => btn.textContent = "📋 복사하기", 2000);
  });
}

function startTimer(seconds) {
  if (timerInterval) clearInterval(timerInterval);
  let remaining = seconds;
  function update() {
    const m = String(Math.floor(remaining / 60)).padStart(2, "0");
    const s = String(remaining % 60).padStart(2, "0");
    const el = document.getElementById("timerEl");
    el.textContent = `⏱ ${m}:${s} 후 만료`;
    if (remaining <= 0) {
      clearInterval(timerInterval);
      el.textContent = "⛔ 토큰이 만료되었습니다. 다시 가입해주세요.";
      el.style.background = "#fee2e2";
      el.style.color = "#991b1b";
    }
    remaining--;
  }
  update();
  timerInterval = setInterval(update, 1000);
}

function showMsg(id, text, type) {
  const el = document.getElementById(id);
  el.textContent = text;
  el.className = `reg-msg ${type}`;
}

function clearMsg(id) {
  const el = document.getElementById(id);
  el.textContent = "";
  el.className = "reg-msg";
}

// ── Page initialization ───────────────────────────────────

function initPasswordToggles() {
  document.querySelectorAll("[data-password-toggle]").forEach(button => {
    const targetId = button.dataset.passwordToggle;
    const input = document.getElementById(targetId);
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

document.addEventListener("DOMContentLoaded", () => {
  updateLegalLinks();
  initLegalModal();
  initPasswordToggles();
  restoreRegisterDraft();
  clearResumeQuery();
  updatePrivacyGate();
  initFirebaseAuth();
  document.getElementById("searchBtn")?.addEventListener("click", searchSchool);
  document.getElementById("schoolInput").addEventListener("keydown", e => {
    if (e.key === "Enter") searchSchool();
  });
  ["schoolInput", "grade", "classNo", "userId", "password", "passwordConfirm", "phoneNumber", "phoneCode"].forEach(id => {
    document.getElementById(id)?.addEventListener("input", () => {
      saveRegisterDraft();
      updateSubmitGate();
    });
  });
  ["agreeCheck", "termsAgreeCheck", "ageCheck"].forEach(id => {
    document.getElementById(id)?.addEventListener("change", saveRegisterDraft);
  });
  document.getElementById("phoneNumber").addEventListener("input", () => {
    phoneConfirmationResult = null;
    const confirmBtn = document.getElementById("confirmPhoneBtn");
    if (confirmBtn) confirmBtn.disabled = true;
    if (firebaseAuthMethod === "google") {
      setPhoneStatus("Google 인증이 완료되었습니다. SMS로 바꾸려면 인증 문자를 받아 주세요.", true);
      updateSubmitGate();
      return;
    }
    clearFirebaseAuthToken("휴대폰 번호를 입력하고 인증 문자를 받아 주세요.");
  });
});

window.addEventListener("focus", () => {
  restoreRegisterDraft();
  updatePrivacyGate();
});
window.addEventListener("pagehide", saveRegisterDraft);
window.addEventListener("beforeunload", saveRegisterDraft);
window.addEventListener("storage", e => {
  if (
    e.key === PRIVACY_READ_KEY ||
    e.key === TERMS_READ_KEY ||
    e.key === PRIVACY_READ_NONCE_KEY ||
    e.key === TERMS_READ_NONCE_KEY
  ) {
    updatePrivacyGate();
  }
});
