const qs = (id) => document.getElementById(id);
const loadingEl = qs("loading");
const favoriteListEl = qs("favoriteList");
const favoriteSaveBtnEl = qs("favoriteSaveBtn");
const favoriteEmptyEl = qs("favoriteEmpty");
const searchBtnEl = qs("searchBtn");

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

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function normalizeYmd(value) {
  const digits = String(value || "").replace(/[^0-9]/g, "");
  return digits.length === 8 ? digits : "";
}

function toYmd(date) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function getWeekDateKeys(startDateValue) {
  const startKey = normalizeYmd(startDateValue);
  if (!startKey) return [];

  const start = new Date(
    Number(startKey.slice(0, 4)),
    Number(startKey.slice(4, 6)) - 1,
    Number(startKey.slice(6, 8))
  );

  return Array.from({ length: 5 }, (_, index) => {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    return toYmd(current);
  });
}

function formatWeeklyDateLabel(dateValue) {
  const key = normalizeYmd(dateValue);
  if (!key) return String(dateValue || "");

  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(4, 6));
  const day = Number(key.slice(6, 8));
  const parsed = new Date(year, month - 1, day);
  const weekday = WEEKDAY_LABELS[parsed.getDay()] || "";
  return `${month}/${day} (${weekday})`;
}

function renderWeeklyGrid(weeklyGridEl, rows, startDate) {
  weeklyGridEl.innerHTML = "";

  const groupedByDate = new Map();
  const weekDateKeys = getWeekDateKeys(startDate);
  weekDateKeys.forEach((dateKey) => groupedByDate.set(dateKey, []));

  const sorted = [...rows].sort((a, b) => {
    const aDate = normalizeYmd(a.date);
    const bDate = normalizeYmd(b.date);
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return Number(a.period) - Number(b.period);
  });

  sorted.forEach((item) => {
    const dateKey = normalizeYmd(item.date);
    if (!dateKey) return;

    if (!groupedByDate.has(dateKey)) {
      groupedByDate.set(dateKey, []);
    }
    groupedByDate.get(dateKey).push(item);
  });

  const orderedDateKeys = weekDateKeys.length > 0
    ? weekDateKeys
    : [...groupedByDate.keys()].sort((a, b) => a.localeCompare(b));

  orderedDateKeys.forEach((dateKey) => {
    const dayEl = document.createElement("section");
    dayEl.className = "weekly-day";

    const titleEl = document.createElement("h3");
    titleEl.className = "weekly-day-title";
    titleEl.textContent = formatWeeklyDateLabel(dateKey);
    dayEl.appendChild(titleEl);

    const items = groupedByDate.get(dateKey) || [];
    if (items.length === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.className = "weekly-day-empty";
      emptyEl.textContent = "No classes";
      dayEl.appendChild(emptyEl);
      weeklyGridEl.appendChild(dayEl);
      return;
    }

    const listEl = document.createElement("ul");
    listEl.className = "weekly-day-list";

    items.forEach((item) => {
      const listItemEl = document.createElement("li");
      listItemEl.className = "weekly-day-item";

      const periodEl = document.createElement("span");
      periodEl.className = "weekly-day-period";
      periodEl.textContent = `${item.period}P`;

      const subjectEl = document.createElement("span");
      subjectEl.className = "weekly-day-subject";
      subjectEl.textContent = String(item.subject || "-");

      listItemEl.appendChild(periodEl);
      listItemEl.appendChild(subjectEl);
      listEl.appendChild(listItemEl);
    });

    dayEl.appendChild(listEl);
    weeklyGridEl.appendChild(dayEl);
  });
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
  persistSearchState();
  updateSearchButtonState();
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

const SEARCH_STATE_KEY = "search.state.v1";

function buildSearchState() {
  return {
    schoolName: String(qs("schoolName")?.value || "").trim(),
    grade: String(qs("grade")?.value || "").trim(),
    classNo: String(qs("classNo")?.value || "").trim(),
    weekStartDate: String(qs("weekStartDate")?.value || "").trim(),
    mealMonthDate: String(qs("mealMonthDate")?.value || "").trim()
  };
}

function persistSearchState() {
  try {
    const state = buildSearchState();
    localStorage.setItem(SEARCH_STATE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

function applySearchState() {
  const raw = localStorage.getItem(SEARCH_STATE_KEY);
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    const schoolNameEl = qs("schoolName");
    const gradeEl = qs("grade");
    const classNoEl = qs("classNo");
    const weekStartDateEl = qs("weekStartDate");
    const mealMonthDateEl = qs("mealMonthDate");

    if (schoolNameEl && parsed.schoolName) schoolNameEl.value = String(parsed.schoolName);
    if (gradeEl && parsed.grade) gradeEl.value = String(parsed.grade);
    if (classNoEl && parsed.classNo) classNoEl.value = String(parsed.classNo);
    if (weekStartDateEl && parsed.weekStartDate) weekStartDateEl.value = String(parsed.weekStartDate);
    if (mealMonthDateEl && parsed.mealMonthDate) mealMonthDateEl.value = String(parsed.mealMonthDate);
  } catch {
    localStorage.removeItem(SEARCH_STATE_KEY);
  }
}

function bindSearchStateEvents() {
  const fields = [
    qs("schoolName"),
    qs("grade"),
    qs("classNo"),
    qs("weekStartDate"),
    qs("mealMonthDate")
  ];

  fields.forEach((field) => {
    if (!field) return;
    field.addEventListener("input", () => {
      persistSearchState();
      updateSearchButtonState();
    });
    field.addEventListener("change", () => {
      persistSearchState();
      updateSearchButtonState();
    });
  });
}

const FAVORITE_KEY = "favorite.list.v1";
const FAVORITE_LIMIT = 3;

function getSavedSchool() {
  const raw = localStorage.getItem("favoriteSchool");
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!parsed?.schoolCode || !parsed?.officeCode) return null;
    return {
      name: String(parsed.name || "").trim(),
      schoolCode: String(parsed.schoolCode || "").trim(),
      officeCode: String(parsed.officeCode || "").trim(),
      officeName: String(parsed.officeName || "").trim(),
      type: String(parsed.type || "").trim()
    };
  } catch {
    return null;
  }
}

function buildFavoriteEntry() {
  const { schoolCode, officeCode, grade, classNo } = getSelectedClassInfo();
  if (!schoolCode || !officeCode || !grade || !classNo) return null;

  const savedSchool = getSavedSchool();
  const fallbackSchool = {
    name: String(qs("schoolName")?.value || "").trim(),
    schoolCode,
    officeCode,
    officeName: "",
    type: String(qs("schoolType")?.value || "").trim()
  };

  const school = savedSchool?.schoolCode === schoolCode && savedSchool?.officeCode === officeCode
    ? savedSchool
    : fallbackSchool;

  return {
    id: `${schoolCode}|${officeCode}|${grade}|${classNo}`,
    school,
    grade,
    classNo,
    createdAt: Date.now()
  };
}

function normalizeFavorite(item) {
  if (!item || typeof item !== "object") return null;
  const school = item.school || {};
  const schoolCode = String(school.schoolCode || "").trim();
  const officeCode = String(school.officeCode || "").trim();
  const grade = String(item.grade || "").trim();
  const classNo = String(item.classNo || "").trim();
  if (!schoolCode || !officeCode || !grade || !classNo) return null;

  return {
    id: String(item.id || `${schoolCode}|${officeCode}|${grade}|${classNo}`),
    school: {
      name: String(school.name || "").trim(),
      schoolCode,
      officeCode,
      officeName: String(school.officeName || "").trim(),
      type: String(school.type || "").trim()
    },
    grade,
    classNo,
    createdAt: Number(item.createdAt || Date.now())
  };
}

function readFavorites() {
  const raw = localStorage.getItem(FAVORITE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => normalizeFavorite(item))
      .filter(Boolean)
      .slice(0, FAVORITE_LIMIT);
  } catch {
    return [];
  }
}

function writeFavorites(list) {
  localStorage.setItem(FAVORITE_KEY, JSON.stringify(list.slice(0, FAVORITE_LIMIT)));
}

function renderFavorites() {
  if (!favoriteListEl) return;
  const favorites = readFavorites();
  favoriteListEl.innerHTML = "";

  if (favoriteEmptyEl) {
    favoriteEmptyEl.classList.toggle("hidden", favorites.length > 0);
  }

  favorites.forEach((fav) => {
    const li = document.createElement("li");
    li.className = "favorite-item";

    const meta = document.createElement("div");
    meta.className = "favorite-meta";

    const title = document.createElement("div");
    title.className = "favorite-title";
    const schoolName = fav.school?.name || "학교";
    title.textContent = `${schoolName} ${fav.grade}학년 ${fav.classNo}반`;

    const sub = document.createElement("div");
    sub.className = "favorite-sub";
    const subParts = [];
    if (fav.school?.type) subParts.push(fav.school.type);
    if (fav.school?.officeName) subParts.push(fav.school.officeName);
    if (subParts.length === 0) subParts.push(fav.school?.schoolCode || "");
    sub.textContent = subParts.filter(Boolean).join(" / ");

    meta.appendChild(title);
    meta.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "favorite-actions";

    const loadBtn = document.createElement("button");
    loadBtn.type = "button";
    loadBtn.textContent = "불러오기";
    loadBtn.addEventListener("click", async () => {
      applyFavorite(fav);
      await autoQuery();
    });

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.textContent = "삭제";
    removeBtn.classList.add("secondary");
    removeBtn.addEventListener("click", () => {
      removeFavorite(fav.id);
    });

    actions.appendChild(loadBtn);
    actions.appendChild(removeBtn);

    li.appendChild(meta);
    li.appendChild(actions);
    favoriteListEl.appendChild(li);
  });
}

function removeFavorite(id) {
  const current = readFavorites();
  const next = current.filter((item) => String(item.id) !== String(id));
  writeFavorites(next);
  renderFavorites();
}

function saveCurrentFavorite() {
  const entry = buildFavoriteEntry();
  if (!entry) {
    alert("학교, 학년, 반을 선택해 주세요.");
    return;
  }

  const current = readFavorites();
  const next = [entry, ...current.filter((item) => String(item.id) !== entry.id)];
  writeFavorites(next);
  renderFavorites();
}

function applyFavorite(fav) {
  if (fav?.school) setSelectedSchool(fav.school);

  const gradeEl = qs("grade");
  const classNoEl = qs("classNo");
  if (gradeEl) gradeEl.value = fav.grade || "";
  if (classNoEl) classNoEl.value = fav.classNo || "";

  persistSearchState();
  updateSearchButtonState();
}

function updateSearchButtonState() {
  if (!searchBtnEl) return;
  const { grade } = getSelectedClassInfo();
  searchBtnEl.disabled = !grade;
}

function handleSearchClick() {
  const { schoolCode, officeCode, grade, classNo } = getSelectedClassInfo();
  if (!grade) {
    alert("학년을 입력해 주세요.");
    return;
  }
  if (!schoolCode || !officeCode) {
    alert("학교를 먼저 선택해 주세요.");
    return;
  }
  if (!classNo) {
    alert("반을 입력해 주세요.");
    return;
  }

  persistSearchState();
  autoQuery();
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
    renderWeeklyGrid(weeklyGridEl, Array.isArray(data) ? data : [], startDate);
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
  bindSearchStateEvents();
  applySearchState();
  loadFavoriteSchool();
  renderFavorites();
  setDefaultDates();
  updateSearchButtonState();
  favoriteSaveBtnEl?.addEventListener("click", saveCurrentFavorite);
  searchBtnEl?.addEventListener("click", handleSearchClick);
  await loadNotices();
  setInterval(loadNotices, 60_000);
  if (hasSelectedSchool()) {
    await autoQuery();
  }
});
