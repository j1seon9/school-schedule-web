// public/login.js

let firebaseAuth = null;
let recaptchaVerifier = null;
let phoneConfirmationResult = null;
let firebaseClientConfig = null;
const REDIRECTING_TO_LOCALHOST = window.location.hostname === "127.0.0.1";

if (REDIRECTING_TO_LOCALHOST) {
  const url = new URL(window.location.href);
  url.hostname = "localhost";
  window.location.replace(url.toString());
}

function setLoginStatus(text, isReady = false) {
  const el = document.getElementById("loginStatus");
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

function hideMissingUser() {
  const box = document.getElementById("missingUserBox");
  if (box) box.hidden = true;
}

function showMissingUser() {
  const box = document.getElementById("missingUserBox");
  if (box) box.hidden = false;
}

function goRegister() {
  window.location.href = "/register";
}

function persistLoggedInUser(user) {
  const school = {
    name: user.schoolName || "",
    schoolCode: user.schoolCode || "",
    officeCode: user.officeCode || "",
    officeName: user.officeName || "",
    type: user.type || ""
  };

  const searchState = {
    schoolName: user.schoolName || "",
    grade: user.grade || "",
    classNo: user.classNo || "",
    weekStartDate: "",
    mealMonthDate: ""
  };

  localStorage.setItem("favoriteSchool", JSON.stringify(school));
  localStorage.setItem("search.state.v1", JSON.stringify(searchState));
  localStorage.setItem("schoolBotLoginUser", JSON.stringify({
    school,
    grade: user.grade || "",
    classNo: user.classNo || "",
    loggedInAt: Date.now()
  }));
}

async function finishLogin(idToken) {
  hideMissingUser();
  setLoginStatus("회원정보를 확인하는 중입니다...");

  const response = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ firebaseIdToken: idToken })
  });
  const data = await response.json();

  if (response.status === 404 && data.error === "USER_NOT_FOUND") {
    setLoginStatus("회원정보가 없습니다.");
    showMissingUser();
    return;
  }
  if (!response.ok) {
    setLoginStatus(data.message || data.error || "로그인에 실패했습니다.");
    return;
  }

  persistLoggedInUser(data.user);
  setLoginStatus("로그인이 완료되었습니다. 메인 페이지로 이동합니다.", true);
  window.location.href = "/";
}

async function initFirebaseAuth() {
  if (REDIRECTING_TO_LOCALHOST) return;

  const sendBtn = document.getElementById("sendPhoneBtn");
  const googleBtn = document.getElementById("googleLoginBtn");
  if (!window.firebase) {
    if (sendBtn) sendBtn.disabled = true;
    if (googleBtn) googleBtn.disabled = true;
    setLoginStatus("Firebase SDK를 불러오지 못했습니다. 네트워크를 확인해 주세요.");
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
        await finishLogin(idToken);
        return;
      }
    } catch (e) {
      setLoginStatus(`Google 인증 결과를 확인하지 못했습니다: ${e.message}`);
    }

    try {
      recaptchaVerifier = new firebase.auth.RecaptchaVerifier("recaptchaContainer", {
        size: "normal"
      });
      await recaptchaVerifier.render();
      if (sendBtn) sendBtn.disabled = false;
      setLoginStatus("Google 또는 SMS 인증으로 로그인해 주세요.");
    } catch (e) {
      if (sendBtn) sendBtn.disabled = true;
      setLoginStatus(`SMS 인증 설정을 확인해 주세요: ${e.message} Google 인증은 사용할 수 있습니다.`);
    }
  } catch (e) {
    if (sendBtn) sendBtn.disabled = true;
    if (googleBtn) googleBtn.disabled = true;
    setLoginStatus(`Firebase 설정이 필요합니다: ${e.message}`);
  }
}

async function resetRecaptcha() {
  if (!recaptchaVerifier) return;
  const widgetId = await recaptchaVerifier.render();
  if (window.grecaptcha) window.grecaptcha.reset(widgetId);
}

async function signInWithGoogle() {
  if (!firebaseAuth) return setLoginStatus("Firebase 인증 설정을 먼저 확인해 주세요.");

  const googleBtn = document.getElementById("googleLoginBtn");
  googleBtn.disabled = true;
  hideMissingUser();
  setLoginStatus("Google 인증 페이지로 이동합니다...");

  try {
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: "select_account" });
    await firebaseAuth.signInWithRedirect(provider);
  } catch (e) {
    googleBtn.disabled = false;
    if (e.code === "auth/unauthorized-domain") {
      setLoginStatus("Google 인증 허용 도메인 문제가 있습니다. http://localhost:8000/login 으로 접속해 주세요.");
      return;
    }
    setLoginStatus(`Google 인증에 실패했습니다: ${e.message}`);
  }
}

async function sendPhoneCode() {
  if (!firebaseAuth || !recaptchaVerifier) {
    return setLoginStatus("Firebase 인증 설정을 먼저 확인해 주세요.");
  }

  const phoneInput = document.getElementById("phoneNumber");
  const phoneNumber = normalizePhoneNumber(phoneInput.value);
  if (!/^\+[1-9]\d{7,14}$/.test(phoneNumber)) {
    return setLoginStatus("휴대폰 번호를 010-2125-7920 또는 +821021257920 형식으로 입력해 주세요.");
  }
  phoneInput.value = phoneNumber;

  const sendBtn = document.getElementById("sendPhoneBtn");
  const confirmBtn = document.getElementById("confirmPhoneBtn");
  sendBtn.disabled = true;
  hideMissingUser();
  setLoginStatus("인증 문자를 보내는 중입니다...");

  try {
    phoneConfirmationResult = await firebaseAuth.signInWithPhoneNumber(phoneNumber, recaptchaVerifier);
    if (confirmBtn) confirmBtn.disabled = false;
    if (firebaseClientConfig?.testPhoneAuthEnabled && phoneNumber === firebaseClientConfig.testPhoneNumber) {
      setLoginStatus("테스트 번호입니다. 실제 SMS는 오지 않습니다. Firebase Console에 등록한 6자리 테스트 인증번호를 입력해 주세요.");
    } else {
      setLoginStatus("인증 문자를 보냈습니다. 받은 6자리 코드를 입력해 주세요.");
    }
  } catch (e) {
    await resetRecaptcha();
    setLoginStatus(`인증 문자 발송에 실패했습니다: ${e.message}`);
  } finally {
    sendBtn.disabled = false;
  }
}

async function confirmPhoneCode() {
  if (!phoneConfirmationResult) return setLoginStatus("먼저 인증 문자를 받아 주세요.");

  const code = document.getElementById("phoneCode").value.trim();
  if (!/^\d{6}$/.test(code)) return setLoginStatus("6자리 인증번호를 입력해 주세요.");

  const confirmBtn = document.getElementById("confirmPhoneBtn");
  confirmBtn.disabled = true;
  setLoginStatus("인증번호를 확인하는 중입니다...");

  try {
    const result = await phoneConfirmationResult.confirm(code);
    const idToken = await result.user.getIdToken(true);
    await finishLogin(idToken);
  } catch (e) {
    confirmBtn.disabled = false;
    setLoginStatus(`인증번호 확인에 실패했습니다: ${e.message}`);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initFirebaseAuth();
  document.getElementById("phoneNumber").addEventListener("input", () => {
    phoneConfirmationResult = null;
    const confirmBtn = document.getElementById("confirmPhoneBtn");
    if (confirmBtn) confirmBtn.disabled = true;
    hideMissingUser();
    setLoginStatus("휴대폰 번호를 입력하고 인증 문자를 받아 주세요.");
  });
});
