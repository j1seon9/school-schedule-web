// public/Register.js

let selectedSchool = null;
let tokenValue = "";
let timerInterval = null;
let firebaseAuth = null;
let recaptchaVerifier = null;
let phoneConfirmationResult = null;
let firebaseIdToken = "";
const PRIVACY_READ_KEY = "schoolBotPrivacyReadAt";
const PRIVACY_READ_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function getPrivacyReadAt() {
  try {
    const value = Number(localStorage.getItem(PRIVACY_READ_KEY));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function hasReadPrivacy() {
  const readAt = getPrivacyReadAt();
  const now = Date.now();
  return readAt > 0 && readAt <= now + 60_000 && now - readAt <= PRIVACY_READ_MAX_AGE_MS;
}

function updatePrivacyGate() {
  const isRead = hasReadPrivacy();
  const statusEl = document.getElementById("privacyStatus");
  const agreeCheck = document.getElementById("agreeCheck");
  const confirmCheck = document.getElementById("confirmCheck");

  if (agreeCheck) agreeCheck.disabled = !isRead;
  if (confirmCheck) confirmCheck.disabled = !isRead;
  if (!isRead) {
    if (agreeCheck) agreeCheck.checked = false;
    if (confirmCheck) confirmCheck.checked = false;
  }

  if (!statusEl) return;
  statusEl.textContent = isRead
    ? "개인정보처리방침 전문 확인이 완료되었습니다."
    : "개인정보처리방침 전문을 끝까지 읽은 뒤 동의할 수 있습니다.";
  statusEl.classList.toggle("is-ready", isRead);
  updateSubmitGate();
}

function updateSubmitGate() {
  const submitBtn = document.getElementById("submitBtn");
  if (!submitBtn) return;
  submitBtn.disabled = !hasReadPrivacy() || !firebaseIdToken;
}

function setPhoneStatus(text, isReady = false) {
  const el = document.getElementById("phoneStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("is-ready", isReady);
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
  const sendBtn = document.getElementById("sendPhoneBtn");
  if (!window.firebase) {
    if (sendBtn) sendBtn.disabled = true;
    setPhoneStatus("Firebase SDK를 불러오지 못했습니다. 네트워크를 확인해 주세요.");
    updateSubmitGate();
    return;
  }

  try {
    const response = await fetch("/api/firebase-config", { cache: "no-store" });
    const config = await response.json();
    if (!response.ok) throw new Error(config.error || "FIREBASE_CONFIG_MISSING");

    if (!firebase.apps.length) firebase.initializeApp(config);
    firebaseAuth = firebase.auth();
    firebaseAuth.languageCode = "ko";
    recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptchaContainer", {
      size: "normal"
    });
    await recaptchaVerifier.render();
    setPhoneStatus("휴대폰 번호를 입력하고 인증 문자를 받아 주세요.");
  } catch (e) {
    if (sendBtn) sendBtn.disabled = true;
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
  firebaseIdToken = "";
  updateSubmitGate();
  setPhoneStatus("인증 문자를 보내는 중입니다...");

  try {
    phoneConfirmationResult = await firebaseAuth.signInWithPhoneNumber(phoneNumber, recaptchaVerifier);
    if (confirmBtn) confirmBtn.disabled = false;
    setPhoneStatus("인증 문자를 보냈습니다. 받은 6자리 코드를 입력해 주세요.");
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
    firebaseIdToken = await result.user.getIdToken(true);
    setPhoneStatus("휴대폰 번호 인증이 완료되었습니다.", true);
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

async function submitRegister() {
  if (!hasReadPrivacy()) {
    updatePrivacyGate();
    return showMsg("step2Msg", "개인정보처리방침 전문을 먼저 끝까지 확인해 주세요.", "error");
  }
  if (!document.getElementById("agreeCheck").checked) {
    return showMsg("step2Msg", "개인정보 수집 및 이용에 동의해주세요.", "error");
  }
  if (!document.getElementById("confirmCheck").checked) {
    return showMsg("step2Msg", "위의 내용을 확인했다는 항목에 체크해주세요.", "error");
  }
  if (!document.getElementById("ageCheck").checked) {
    return showMsg("step2Msg", "만 14세 이상인 경우에만 가입할 수 있습니다.", "error");
  }
  if (!firebaseIdToken) {
    return showMsg("step2Msg", "휴대폰 번호 인증을 완료해 주세요.", "error");
  }

  const btn = document.getElementById("submitBtn");
  btn.disabled = true;
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
      ageConfirmed: document.getElementById("ageCheck").checked,
      privacyReadAt: getPrivacyReadAt(),
      firebaseIdToken
    };

    const res = await fetch("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    if (!res.ok) return showMsg("step2Msg", data.error || "오류가 발생했습니다.", "error");

    tokenValue = data.token;
    document.getElementById("tokenValue").textContent = tokenValue;
    startTimer(5 * 60);
    showStep("step3");
  } catch {
    showMsg("step2Msg", "서버 연결에 실패했습니다.", "error");
  } finally {
    updateSubmitGate();
    btn.innerHTML = "가입 완료";
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
    firebaseIdToken = "";
    phoneConfirmationResult = null;
    const confirmBtn = document.getElementById("confirmPhoneBtn");
    if (confirmBtn) confirmBtn.disabled = true;
    setPhoneStatus("휴대폰 번호를 입력하고 인증 문자를 받아 주세요.");
    updateSubmitGate();
  });
});

window.addEventListener("focus", updatePrivacyGate);
window.addEventListener("storage", e => {
  if (e.key === PRIVACY_READ_KEY) updatePrivacyGate();
});
