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
const PRIVACY_READ_KEY = "schoolBotPrivacyReadAt";
const TERMS_READ_KEY = "schoolBotTermsReadAt";
const PRIVACY_READ_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const REDIRECTING_TO_LOCALHOST = window.location.hostname === "127.0.0.1";

if (REDIRECTING_TO_LOCALHOST) {
  const url = new URL(window.location.href);
  url.hostname = "localhost";
  window.location.replace(url.toString());
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
  return isRecentReadAt(getPrivacyReadAt());
}

function hasReadTerms() {
  return isRecentReadAt(getTermsReadAt());
}

function isRecentReadAt(readAt) {
  const now = Date.now();
  return readAt > 0 && readAt <= now + 60_000 && now - readAt <= PRIVACY_READ_MAX_AGE_MS;
}

function updatePrivacyGate() {
  const isPrivacyRead = hasReadPrivacy();
  const isTermsRead = hasReadTerms();
  const statusEl = document.getElementById("privacyStatus");
  const termsStatusEl = document.getElementById("termsStatus");
  const agreeCheck = document.getElementById("agreeCheck");
  const confirmCheck = document.getElementById("confirmCheck");
  const termsAgreeCheck = document.getElementById("termsAgreeCheck");
  const termsConfirmCheck = document.getElementById("termsConfirmCheck");

  if (agreeCheck) agreeCheck.disabled = !isPrivacyRead;
  if (confirmCheck) confirmCheck.disabled = !isPrivacyRead;
  if (!isPrivacyRead) {
    if (agreeCheck) agreeCheck.checked = false;
    if (confirmCheck) confirmCheck.checked = false;
  }

  if (termsAgreeCheck) termsAgreeCheck.disabled = !isTermsRead;
  if (termsConfirmCheck) termsConfirmCheck.disabled = !isTermsRead;
  if (!isTermsRead) {
    if (termsAgreeCheck) termsAgreeCheck.checked = false;
    if (termsConfirmCheck) termsConfirmCheck.checked = false;
  }

  if (statusEl) {
    statusEl.textContent = isPrivacyRead
      ? "개인정보처리방침 전문 확인이 완료되었습니다."
      : "개인정보처리방침 전문을 끝까지 읽은 뒤 동의할 수 있습니다.";
    statusEl.classList.toggle("is-ready", isPrivacyRead);
  }
  if (termsStatusEl) {
    termsStatusEl.textContent = isTermsRead
      ? "이용약관 전문 확인이 완료되었습니다."
      : "이용약관 전문을 끝까지 읽은 뒤 동의할 수 있습니다.";
    termsStatusEl.classList.toggle("is-ready", isTermsRead);
  }
  updateSubmitGate();
}

function updateSubmitGate() {
  const canSubmit = hasReadPrivacy() && hasReadTerms() && Boolean(firebaseIdToken);
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

function setFirebaseAuthToken(idToken, method, statusText) {
  firebaseIdToken = idToken || "";
  firebaseAuthMethod = method || "";
  if (statusText) setPhoneStatus(statusText, Boolean(idToken));
  updateSubmitGate();
}

function clearFirebaseAuthToken(statusText) {
  firebaseIdToken = "";
  firebaseAuthMethod = "";
  if (statusText) setPhoneStatus(statusText);
  updateSubmitGate();
}

function normalizePhoneNumber(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (raw.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("010")) return `+82${digits.slice(1)}`;
  if (digits.startsWith("8210")) return `+${digits}`;
  return raw;
}

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
  clearFirebaseAuthToken("Google 인증 페이지로 이동합니다...");

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await firebaseAuth.signInWithRedirect(provider);
  } catch (e) {
    if (e.code === "auth/unauthorized-domain") {
      setPhoneStatus("Google 인증 허용 도메인 문제가 있습니다. 로컬은 http://localhost:8000/register 로 접속하거나 Firebase Authorized domains에 현재 도메인을 추가해 주세요.");
      return;
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
    return setPhoneStatus("휴대폰 번호를 010-2125-7920 또는 +821021257920 형식으로 입력해 주세요.");
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
  liEl.classList.add("selected");
  const selectedEl = document.getElementById("selectedSchool");
  const officeText = school.officeName ? `, ${school.officeName}` : "";
  selectedEl.textContent = `✅ ${school.name} (${school.type}${officeText})`;
  selectedEl.style.display = "block";
  clearMsg("step1Msg");
}

function goStep2() {
  if (!selectedSchool) return showMsg("step1Msg", "학교를 선택하세요.", "error");
  const grade   = document.getElementById("grade").value.trim();
  const classNo = document.getElementById("classNo").value.trim();
  if (!grade)   return showMsg("step1Msg", "학년을 입력하세요.", "error");
  if (!classNo) return showMsg("step1Msg", "반을 입력하세요.", "error");
  clearMsg("step1Msg");
  updatePrivacyGate();
  showStep("step2");
}

function goStep1() { showStep("step1"); }

function showStep(id) {
  document.querySelectorAll(".reg-step").forEach(el => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
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

async function submitRegister(mode = "web") {
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
  if (!document.getElementById("confirmCheck").checked) {
    return showMsg("step2Msg", "위의 내용을 확인했다는 항목에 체크해주세요.", "error");
  }
  if (!document.getElementById("termsAgreeCheck").checked) {
    return showMsg("step2Msg", "이용약관에 동의해주세요.", "error");
  }
  if (!document.getElementById("termsConfirmCheck").checked) {
    return showMsg("step2Msg", "이용약관 내용을 확인했다는 항목에 체크해주세요.", "error");
  }
  if (!document.getElementById("ageCheck").checked) {
    return showMsg("step2Msg", "만 14세 이상인 경우에만 가입할 수 있습니다.", "error");
  }
  if (!firebaseIdToken) {
    return showMsg("step2Msg", "SMS 또는 Google 인증을 완료해 주세요.", "error");
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
      privacyAgreed: document.getElementById("agreeCheck").checked,
      privacyConfirmed: document.getElementById("confirmCheck").checked,
      termsAgreed: document.getElementById("termsAgreeCheck").checked,
      termsConfirmed: document.getElementById("termsConfirmCheck").checked,
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
    }
    showStep("step3");
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

document.addEventListener("DOMContentLoaded", () => {
  updatePrivacyGate();
  initFirebaseAuth();
  document.getElementById("schoolInput").addEventListener("keydown", e => {
    if (e.key === "Enter") searchSchool();
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

window.addEventListener("focus", updatePrivacyGate);
window.addEventListener("storage", e => {
  if (e.key === PRIVACY_READ_KEY || e.key === TERMS_READ_KEY) updatePrivacyGate();
});
