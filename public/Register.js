let selectedSchool = null;
let tokenValue = "";
let timerInterval = null;

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
  const grade = document.getElementById("grade").value.trim();
  const classNo = document.getElementById("classNo").value.trim();
  if (!grade)   return showMsg("step1Msg", "학년을 입력하세요.", "error");
  if (!classNo) return showMsg("step1Msg", "반을 입력하세요.", "error");
  clearMsg("step1Msg");
  showStep("step2");
}

function goStep1() { showStep("step1"); }

function showStep(id) {
  document.querySelectorAll(".reg-step").forEach(el => el.classList.remove("active"));
  document.getElementById(id).classList.add("active");
}

async function submitRegister() {
  if (!document.getElementById("agreeCheck").checked) {
    return showMsg("step2Msg", "개인정보 수집 및 이용에 동의해주세요.", "error");
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
      classNo:    document.getElementById("classNo").value.trim()
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
    btn.disabled = false;
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
  document.getElementById("schoolInput").addEventListener("keydown", e => {
    if (e.key === "Enter") searchSchool();
  });
});