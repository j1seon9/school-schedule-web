const qs = (id) => document.getElementById(id);
const loadingEl = qs("loading");

function showLoading() {
  loadingEl?.classList.remove("hidden");
}

function hideLoading() {
  loadingEl?.classList.add("hidden");
}

function nowKst() {
  return new Date(Date.now() + 9 * 60 * 60 * 1000);
}

function getMondayDateValue(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

function getMonthFirstValue(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-01`;
}

function noDashYmd(value) {
  return String(value || "").replace(/-/g, "");
}

function splitMealMenu(rawMenu) {
  const normalized = String(rawMenu || "")
    .replace(/&lt;\s*\/?br\s*\/?&gt;/gi, "\n")
    .replace(/<\/?br\s*\/?>/gi, "\n")
    .replace(/\r/g, "")
    .trim();

  if (!normalized) return [];
  return normalized
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseMealItem(rawItem) {
  const source = String(rawItem || "").trim();
  if (!source) return null;

  const allergyMatches = [...source.matchAll(/\(([\d.,\s]+)\)/g)];
  const allergyCodes = [];

  allergyMatches.forEach((match) => {
    const codes = String(match[1] || "")
      .split(/[^0-9]+/)
      .map((code) => code.trim())
      .filter(Boolean);
    codes.forEach((code) => {
      if (!allergyCodes.includes(code)) allergyCodes.push(code);
    });
  });

  const name = source
    .replace(/\(([\d.,\s]+)\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return {
    name: name || source,
    allergyCodes
  };
}

function parseMealItems(rawMenu) {
  return splitMealMenu(rawMenu)
    .map((item) => parseMealItem(item))
    .filter(Boolean);
}

function showAllergyInfo(item) {
  const name = item?.name || "급식";
  const codes = Array.isArray(item?.allergyCodes) ? item.allergyCodes : [];
  const info = codes.length > 0 ? codes.join(", ") : "정보 없음";
  alert(`${name}\n알레르기 번호: ${info}`);
}

function getSelectedClassInfo() {
  return {
    schoolCode: String(qs("schoolCode")?.value || "").trim(),
    officeCode: String(qs("officeCode")?.value || "").trim(),
    grade: String(qs("grade")?.value || "").trim(),
    classNo: String(qs("classNo")?.value || "").trim()
  };
}

function hasSelectedSchool() {
  const { schoolCode, officeCode } = getSelectedClassInfo();
  return Boolean(schoolCode && officeCode);
}

function setSelectedSchool(school) {
  if (!school) return;

  const schoolCodeEl = qs("schoolCode");
  const officeCodeEl = qs("officeCode");
  const schoolTypeEl = qs("schoolType");
  const schoolNameEl = qs("schoolName");
  const selectedSchoolEl = qs("selectedSchool");

  if (schoolCodeEl) schoolCodeEl.value = school.schoolCode || "";
  if (officeCodeEl) officeCodeEl.value = school.officeCode || "";
  if (schoolTypeEl) schoolTypeEl.value = school.type || "";
  if (schoolNameEl) schoolNameEl.value = school.name || "";

  const officeText = school.officeName ? `, ${school.officeName}` : "";
  const typeText = school.type || "학교";
  if (selectedSchoolEl) {
    selectedSchoolEl.textContent = school.name ? `${school.name} (${typeText}${officeText})` : "";
  }

  localStorage.setItem("favoriteSchool", JSON.stringify(school));
}

function loadFavoriteSchool() {
  const raw = localStorage.getItem("favoriteSchool");
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    setSelectedSchool(parsed);
  } catch {
    localStorage.removeItem("favoriteSchool");
  }
}

function applyTheme(theme) {
  const toggleEl = qs("darkModeToggle");
  document.documentElement.dataset.theme = theme;
  if (toggleEl) {
    toggleEl.textContent = theme === "dark" ? "☀️" : "🌙";
  }
}

function initTheme() {
  const toggleEl = qs("darkModeToggle");
  const savedTheme = localStorage.getItem("theme") || "light";
  applyTheme(savedTheme);

  toggleEl?.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("theme", next);
    applyTheme(next);
  });
}

async function loadNotices() {
  const board = qs("noticeBoard");
  if (!board) return;

  try {
    const response = await fetch("/api/notices", { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const notices = await response.json();
    if (!Array.isArray(notices) || notices.length === 0) {
      board.innerHTML = "<li>등록된 공지사항이 없습니다.</li>";
      return;
    }

    board.innerHTML = notices
      .map((notice) => `<li>[${notice.date || "-"}] ${notice.text || ""}</li>`)
      .join("");
  } catch {
    board.innerHTML = "<li>공지사항을 불러오지 못했습니다.</li>";
  }
}

const modalEl = qs("schoolModal");
const modalListEl = qs("schoolList");
const closeModalBtnEl = qs("closeModalBtn");

function closeSchoolModal() {
  modalEl?.setAttribute("aria-hidden", "true");
}

function openSchoolModal(schools) {
  if (!modalEl || !modalListEl) return;
  modalListEl.innerHTML = "";

  schools.forEach((school) => {
    const li = document.createElement("li");
    const officeText = school.officeName ? `, ${school.officeName}` : "";
    const typeText = school.type || "학교";
    li.textContent = `${school.name} (${typeText}${officeText})`;
    li.addEventListener("click", async () => {
      setSelectedSchool(school);
      closeSchoolModal();
      await autoQuery();
    });
    modalListEl.appendChild(li);
  });

  modalEl.setAttribute("aria-hidden", "false");
}

async function searchSchool() {
  const schoolName = String(qs("schoolName")?.value || "").trim();
  if (!schoolName) {
    alert("학교 이름을 입력하세요.");
    return;
  }

  showLoading();
  try {
    const response = await fetch(`/api/searchSchool?name=${encodeURIComponent(schoolName)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const schools = await response.json();
    if (!Array.isArray(schools) || schools.length === 0) {
      alert("검색 결과가 없습니다.");
      return;
    }

    openSchoolModal(schools);
  } catch {
    alert("학교 검색 중 오류가 발생했습니다.");
  } finally {
    hideLoading();
  }
}

async function loadToday() {
  const { schoolCode, officeCode, grade, classNo } = getSelectedClassInfo();
  if (!schoolCode || !officeCode || !grade || !classNo) return;

  showLoading();
  try {
    const timetableResponse = await fetch(
      `/api/dailyTimetable?schoolCode=${encodeURIComponent(schoolCode)}` +
      `&officeCode=${encodeURIComponent(officeCode)}` +
      `&grade=${encodeURIComponent(grade)}&classNo=${encodeURIComponent(classNo)}`
    );
    const timetable = await timetableResponse.json();

    const timetableEl = qs("dailyTimetable");
    if (timetableEl) {
      timetableEl.innerHTML = Array.isArray(timetable)
        ? timetable.map((item) => `<li>${item.period}교시 ${item.subject}</li>`).join("")
        : "";
    }

    const mealResponse = await fetch(
      `/api/dailyMeal?schoolCode=${encodeURIComponent(schoolCode)}&officeCode=${encodeURIComponent(officeCode)}`
    );
    const meal = await mealResponse.json();
    const dailyMealEl = qs("dailyMeal");
    if (dailyMealEl) {
      const items = parseMealItems(meal?.menu || "");
      dailyMealEl.innerHTML = "";
      dailyMealEl.classList.add("today-meal");

      const badgeEl = document.createElement("div");
      badgeEl.className = "today-meal-badge";
      badgeEl.textContent = "오늘 급식";
      dailyMealEl.appendChild(badgeEl);

      if (items.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "meal-empty";
        emptyEl.textContent = "급식 없음";
        dailyMealEl.appendChild(emptyEl);
      } else {
        const gridEl = document.createElement("div");
        gridEl.className = "meal-grid";

        items.forEach((item) => {
          const itemEl = document.createElement("button");
          itemEl.type = "button";
          itemEl.className = "meal-item";
          itemEl.textContent = item.name;
          itemEl.title = "클릭하면 알레르기 정보를 볼 수 있습니다.";
          itemEl.addEventListener("click", () => showAllergyInfo(item));
          gridEl.appendChild(itemEl);
        });

        dailyMealEl.appendChild(gridEl);
      }
    }
  } finally {
    hideLoading();
  }
}

async function loadWeekly() {
  const { schoolCode, officeCode, grade, classNo } = getSelectedClassInfo();
  if (!schoolCode || !officeCode || !grade || !classNo) return;

  const startDateEl = qs("weekStartDate");
  const startDate = String(startDateEl?.value || "").trim() || getMondayDateValue(nowKst());
  if (startDateEl && !startDateEl.value) {
    startDateEl.value = startDate;
  }

  showLoading();
  try {
    const response = await fetch(
      `/api/weeklyTimetable?schoolCode=${encodeURIComponent(schoolCode)}` +
      `&officeCode=${encodeURIComponent(officeCode)}` +
      `&grade=${encodeURIComponent(grade)}&classNo=${encodeURIComponent(classNo)}` +
      `&startDate=${encodeURIComponent(startDate)}`
    );
    const data = await response.json();
    const weeklyGridEl = qs("weeklyGrid");
    if (!weeklyGridEl) return;

    if (!Array.isArray(data) || data.length === 0) {
      weeklyGridEl.innerHTML = "<div>주간 시간표 정보 없음</div>";
      return;
    }

    const sorted = [...data].sort((a, b) => {
      if (a.date !== b.date) return String(a.date).localeCompare(String(b.date));
      return Number(a.period) - Number(b.period);
    });
    weeklyGridEl.innerHTML = sorted
      .map((item) => `<div>${item.date}<br>${item.period}교시 ${item.subject}</div>`)
      .join("");
  } finally {
    hideLoading();
  }
}

async function loadMonthlyMeal() {
  const { schoolCode, officeCode } = getSelectedClassInfo();
  if (!schoolCode || !officeCode) return;

  const monthDateEl = qs("mealMonthDate");
  const base = String(monthDateEl?.value || "").trim() || getMonthFirstValue(nowKst());
  if (monthDateEl && !monthDateEl.value) {
    monthDateEl.value = base;
  }

  const y = Number(base.slice(0, 4));
  const m = Number(base.slice(5, 7));
  const daysInMonth = new Date(y, m, 0).getDate();
  const startDate = noDashYmd(`${y}-${String(m).padStart(2, "0")}-01`);
  const endDate = `${y}${String(m).padStart(2, "0")}${String(daysInMonth).padStart(2, "0")}`;

  showLoading();
  try {
    const response = await fetch(
      `/api/monthlyMeal?schoolCode=${encodeURIComponent(schoolCode)}` +
      `&officeCode=${encodeURIComponent(officeCode)}` +
      `&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`
    );
    const data = await response.json();

    const monthlyMealGridEl = qs("monthlyMealGrid");
    if (!monthlyMealGridEl) return;
    monthlyMealGridEl.innerHTML = "";

    const menuByDate = {};
    if (Array.isArray(data)) {
      data.forEach((item) => {
        menuByDate[item.date] = item.menu || "";
      });
    }

    const today = nowKst();
    const todayY = today.getFullYear();
    const todayM = today.getMonth() + 1;
    const todayD = today.getDate();

    const firstWeekDay = new Date(y, m - 1, 1).getDay();
    for (let i = 0; i < firstWeekDay; i += 1) {
      const emptyCell = document.createElement("div");
      emptyCell.className = "calendar-empty";
      monthlyMealGridEl.appendChild(emptyCell);
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const key = `${y}${String(m).padStart(2, "0")}${String(day).padStart(2, "0")}`;
      const cellEl = document.createElement("div");
      cellEl.className = "calendar-day";
      if (y === todayY && m === todayM && day === todayD) {
        cellEl.classList.add("is-today");
      }

      const dayEl = document.createElement("strong");
      dayEl.textContent = String(day);
      cellEl.appendChild(dayEl);

      const menuGridEl = document.createElement("div");
      menuGridEl.className = "calendar-meal-grid";
      const items = parseMealItems(menuByDate[key] || "");

      if (items.length === 0) {
        const emptyEl = document.createElement("div");
        emptyEl.className = "calendar-meal-empty";
        emptyEl.textContent = "급식 없음";
        menuGridEl.appendChild(emptyEl);
      } else {
        items.forEach((item) => {
          const itemEl = document.createElement("button");
          itemEl.type = "button";
          itemEl.className = "calendar-meal-item";
          itemEl.textContent = item.name;
          itemEl.title = "클릭하면 알레르기 정보를 볼 수 있습니다.";
          itemEl.addEventListener("click", () => showAllergyInfo(item));
          menuGridEl.appendChild(itemEl);
        });
      }

      cellEl.appendChild(menuGridEl);
      monthlyMealGridEl.appendChild(cellEl);
    }
  } finally {
    hideLoading();
  }
}

async function autoQuery() {
  if (!hasSelectedSchool()) return;
  await Promise.all([loadToday(), loadWeekly(), loadMonthlyMeal()]);
}

function setDefaultDates() {
  const kstNow = nowKst();

  const weekStartDateEl = qs("weekStartDate");
  if (weekStartDateEl && !weekStartDateEl.value) {
    weekStartDateEl.value = getMondayDateValue(kstNow);
  }

  const mealMonthDateEl = qs("mealMonthDate");
  if (mealMonthDateEl && !mealMonthDateEl.value) {
    mealMonthDateEl.value = getMonthFirstValue(kstNow);
  }
}

function initSchoolSearchEvents() {
  qs("searchSchoolBtn")?.addEventListener("click", searchSchool);

  qs("schoolName")?.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    searchSchool();
  });

  closeModalBtnEl?.addEventListener("click", closeSchoolModal);
  modalEl?.addEventListener("click", (event) => {
    if (event.target === modalEl) closeSchoolModal();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeSchoolModal();
  });
}

window.loadToday = loadToday;
window.loadWeekly = loadWeekly;
window.loadMonthlyMeal = loadMonthlyMeal;

document.addEventListener("DOMContentLoaded", async () => {
  initTheme();
  initSchoolSearchEvents();
  setDefaultDates();
  loadFavoriteSchool();
  await loadNotices();
  setInterval(loadNotices, 60_000);
  if (hasSelectedSchool()) {
    await autoQuery();
  }
});