const metaEl = document.querySelector("#meta");
const factionSelectEl = document.querySelector("#faction-select");
const unitSearchEl = document.querySelector("#unit-search");
const reloadBtn = document.querySelector("#reload-button");
const unitListEl = document.querySelector("#unit-list");
const unitTitleEl = document.querySelector("#unit-title");
const unitSubtitleEl = document.querySelector("#unit-subtitle");
const profileBodyEl = document.querySelector("#profile-table tbody");
const keywordsEl = document.querySelector("#keywords");
const abilitiesHeadEl = document.querySelector("#abilities-table thead");
const abilitiesBodyEl = document.querySelector("#abilities-table tbody");

const REQUIRED_FILES = ["Factions.csv", "Datasheets.csv", "Datasheets_keywords.csv", "Datasheets_abilities.csv"];

let indexData = null;
let catalog = { factions: [], units: [] };
let currentUnitId = null;
let parserWarnings = [];

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatUtc(dateLike) {
  const dt = new Date(dateLike);
  if (Number.isNaN(dt.valueOf())) return "unknown";
  return dt.toLocaleString("ru-RU", { timeZone: "UTC" }) + " UTC";
}

function normalized(text) {
  return String(text || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function pickKey(row, candidates) {
  const keys = Object.keys(row || {});
  const map = new Map(keys.map((k) => [normalized(k), k]));
  for (const candidate of candidates) {
    const found = map.get(normalized(candidate));
    if (found) return found;
  }
  return null;
}

function firstNonEmpty(row, candidates) {
  const key = pickKey(row, candidates);
  return key ? String(row[key] ?? "").trim() : "";
}

function parseCsvWithDelimiter(text, delimiter) {
  return Papa.parse(text, {
    header: true,
    delimiter,
    skipEmptyLines: "greedy",
    transformHeader: (h) => String(h || "").trim(),
  });
}

function parseCsvSmart(text, fileName) {
  const delimiters = [";", ",", "\t", "|"];
  const attempts = delimiters.map((delimiter) => {
    const parsed = parseCsvWithDelimiter(text, delimiter);
    const fields = parsed.meta.fields ?? [];
    const severeErrors = parsed.errors.filter((e) => e.type !== "FieldMismatch").length;
    const mismatchErrors = parsed.errors.filter((e) => e.type === "FieldMismatch").length;
    const score = fields.length * 1000 + parsed.data.length - severeErrors * 10000 - mismatchErrors;
    return { delimiter, parsed, score, severeErrors, mismatchErrors };
  });

  attempts.sort((a, b) => b.score - a.score);
  const best = attempts[0];

  if (!best || best.severeErrors > 0) {
    const err = best?.parsed?.errors?.[0]?.message || "Cannot parse csv";
    throw new Error(`${fileName}: ${err}`);
  }

  if (best.mismatchErrors > 0) {
    parserWarnings.push(`${fileName}: ${best.mismatchErrors} строк(и) с нестандартным числом полей`);
  }

  const rows = best.parsed.data
    .map((row) => {
      const copy = {};
      for (const [key, value] of Object.entries(row)) {
        if (key === "__parsed_extra") continue;
        copy[String(key).trim()] = value;
      }
      return copy;
    })
    .filter((row) => Object.values(row).some((v) => String(v ?? "").trim() !== ""));

  return { rows, fields: best.parsed.meta.fields ?? [] };
}

async function loadCsv(fileName) {
  const response = await fetch(`./data/${encodeURIComponent(fileName)}`, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Unable to fetch ${fileName}: ${response.status}`);
  }
  const text = await response.text();
  return parseCsvSmart(text, fileName);
}

function renderMeta() {
  const changed = indexData.changed_files?.length ? indexData.changed_files.join(", ") : "изменений нет";
  const skipped = indexData.skipped_missing_files?.length
    ? `<br /><strong>Пропущены (404):</strong> ${escapeHtml(indexData.skipped_missing_files.join(", "))}`
    : "";
  const warnings = parserWarnings.length
    ? `<br /><strong>Предупреждения парсера:</strong> ${escapeHtml(parserWarnings.join(" | "))}`
    : "";

  metaEl.innerHTML = `
    <strong>Источник:</strong> ${escapeHtml(indexData.source || "Wahapedia")}
    <br /><strong>Последняя проверка:</strong> ${escapeHtml(formatUtc(indexData.updated_at_utc))}
    <br /><strong>Файлы с изменениями:</strong> ${escapeHtml(changed)}${skipped}${warnings}
  `;
}

function renderUnitProfile(unit) {
  unitTitleEl.textContent = unit.name;
  unitSubtitleEl.textContent = `Фракция: ${unit.factionName}`;

  const rows = Object.entries(unit.raw)
    .filter(([, value]) => String(value ?? "").trim() !== "")
    .slice(0, 40)
    .map(([key, value]) => `<tr><td><strong>${escapeHtml(key)}</strong></td><td>${escapeHtml(value)}</td></tr>`)
    .join("");
  profileBodyEl.innerHTML = rows || "<tr><td colspan=\"2\" class=\"note\">Нет полей профиля</td></tr>";

  keywordsEl.innerHTML = unit.keywords.length
    ? unit.keywords.map((k) => `<span class=\"chip\">${escapeHtml(k)}</span>`).join("")
    : '<span class="note">Нет keywords</span>';

  const abilityRows = unit.abilities.slice(0, 200);
  if (!abilityRows.length) {
    abilitiesHeadEl.innerHTML = "<tr><th>Ability</th><th>Description</th></tr>";
    abilitiesBodyEl.innerHTML = '<tr><td colspan="2" class="note">Нет abilities</td></tr>';
    return;
  }

  const aNameKey = pickKey(abilityRows[0], ["ability", "name", "ability_name", "title"]);
  const aDescKey = pickKey(abilityRows[0], ["description", "desc", "text", "rule"]);

  abilitiesHeadEl.innerHTML = "<tr><th>Ability</th><th>Description</th></tr>";
  abilitiesBodyEl.innerHTML = abilityRows
    .map((row) => {
      const name = aNameKey ? row[aNameKey] : "";
      const desc = aDescKey ? row[aDescKey] : JSON.stringify(row);
      return `<tr><td>${escapeHtml(name || "-")}</td><td>${escapeHtml(desc || "-")}</td></tr>`;
    })
    .join("");
}

function getFilteredUnits() {
  const faction = factionSelectEl.value;
  const query = unitSearchEl.value.trim().toLowerCase();

  return catalog.units.filter((unit) => {
    if (faction !== "__all__" && unit.factionName !== faction) return false;
    if (!query) return true;
    return unit.name.toLowerCase().includes(query);
  });
}

function renderUnitList() {
  const units = getFilteredUnits();

  if (!units.length) {
    unitListEl.innerHTML = '<p class="note">Нет юнитов по текущему фильтру.</p>';
    currentUnitId = null;
    unitTitleEl.textContent = "Юнит не найден";
    unitSubtitleEl.textContent = "";
    profileBodyEl.innerHTML = '<tr><td colspan="2" class="note">Нет данных</td></tr>';
    keywordsEl.innerHTML = '<span class="note">Нет данных</span>';
    abilitiesHeadEl.innerHTML = "";
    abilitiesBodyEl.innerHTML = "";
    return;
  }

  if (!currentUnitId || !units.some((u) => u.id === currentUnitId)) {
    currentUnitId = units[0].id;
  }

  unitListEl.innerHTML = units
    .map((unit) => {
      const active = unit.id === currentUnitId ? "active" : "";
      return `<button class=\"unit-btn ${active}\" data-unit-id=\"${escapeHtml(unit.id)}\">${escapeHtml(unit.name)}</button>`;
    })
    .join("");

  const activeUnit = units.find((u) => u.id === currentUnitId);
  if (activeUnit) renderUnitProfile(activeUnit);

  for (const button of unitListEl.querySelectorAll(".unit-btn")) {
    button.addEventListener("click", () => {
      currentUnitId = button.dataset.unitId;
      renderUnitList();
    });
  }
}

function buildCatalog(datasets) {
  const factionsRows = datasets.get("Factions.csv")?.rows || [];
  const datasheetsRows = datasets.get("Datasheets.csv")?.rows || [];
  const keywordsRows = datasets.get("Datasheets_keywords.csv")?.rows || [];
  const abilitiesRows = datasets.get("Datasheets_abilities.csv")?.rows || [];

  const factionById = new Map();
  for (const row of factionsRows) {
    const id = firstNonEmpty(row, ["id", "faction_id", "ID"]);
    const name = firstNonEmpty(row, ["name", "faction", "title", "Name"]);
    if (id && name) factionById.set(id, name);
  }

  const units = [];
  const unitById = new Map();

  for (const row of datasheetsRows) {
    const id = firstNonEmpty(row, ["id", "datasheet_id", "ID"]);
    const name = firstNonEmpty(row, ["name", "datasheet_name", "title", "label", "Name"]);
    const factionId = firstNonEmpty(row, ["faction_id", "factionid", "faction"]);

    if (!id || !name) continue;

    const factionName = factionById.get(factionId) || factionId || "Unknown";
    const unit = {
      id,
      name,
      factionId,
      factionName,
      raw: row,
      keywords: [],
      abilities: [],
    };
    units.push(unit);
    unitById.set(id, unit);
  }

  for (const row of keywordsRows) {
    const dsId = firstNonEmpty(row, ["datasheet_id", "id", "sheet_id", "datasheet"]);
    const keyword = firstNonEmpty(row, ["keyword", "name", "value", "tag"]);
    if (!dsId || !keyword) continue;
    const unit = unitById.get(dsId);
    if (!unit) continue;
    if (!unit.keywords.includes(keyword)) unit.keywords.push(keyword);
  }

  for (const row of abilitiesRows) {
    const dsId = firstNonEmpty(row, ["datasheet_id", "id", "sheet_id", "datasheet"]);
    if (!dsId) continue;
    const unit = unitById.get(dsId);
    if (!unit) continue;
    unit.abilities.push(row);
  }

  for (const unit of units) {
    unit.keywords.sort((a, b) => a.localeCompare(b));
  }

  units.sort((a, b) => a.name.localeCompare(b.name));

  const factionNames = [...new Set(units.map((u) => u.factionName))].sort((a, b) =>
    a.localeCompare(b)
  );

  return { factions: factionNames, units };
}

function populateFactionSelect() {
  const options = ['<option value="__all__">Все фракции</option>'];
  for (const faction of catalog.factions) {
    options.push(`<option value="${escapeHtml(faction)}">${escapeHtml(faction)}</option>`);
  }
  factionSelectEl.innerHTML = options.join("");
}

async function loadIndexAndInit() {
  parserWarnings = [];

  const response = await fetch("./data/index.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Cannot load data index: ${response.status}`);
  }

  indexData = await response.json();
  const files = Object.keys(indexData.files || {});

  const missingRequired = REQUIRED_FILES.filter((file) => !files.includes(file));
  if (missingRequired.length) {
    throw new Error(`Не хватает обязательных CSV: ${missingRequired.join(", ")}`);
  }

  const datasets = new Map();
  for (const file of REQUIRED_FILES) {
    const parsed = await loadCsv(file);
    datasets.set(file, parsed);
  }

  catalog = buildCatalog(datasets);
  if (!catalog.units.length) {
    throw new Error("Не удалось собрать каталог юнитов из CSV");
  }

  populateFactionSelect();
  renderMeta();
  renderUnitList();
}

factionSelectEl.addEventListener("change", renderUnitList);
unitSearchEl.addEventListener("input", renderUnitList);

reloadBtn.addEventListener("click", () => {
  loadIndexAndInit().catch((error) => {
    metaEl.textContent = `Ошибка обновления: ${error.message}`;
  });
});

loadIndexAndInit().catch((error) => {
  metaEl.textContent = `Ошибка инициализации: ${error.message}`;
});
