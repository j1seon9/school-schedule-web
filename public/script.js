// public/script.js

// ===== helpers =====
const qs = id => document.getElementById(id);
const formatYMD = ymd =>
  String(ymd || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");

// ===== API helper =====
async function apiGet(url) {
  if (!navigator.onLine) throw new Error("offline");
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status);
  return res.json();
}

// ===== KST =====
function nowKST() {
  const utc = Date.now();
  return new Date(utc + 9 * 60 * 60 * 1000);
}

// ===== network status =====
window.addEventListener("offline", () => {
  qs("networkStatus").style.display = "block";
});
window.addEventListener("online", () => {
  qs("networkStatus").style.display = "none";
});

// ===== modal =====
const modal = qs("schoolModal");
const modalList = qs("schoolList");
const closeModalBtn = qs("closeModalBtn");

function openModal(items) {
  modalList.innerHTML = "";

  items.forEach(s => {
    const regionText = s.officeName ? `, ${s.officeName}` : "";
    const li = document.createElement("li");

    li.textContent = `${s.name} (${s.type}${s.gender ? ", " + s.gender : ""}${regionText})`;

    li.addEventListener("click", () => {
      qs("schoolCode").value = s.schoolCode;
      qs("officeCode").value = s.officeCode;
      qs("schoolType").value = s.type || "";
      qs("selectedSchool").textContent =
        `${s.name} (${s.type || "학교"}${regionText})`;
      qs("schoolName").value = s.name || "";

      //officeName 명시적으로 저장
      localStorage.setItem(
        "favoriteSchool",
        JSON.stringify({
          name: s.name,
          schoolCode: s.schoolCode,
          officeCode: s.officeCode,
          type: s.type,
          officeName: s.officeName || ""
        })
      );

      closeModal();
      autoQuery();
    });

    modalList.appendChild(li);
  });

  modal.setAttribute("aria-hidden", "false");
}

function closeModal() {
  modal.setAttribute("aria-hidden", "true");
}
closeModalBtn.addEventListener("click", closeModal);
modal.addEventListener("click", e => {
  if (e.target === modal) closeModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") closeModal();
});

// ===== 즐겨찾기 =====
qs("favoriteBtn").addEventListener("click", () => {
  const schoolCode = qs("schoolCode").value;
  const officeCode = qs("officeCode").value;
  if (!schoolCode || !officeCode) {
    alert("먼저 학교를 선택하세요.");
    return;
  }

  const school = {
    name: qs("schoolName").value,
    schoolCode,
    officeCode,
    type: qs("schoolType").value,
    officeName: ""
  };

  localStorage.setItem("favoriteSchool", JSON.stringify(school));

  const grade = qs("grade").value;
  const classNo = qs("classNo").value;
  if (grade && classNo) {
    localStorage.setItem(
      "favoriteClass",
      JSON.stringify({ grade, classNo })
    );
  }

  alert("즐겨찾기에 저장했습니다.");
});

function loadFavorite() {
  const savedSchool = localStorage.getItem("favoriteSchool");
  if (savedSchool) {
    try {
      const s = JSON.parse(savedSchool);
      qs("schoolCode").value = s.schoolCode || "";
      qs("officeCode").value = s.officeCode || "";
      qs("schoolType").value = s.type || "";
      qs("schoolName").value = s.name || "";

      const regionText = s.officeName ? `, ${s.officeName}` : "";
      qs("selectedSchool").textContent =
        s.name ? `${s.name} (${s.type || "학교"}${regionText})` : "";
    } catch {}
  }

  const savedClass = localStorage.getItem("favoriteClass");
  if (savedClass) {
    try {
      const c = JSON.parse(savedClass);
      qs("grade").value = c.grade || "";
      qs("classNo").value = c.classNo || "";
    } catch {}
  }
}

// ===== 학교 검색 =====
qs("searchSchoolBtn").addEventListener("click", async () => {
  const name = (qs("schoolName").value || "").trim();
  if (!name) {
    alert("학교명을 입력하세요.");
    return;
  }

  try {
    const res = await fetch(`/api/searchSchool?name=${encodeURIComponent(name)}`);
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) {
      alert("검색 결과가 없습니다.");
      return;
    }
    openModal(data);
  } catch {
    alert("학교 검색 중 오류가 발생했습니다.");
  }
});

// ===== 오늘 시간표 + 급식 =====
async function loadToday() {
  const schoolCode = qs("schoolCode").value;
  const officeCode = qs("officeCode").value;
  const grade = qs("grade").value;
  const classNo = qs("classNo").value;
  if (!schoolCode || !officeCode || !grade || !classNo) return;

  localStorage.setItem(
    "favoriteClass",
    JSON.stringify({ grade, classNo })
  );

  try {
    const res = await fetch(
      `/api/dailyTimetable?schoolCode=${schoolCode}&officeCode=${officeCode}&grade=${grade}&classNo=${classNo}`
    );
    const data = await res.json();

    const ul = qs("dailyTimetable");
    ul.innerHTML = "";

    if (!Array.isArray(data) || data.length === 0) {
      ul.textContent = "시간표 정보가 없습니다.";
    } else {
      data
        .sort((a, b) => Number(a.period) - Number(b.period))
        .forEach(item => {
          const li = document.createElement("li");
          li.textContent = `${item.period}교시: ${item.subject}`;
          ul.appendChild(li);
        });
    }
  } catch {
    alert("시간표 조회 중 오류");
  }

  try {
    const res = await fetch(
      `/api/dailyMeal?schoolCode=${schoolCode}&officeCode=${officeCode}`
    );
    const data = await res.json();

    const el = qs("dailyMeal");
    if (!data || !data.menu) {
      el.textContent = "방학 중 급식 없음";
    } else {
      el.textContent = String(data.menu).replace(/<br\s*\/?>/gi, "\n");
    }
  } catch {
    alert("급식 조회 중 오류");
  }
  qs("loadTodayBtn").addEventListener("click", () => loadToday(false));
}


// ===== 주간 시간표 =====
async function loadWeekly() {
  const schoolCode = qs("schoolCode").value;
  const officeCode = qs("officeCode").value;
  const grade = qs("grade").value;
  const classNo = qs("classNo").value;
  const startDateEl = qs("weekStartDate");

  if (!schoolCode || !officeCode || !grade || !classNo || !startDateEl.value) return;

  // normalize to Monday start
  const selDate = new Date(startDateEl.value);
  const day = selDate.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  selDate.setDate(selDate.getDate() + diff);

  const mondayStr = selDate.toISOString().slice(0, 10);
  startDateEl.value = mondayStr;
  const startDate = mondayStr.replace(/-/g, "");

  try {
    const res = await fetch(
      `/api/weeklyTimetable?schoolCode=${schoolCode}&officeCode=${officeCode}&grade=${grade}&classNo=${classNo}&startDate=${startDate}`
    );
    const data = await res.json();

    const grid = qs("weeklyGrid");
    grid.innerHTML = "";

    if (!Array.isArray(data) || data.length === 0) {
      grid.textContent = "주간 시간표 정보 없음";
      return;
    }

    // map: dateKey -> { period: subject }
    const map = {};
    let maxPeriod = 0;
    data.forEach(it => {
      const p = Number(it.period || 0) || 0;
      if (!map[it.date]) map[it.date] = {};
      map[it.date][p] = it.subject || "";
      if (p > maxPeriod) maxPeriod = p;
    });

    // ensure at least 6 periods shown
    maxPeriod = Math.max(maxPeriod, 6);

    // build table
    const table = document.createElement("table");
    table.className = "weekly-table";

    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    const thPeriod = document.createElement("th");
    thPeriod.textContent = "교시 / 요일";
    headRow.appendChild(thPeriod);

    const monday = new Date(mondayStr);
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const key = d.toISOString().slice(0, 10).replace(/-/g, "");
      days.push({ key, date: d });
      const th = document.createElement("th");
      th.innerHTML = `${d.toLocaleDateString('ko-KR', { weekday: 'short' })}<br><span style="font-weight:400;font-size:12px;color:#fffde8">${d.getMonth()+1}/${d.getDate()}</span>`;
      headRow.appendChild(th);
    }

    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (let p = 1; p <= maxPeriod; p++) {
      const tr = document.createElement("tr");
      const tdPeriod = document.createElement("td");
      tdPeriod.className = "period-col";
      tdPeriod.textContent = `${p}교시`;
      tr.appendChild(tdPeriod);

      days.forEach(day => {
        const td = document.createElement("td");
        const subj = (map[day.key] && map[day.key][p]) ? map[day.key][p] : "";
        td.textContent = subj || "";
        if (!subj) td.classList.add("empty");
        tr.appendChild(td);
      });

      tbody.appendChild(tr);
    }

    table.appendChild(tbody);
    grid.appendChild(table);
  } catch (e) {
    console.error(e);
    alert("주간 시간표 조회 오류");
  }
}
qs("loadWeeklyTimetableBtn").addEventListener("click", () => loadWeekly(true));

// ===== 월간 급식 =====
async function loadMonthlyMeal() {
  const schoolCode = qs("schoolCode").value;
  const officeCode = qs("officeCode").value;
  let base = qs("mealMonthDate").value;

  const grid = qs("monthlyMealGrid");
  grid.innerHTML = "";

  if (!schoolCode || !officeCode) return;

  if (!base) {
    const k = nowKST();
    base = `${k.getFullYear()}-${String(k.getMonth() + 1).padStart(2, "0")}-01`;
    qs("mealMonthDate").value = base;
  }

  const year = Number(base.slice(0, 4));
  const month = Number(base.slice(5, 7));
  const start = `${year}${String(month).padStart(2, "0")}01`;
  const last = new Date(year, month, 0).getDate();
  const end = `${year}${String(month).padStart(2, "0")}${String(last).padStart(2, "0")}`;
  const todayKey = nowKST().toISOString().slice(0, 10).replace(/-/g, "");

  try {
    const res = await fetch(
      `/api/monthlyMeal?schoolCode=${schoolCode}&officeCode=${officeCode}&startDate=${start}&endDate=${end}`
    );
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      grid.textContent = "방학 중 급식 없음";
      return;
    }

    //    map 먼저 생성
    const map = {};
    data.forEach(it => (map[it.date] = it.menu));

    //    첫 요일 공백
    const firstDay = new Date(year, month - 1, 1).getDay();
    for (let i = 0; i < firstDay; i++) {
      grid.appendChild(document.createElement("div"));
    }

    // ✅ 날짜 셀 생성 (1번만)
    for (let d = 1; d <= last; d++) {
      const key = `${year}${String(month).padStart(2, "0")}${String(d).padStart(2, "0")}`;
      const cell = document.createElement("div");

      if (key === todayKey) cell.classList.add("today");

      const menu = (map[key] || "").replace(/<br\s*\/?>/gi, ", ");
      cell.innerHTML = `<strong>${d}</strong>${menu}`;
      grid.appendChild(cell);
    }
  } catch (e) {
    console.error(e);
    alert("월간 급식 조회 오류");
  }
}
qs("loadMonthlyMealBtn").addEventListener("click", () => loadMonthlyMeal(true));

// ===== 자동 조회 =====
async function autoQuery() {
  await loadToday(false);
  if (qs("weekStartDate").value) {
    await loadWeekly(false);
  }
  await loadMonthlyMeal();
}

// ===== init =====
document.addEventListener("DOMContentLoaded", () => {
  loadFavorite();
  autoQuery();
});
