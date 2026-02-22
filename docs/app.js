const metaEl = document.querySelector("#meta");
const factionSelectEl = document.querySelector("#faction-select");
const unitSearchEl = document.querySelector("#unit-search");
const reloadBtn = document.querySelector("#reload-button");
const unitListEl = document.querySelector("#unit-list");
const unitTitleEl = document.querySelector("#unit-title");
const unitMetaEl = document.querySelector("#unit-meta");
const roleBadgeEl = document.querySelector("#role-badge");
const statlineEl = document.querySelector("#statline");
const rangedHeadEl = document.querySelector("#ranged-table thead");
const rangedBodyEl = document.querySelector("#ranged-table tbody");
const meleeHeadEl = document.querySelector("#melee-table thead");
const meleeBodyEl = document.querySelector("#melee-table tbody");
const abilitiesListEl = document.querySelector("#abilities-list");
const keywordsEl = document.querySelector("#keywords");
const compositionEl = document.querySelector("#composition");
const tooltipEl = document.createElement("div");

const REQUIRED_FILES = [
  "Factions.csv",
  "Datasheets.csv",
  "Datasheets_models.csv",
  "Datasheets_wargear.csv",
  "Datasheets_keywords.csv",
  "Datasheets_abilities.csv",
  "Abilities.csv",
];

let indexData = null;
let parserWarnings = [];
let catalog = { factions: [], units: [] };
let currentUnitId = null;
let tooltipVisible = false;

tooltipEl.className = "keyword-tooltip";
tooltipEl.innerHTML = '<div class="keyword-tooltip-title"></div><div class="keyword-tooltip-body"></div>';
document.body.appendChild(tooltipEl);

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

function stripHtml(value) {
  const raw = String(value || "");
  return raw
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<li>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function normalized(text) {
  return String(text || "")
    .replace(/^\uFEFF/, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function pickKey(row, candidates) {
  const keys = Object.keys(row || {});
  const normalizedMap = new Map(keys.map((key) => [normalized(key), key]));
  for (const candidate of candidates) {
    const match = normalizedMap.get(normalized(candidate));
    if (match) return match;
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
    transformHeader: (header) => String(header || "").replace(/^\uFEFF/, "").trim(),
  });
}

function parseCsvSmart(text, fileName) {
  const delimiters = ["|", ";", ",", "\t"];
  const attempts = delimiters.map((delimiter) => {
    const parsed = parseCsvWithDelimiter(text, delimiter);
    const fields = parsed.meta.fields ?? [];
    const severeErrors = parsed.errors.filter((error) => error.type !== "FieldMismatch").length;
    const mismatchErrors = parsed.errors.filter((error) => error.type === "FieldMismatch").length;
    const score = fields.length * 10000 + parsed.data.length - severeErrors * 100000 - mismatchErrors;
    return { delimiter, parsed, fields, severeErrors, mismatchErrors, score };
  });

  attempts.sort((a, b) => b.score - a.score);
  const best = attempts[0];

  if (!best || best.severeErrors > 0 || !best.fields.length) {
    const reason = best?.parsed?.errors?.[0]?.message || "Cannot parse csv";
    throw new Error(`${fileName}: ${reason}`);
  }

  if (best.mismatchErrors > 0) {
    parserWarnings.push(`${fileName}: ${best.mismatchErrors} строк(и) с нестандартным числом полей`);
  }

  const rows = best.parsed.data
    .map((row) => {
      const copy = {};
      for (const [key, value] of Object.entries(row)) {
        if (key === "__parsed_extra") continue;
        copy[String(key || "").replace(/^\uFEFF/, "").trim()] = String(value ?? "").trim();
      }
      return copy;
    })
    .filter((row) => Object.values(row).some((value) => value !== ""));

  return { rows, fields: best.fields };
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
    ? `<br><strong>Пропущены (404):</strong> ${escapeHtml(indexData.skipped_missing_files.join(", "))}`
    : "";
  const warnings = parserWarnings.length
    ? `<br><strong>Предупреждения парсинга:</strong> ${escapeHtml(parserWarnings.join(" | "))}`
    : "";

  metaEl.innerHTML = `<strong>Источник:</strong> ${escapeHtml(indexData.source || "Wahapedia")}
    <br><strong>Обновлено:</strong> ${escapeHtml(formatUtc(indexData.updated_at_utc))}
    <br><strong>Изменения:</strong> ${escapeHtml(changed)}${skipped}${warnings}`;
}

function parseWeaponTags(description) {
  const clean = stripHtml(description);
  if (!clean) return [];
  return clean
    .split(/[\n,]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function renderWeaponTable(type, weapons) {
  const head = type === "Ranged" ? rangedHeadEl : meleeHeadEl;
  const body = type === "Ranged" ? rangedBodyEl : meleeBodyEl;

  head.innerHTML = `
    <tr>
      <th>Weapon</th>
      <th>Range</th>
      <th>A</th>
      <th>${type === "Ranged" ? "BS" : "WS"}</th>
      <th>S</th>
      <th>AP</th>
      <th>D</th>
    </tr>`;

  if (!weapons.length) {
    body.innerHTML = '<tr><td colspan="7" class="note">Нет данных</td></tr>';
    return;
  }

  body.innerHTML = weapons
    .slice(0, 60)
    .map((weapon) => {
      const tags = parseWeaponTags(weapon.description);
      const tagsHtml = tags.length
        ? `<div class="tag-list">${tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
        : "";

      return `<tr>
        <td>${escapeHtml(weapon.name || "-")}${tagsHtml}</td>
        <td>${escapeHtml(weapon.range || "-")}</td>
        <td>${escapeHtml(weapon.A || "-")}</td>
        <td>${escapeHtml(weapon.BS_WS || "-")}</td>
        <td>${escapeHtml(weapon.S || "-")}</td>
        <td>${escapeHtml(weapon.AP || "-")}</td>
        <td>${escapeHtml(weapon.D || "-")}</td>
      </tr>`;
    })
    .join("");
}

function renderAbilities(abilities) {
  if (!abilities.length) {
    abilitiesListEl.innerHTML = '<p class="note">Нет данных</p>';
    return;
  }

  const grouped = new Map();
  for (const ability of abilities.slice(0, 160)) {
    const type = (ability.type || "Datasheet").toUpperCase();
    if (!grouped.has(type)) grouped.set(type, []);
    grouped.get(type).push(ability);
  }

  abilitiesListEl.innerHTML = [...grouped.entries()]
    .map(([type, list]) => {
      const chips = list
        .map((ability) => {
          const title = ability.name || "Unnamed ability";
          const desc = stripHtml(ability.description || "");
          const hasDesc = Boolean(desc);
          const cls = hasDesc ? "kw-link" : "kw-link disabled";
          const body = hasDesc ? desc : "Описание отсутствует в источнике.";
          return `<button
            type="button"
            class="${cls}"
            data-tip-title="${escapeHtml(title)}"
            data-tip-body="${escapeHtml(body)}"
          >${escapeHtml(title)}</button>`;
        })
        .join("");

      return `<div class="ability">
        <div class="ability-top">${escapeHtml(type)}</div>
        <div class="ability-keywords">${chips}</div>
      </div>`;
    })
    .join("");
}

function renderKeywords(keywords) {
  if (!keywords.length) {
    keywordsEl.innerHTML = '<span class="note">Нет keywords</span>';
    return;
  }

  keywordsEl.innerHTML = keywords
    .slice(0, 80)
    .map((keyword) => `<span class="chip">${escapeHtml(keyword)}</span>`)
    .join("");
}

function renderComposition(unit) {
  const chunks = [];
  if (unit.loadout) {
    chunks.push(`<p><strong>Loadout:</strong><br>${escapeHtml(stripHtml(unit.loadout))}</p>`);
  }
  if (unit.legend) {
    chunks.push(`<p><strong>Legend:</strong><br>${escapeHtml(stripHtml(unit.legend))}</p>`);
  }
  if (unit.damaged_description) {
    chunks.push(`<p><strong>Damaged:</strong><br>${escapeHtml(stripHtml(unit.damaged_description))}</p>`);
  }
  if (!chunks.length) {
    chunks.push('<p class="note">Нет дополнительных описаний</p>');
  }

  compositionEl.innerHTML = chunks.join("");
}

function renderStatline(unit) {
  const stats = [
    ["M", unit.stats.M],
    ["T", unit.stats.T],
    ["Sv", unit.stats.Sv],
    ["W", unit.stats.W],
    ["Ld", unit.stats.Ld],
    ["OC", unit.stats.OC],
  ];

  const html = stats
    .map(([k, v]) => `<div class="stat"><div class="k">${escapeHtml(k)}</div><div class="v">${escapeHtml(v || "-")}</div></div>`)
    .join("");

  const invuln = unit.stats.inv_sv
    ? `<div class="stat invuln"><div class="k">Inv</div><div class="v">${escapeHtml(unit.stats.inv_sv)}</div></div>`
    : "";

  statlineEl.innerHTML = html + invuln;
}

function renderUnit(unit) {
  unitTitleEl.textContent = unit.name || "Unknown unit";
  unitMetaEl.textContent = `${unit.factionName} • ${unit.baseSize || "base n/a"}`;
  roleBadgeEl.textContent = unit.role || "Role n/a";

  renderStatline(unit);
  renderWeaponTable("Ranged", unit.weapons.ranged);
  renderWeaponTable("Melee", unit.weapons.melee);
  renderAbilities(unit.abilities);
  renderKeywords(unit.keywords);
  renderComposition(unit);
}

function showTooltip(target, x, y) {
  if (!target) return;
  const title = target.dataset.tipTitle || "";
  const body = target.dataset.tipBody || "";
  if (!title && !body) return;

  tooltipEl.querySelector(".keyword-tooltip-title").textContent = title;
  tooltipEl.querySelector(".keyword-tooltip-body").textContent = body;
  tooltipEl.classList.add("visible");
  tooltipVisible = true;
  moveTooltip(x, y);
}

function hideTooltip() {
  tooltipEl.classList.remove("visible");
  tooltipVisible = false;
}

function moveTooltip(x, y) {
  if (!tooltipVisible) return;
  const margin = 14;
  const width = tooltipEl.offsetWidth || 320;
  const height = tooltipEl.offsetHeight || 120;

  let left = x + margin;
  let top = y + margin;

  if (left + width > window.innerWidth - 8) left = x - width - margin;
  if (top + height > window.innerHeight - 8) top = y - height - margin;

  tooltipEl.style.left = `${Math.max(8, left)}px`;
  tooltipEl.style.top = `${Math.max(8, top)}px`;
}

function initTooltipHandlers() {
  document.addEventListener("mouseover", (event) => {
    const target = event.target.closest(".kw-link");
    if (!target || target.classList.contains("disabled")) return;
    showTooltip(target, event.clientX, event.clientY);
  });

  document.addEventListener("mouseout", (event) => {
    const from = event.target.closest(".kw-link");
    const to = event.relatedTarget?.closest?.(".kw-link");
    if (from && !to) hideTooltip();
  });

  document.addEventListener("mousemove", (event) => {
    if (tooltipVisible) moveTooltip(event.clientX, event.clientY);
  });

  document.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("blur", hideTooltip);
}

function getFilteredUnits() {
  const faction = factionSelectEl.value;
  const query = unitSearchEl.value.trim().toLowerCase();

  return catalog.units.filter((unit) => {
    if (faction && faction !== "__all__" && unit.factionName !== faction) return false;
    if (!query) return true;
    return unit.name.toLowerCase().includes(query);
  });
}

function renderUnitList() {
  const units = getFilteredUnits();

  if (!units.length) {
    unitListEl.innerHTML = '<p class="note">Нет юнитов по фильтру.</p>';
    return;
  }

  if (!currentUnitId || !units.some((unit) => unit.id === currentUnitId)) {
    currentUnitId = units[0].id;
  }

  unitListEl.innerHTML = units
    .map((unit) => {
      const active = unit.id === currentUnitId ? "active" : "";
      return `<button class="unit-btn ${active}" data-unit-id="${escapeHtml(unit.id)}">${escapeHtml(unit.name)}</button>`;
    })
    .join("");

  for (const button of unitListEl.querySelectorAll(".unit-btn")) {
    button.addEventListener("click", () => {
      currentUnitId = button.dataset.unitId;
      renderUnitList();
    });
  }

  const selected = units.find((unit) => unit.id === currentUnitId);
  if (selected) renderUnit(selected);
}

function chooseAbilityDefinition(abilityDefs, abilityId, factionId) {
  const list = abilityDefs.get(abilityId);
  if (!list || !list.length) return null;

  const sameFaction = list.find((item) => item.faction_id === factionId);
  if (sameFaction) return sameFaction;

  const common = list.find((item) => !item.faction_id);
  if (common) return common;

  return list[0];
}

function buildCatalog(datasets) {
  const factionsRows = datasets.get("Factions.csv")?.rows || [];
  const datasheetsRows = datasets.get("Datasheets.csv")?.rows || [];
  const modelsRows = datasets.get("Datasheets_models.csv")?.rows || [];
  const wargearRows = datasets.get("Datasheets_wargear.csv")?.rows || [];
  const keywordsRows = datasets.get("Datasheets_keywords.csv")?.rows || [];
  const datasheetAbilitiesRows = datasets.get("Datasheets_abilities.csv")?.rows || [];
  const abilityRows = datasets.get("Abilities.csv")?.rows || [];

  const factionById = new Map();
  for (const row of factionsRows) {
    const id = firstNonEmpty(row, ["id"]);
    const name = firstNonEmpty(row, ["name"]);
    if (id && name) factionById.set(id, name);
  }

  const modelsByDsId = new Map();
  for (const row of modelsRows) {
    const dsId = firstNonEmpty(row, ["datasheet_id"]);
    if (!dsId) continue;
    if (!modelsByDsId.has(dsId)) modelsByDsId.set(dsId, []);
    modelsByDsId.get(dsId).push(row);
  }

  for (const [dsId, lines] of modelsByDsId.entries()) {
    lines.sort((a, b) => Number(firstNonEmpty(a, ["line"]) || "0") - Number(firstNonEmpty(b, ["line"]) || "0"));
    modelsByDsId.set(dsId, lines);
  }

  const wargearByDsId = new Map();
  for (const row of wargearRows) {
    const dsId = firstNonEmpty(row, ["datasheet_id"]);
    if (!dsId) continue;
    if (!wargearByDsId.has(dsId)) wargearByDsId.set(dsId, []);
    wargearByDsId.get(dsId).push(row);
  }

  const keywordsByDsId = new Map();
  for (const row of keywordsRows) {
    const dsId = firstNonEmpty(row, ["datasheet_id"]);
    const keyword = firstNonEmpty(row, ["keyword"]);
    if (!dsId || !keyword) continue;
    if (!keywordsByDsId.has(dsId)) keywordsByDsId.set(dsId, []);
    keywordsByDsId.get(dsId).push(keyword);
  }

  const abilityDefs = new Map();
  for (const row of abilityRows) {
    const id = firstNonEmpty(row, ["id"]);
    if (!id) continue;
    if (!abilityDefs.has(id)) abilityDefs.set(id, []);
    abilityDefs.get(id).push({
      id,
      name: firstNonEmpty(row, ["name"]),
      legend: firstNonEmpty(row, ["legend"]),
      faction_id: firstNonEmpty(row, ["faction_id"]),
      description: firstNonEmpty(row, ["description"]),
    });
  }

  const abilitiesByDsId = new Map();
  for (const row of datasheetAbilitiesRows) {
    const dsId = firstNonEmpty(row, ["datasheet_id"]);
    if (!dsId) continue;
    if (!abilitiesByDsId.has(dsId)) abilitiesByDsId.set(dsId, []);
    abilitiesByDsId.get(dsId).push(row);
  }

  const units = [];

  for (const row of datasheetsRows) {
    const id = firstNonEmpty(row, ["id"]);
    const name = firstNonEmpty(row, ["name"]);
    const factionId = firstNonEmpty(row, ["faction_id"]);
    if (!id || !name) continue;

    const modelLines = modelsByDsId.get(id) || [];
    const primaryModel = modelLines[0] || {};

    const weapons = (wargearByDsId.get(id) || []).map((item) => ({
      name: firstNonEmpty(item, ["name"]),
      type: firstNonEmpty(item, ["type"]),
      description: firstNonEmpty(item, ["description"]),
      range: firstNonEmpty(item, ["range"]),
      A: firstNonEmpty(item, ["A"]),
      BS_WS: firstNonEmpty(item, ["BS_WS"]),
      S: firstNonEmpty(item, ["S"]),
      AP: firstNonEmpty(item, ["AP"]),
      D: firstNonEmpty(item, ["D"]),
    }));

    const ranged = weapons.filter((weapon) => weapon.type.toLowerCase() === "ranged");
    const melee = weapons.filter((weapon) => weapon.type.toLowerCase() === "melee");

    const resolvedAbilities = (abilitiesByDsId.get(id) || []).map((item) => {
      const abilityId = firstNonEmpty(item, ["ability_id"]);
      const inlineName = firstNonEmpty(item, ["name"]);
      const inlineDescription = firstNonEmpty(item, ["description"]);
      const type = firstNonEmpty(item, ["type"]);
      const def = abilityId ? chooseAbilityDefinition(abilityDefs, abilityId, factionId) : null;

      return {
        type: type || "Datasheet",
        name: inlineName || def?.name || "",
        description: inlineDescription || def?.description || def?.legend || "",
      };
    });

    const keywords = [...new Set((keywordsByDsId.get(id) || []).map((k) => k.trim()).filter(Boolean))].sort((a, b) =>
      a.localeCompare(b)
    );

    const unit = {
      id,
      name,
      factionId,
      factionName: factionById.get(factionId) || factionId || "Unknown",
      role: firstNonEmpty(row, ["role"]),
      baseSize: firstNonEmpty(primaryModel, ["base_size", "base_size_descr"]),
      legend: firstNonEmpty(row, ["legend"]),
      loadout: firstNonEmpty(row, ["loadout"]),
      damaged_description: firstNonEmpty(row, ["damaged_description"]),
      link: firstNonEmpty(row, ["link"]),
      stats: {
        M: firstNonEmpty(primaryModel, ["M"]),
        T: firstNonEmpty(primaryModel, ["T"]),
        Sv: firstNonEmpty(primaryModel, ["Sv"]),
        inv_sv: firstNonEmpty(primaryModel, ["inv_sv"]),
        W: firstNonEmpty(primaryModel, ["W"]),
        Ld: firstNonEmpty(primaryModel, ["Ld"]),
        OC: firstNonEmpty(primaryModel, ["OC"]),
      },
      weapons: {
        ranged,
        melee,
      },
      abilities: resolvedAbilities.filter((ability) => ability.name || ability.description),
      keywords,
    };

    units.push(unit);
  }

  units.sort((a, b) => a.name.localeCompare(b.name));

  const factions = [...new Set(units.map((unit) => unit.factionName))].sort((a, b) => a.localeCompare(b));
  return { factions, units };
}

function populateFactionSelect() {
  factionSelectEl.innerHTML = [
    '<option value="__all__">Все фракции</option>',
    ...catalog.factions.map((faction) => `<option value="${escapeHtml(faction)}">${escapeHtml(faction)}</option>`),
  ].join("");
}

async function loadIndexAndInit() {
  parserWarnings = [];

  const response = await fetch("./data/index.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Cannot load data index: ${response.status}`);
  }

  indexData = await response.json();
  const files = Object.keys(indexData.files || {});

  const missingFiles = REQUIRED_FILES.filter((file) => !files.includes(file));
  if (missingFiles.length) {
    throw new Error(`Не хватает CSV: ${missingFiles.join(", ")}`);
  }

  const datasets = new Map();
  for (const file of REQUIRED_FILES) {
    const parsed = await loadCsv(file);
    datasets.set(file, parsed);
  }

  catalog = buildCatalog(datasets);
  if (!catalog.units.length) {
    throw new Error("Не удалось собрать каталог юнитов");
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

initTooltipHandlers();

loadIndexAndInit().catch((error) => {
  metaEl.textContent = `Ошибка инициализации: ${error.message}`;
});
