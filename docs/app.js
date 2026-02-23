const metaEl = document.querySelector("#meta");
const factionSelectEl = document.querySelector("#faction-select");
const unitSearchEl = document.querySelector("#unit-search");
const reloadBtn = document.querySelector("#reload-button");
const unitListEl = document.querySelector("#unit-list");
const unitTitleEl = document.querySelector("#unit-title");
const unitMetaEl = document.querySelector("#unit-meta");
const roleBadgeEl = document.querySelector("#role-badge");
const statlineEl = document.querySelector("#statline");
const rangedBlockEl = document.querySelector("#ranged-block");
const meleeBlockEl = document.querySelector("#melee-block");
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
let coreRuleDefsByName = new Map();

tooltipEl.className = "keyword-tooltip";
tooltipEl.innerHTML = `
  <div class="keyword-tooltip-title"></div>
  <div class="keyword-tooltip-intro"></div>
  <div class="keyword-tooltip-body"></div>
  <ul class="keyword-tooltip-points"></ul>
`;
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

function isMeaningfulValue(value) {
  const v = String(value ?? "").trim();
  if (!v) return false;
  const low = v.toLowerCase();
  return v !== "-" && v !== "—" && v !== "–" && low !== "n/a" && low !== "na" && low !== "none";
}

function hasWeaponData(weapon) {
  return (
    isMeaningfulValue(weapon.name) ||
    isMeaningfulValue(weapon.range) ||
    isMeaningfulValue(weapon.A) ||
    isMeaningfulValue(weapon.BS_WS) ||
    isMeaningfulValue(weapon.S) ||
    isMeaningfulValue(weapon.AP) ||
    isMeaningfulValue(weapon.D)
  );
}

function normalizeRuleName(text) {
  return normalized(String(text || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim());
}

function simplifyRuleName(text) {
  return String(text || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+\d+\+?$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function chooseByFaction(definitions, factionId) {
  if (!definitions || !definitions.length) return null;
  const sameFaction = definitions.find((item) => item.faction_id === factionId);
  if (sameFaction) return sameFaction;
  const common = definitions.find((item) => !item.faction_id);
  if (common) return common;
  return definitions[0];
}

function buildTooltipPayload(title, legend, description) {
  const intro = stripHtml(legend || "");
  const source = stripHtml(description || "");
  const lines = source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const points = [];
  const paragraphs = [];
  for (const line of lines) {
    if (line.startsWith("- ")) {
      points.push(line.slice(2).trim());
    } else {
      paragraphs.push(line);
    }
  }

  return {
    title: title || "",
    intro,
    body: paragraphs.join("\n\n"),
    points,
  };
}

function buildTooltipFromCoreSection(section) {
  const title = String(section?.title || "").trim();
  const blocks = Array.isArray(section?.blocks) ? section.blocks : [];
  let intro = "";
  const bodyParagraphs = [];
  const points = [];

  for (const block of blocks) {
    const text = String(block?.text || "").trim();
    if (!text) continue;

    if (block.type === "bullet") {
      points.push(text.replace(/^[-\u2022]\s*/, "").trim());
      continue;
    }

    if (!intro) {
      intro = text;
    } else {
      bodyParagraphs.push(text);
    }
  }

  return {
    title,
    intro,
    body: bodyParagraphs.join("\n\n"),
    points,
  };
}

function buildCoreRuleIndex(coreRulesPayload) {
  const index = new Map();
  const sections = Array.isArray(coreRulesPayload?.sections) ? coreRulesPayload.sections : [];

  for (const section of sections) {
    const title = String(section?.title || "").trim();
    if (!title) continue;
    const tip = buildTooltipFromCoreSection(section);
    if (!tip.intro && !tip.body && !tip.points.length) continue;

    const k1 = normalizeRuleName(title);
    if (k1) index.set(k1, tip);

    const k2 = normalizeRuleName(simplifyRuleName(title));
    if (k2) index.set(k2, tip);
  }

  return index;
}

function renderWeaponTable(type, weapons) {
  const head = type === "Ranged" ? rangedHeadEl : meleeHeadEl;
  const body = type === "Ranged" ? rangedBodyEl : meleeBodyEl;
  const rows = (weapons || []).filter(hasWeaponData);

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

  if (!rows.length) {
    head.innerHTML = "";
    body.innerHTML = "";
    return false;
  }

  body.innerHTML = rows
    .slice(0, 60)
    .map((weapon) => {
      const tags = weapon.ruleTags || [];
      const tagsHtml = tags.length
        ? `<div class="tag-list">${tags
            .map((tag) => {
              const hasTip = Boolean(tag.tooltip);
              const cls = hasTip ? "kw-link weapon-rule" : "kw-link weapon-rule disabled";
              const tip = hasTip
                ? tag.tooltip
                : { title: tag.label || "", intro: "", body: "Описание правила не найдено в источнике.", points: [] };
              return `<button
                type="button"
                class="${cls}"
                data-tip-title="${escapeHtml(tip.title || tag.label || "")}"
                data-tip-intro="${escapeHtml(tip.intro || "")}"
                data-tip-body="${escapeHtml(tip.body || "")}"
                data-tip-points="${escapeHtml((tip.points || []).join("||"))}"
              >${escapeHtml(tag.label || "")}</button>`;
            })
            .join("")}</div>`
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

  return true;
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
          const tip = buildTooltipPayload(title, ability.legend || "", ability.description || "");
          const hasDesc = Boolean(tip.intro || tip.body || (tip.points && tip.points.length));
          const cls = hasDesc ? "kw-link" : "kw-link disabled";
          const fallback = hasDesc
            ? tip
            : { title, intro: "", body: "Описание отсутствует в источнике.", points: [] };
          return `<button
            type="button"
            class="${cls}"
            data-tip-title="${escapeHtml(fallback.title || title)}"
            data-tip-intro="${escapeHtml(fallback.intro || "")}"
            data-tip-body="${escapeHtml(fallback.body || "")}"
            data-tip-points="${escapeHtml((fallback.points || []).join("||"))}"
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

  const invuln = isMeaningfulValue(unit.stats.inv_sv)
    ? `<div class="stat invuln"><div class="k">Inv</div><div class="v">${escapeHtml(unit.stats.inv_sv)}</div></div>`
    : "";

  statlineEl.innerHTML = html + invuln;
}

function renderUnit(unit) {
  unitTitleEl.textContent = unit.name || "Unknown unit";
  unitMetaEl.textContent = `${unit.factionName} • ${unit.baseSize || "base n/a"}`;
  roleBadgeEl.textContent = unit.role || "Role n/a";

  renderStatline(unit);
  const hasRanged = renderWeaponTable("Ranged", unit.weapons.ranged);
  const hasMelee = renderWeaponTable("Melee", unit.weapons.melee);
  rangedBlockEl.style.display = hasRanged ? "" : "none";
  meleeBlockEl.style.display = hasMelee ? "" : "none";
  renderAbilities(unit.abilities);
  renderKeywords(unit.keywords);
  renderComposition(unit);
}

function showTooltip(target, x, y) {
  if (!target) return;
  const title = target.dataset.tipTitle || "";
  const intro = target.dataset.tipIntro || "";
  const body = target.dataset.tipBody || "";
  const points = (target.dataset.tipPoints || "")
    .split("||")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!title && !intro && !body && !points.length) return;

  tooltipEl.querySelector(".keyword-tooltip-title").textContent = title;
  const introEl = tooltipEl.querySelector(".keyword-tooltip-intro");
  introEl.textContent = intro;
  introEl.style.display = intro ? "block" : "none";

  const bodyEl = tooltipEl.querySelector(".keyword-tooltip-body");
  bodyEl.textContent = body;
  bodyEl.style.display = body ? "block" : "none";

  const pointsEl = tooltipEl.querySelector(".keyword-tooltip-points");
  if (points.length) {
    pointsEl.innerHTML = points.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    pointsEl.style.display = "block";
  } else {
    pointsEl.innerHTML = "";
    pointsEl.style.display = "none";
  }

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
  const abilityDefsByName = new Map();
  for (const row of abilityRows) {
    const id = firstNonEmpty(row, ["id"]);
    const name = firstNonEmpty(row, ["name"]);
    const entry = {
      id,
      name,
      legend: firstNonEmpty(row, ["legend"]),
      faction_id: firstNonEmpty(row, ["faction_id"]),
      description: firstNonEmpty(row, ["description"]),
    };

    if (!id) continue;
    if (!abilityDefs.has(id)) abilityDefs.set(id, []);
    abilityDefs.get(id).push(entry);

    const k1 = normalizeRuleName(name);
    if (k1) {
      if (!abilityDefsByName.has(k1)) abilityDefsByName.set(k1, []);
      abilityDefsByName.get(k1).push(entry);
    }
    const k2 = normalizeRuleName(simplifyRuleName(name));
    if (k2 && k2 !== k1) {
      if (!abilityDefsByName.has(k2)) abilityDefsByName.set(k2, []);
      abilityDefsByName.get(k2).push(entry);
    }
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

    const weapons = (wargearByDsId.get(id) || []).map((item) => {
      const description = firstNonEmpty(item, ["description"]);
      const ruleTags = parseWeaponTags(description).map((label) => {
        const exactKey = normalizeRuleName(label);
        const simpleKey = normalizeRuleName(simplifyRuleName(label));
        const coreTip = coreRuleDefsByName.get(exactKey) || coreRuleDefsByName.get(simpleKey) || null;
        const found = chooseByFaction(
          abilityDefsByName.get(exactKey) || abilityDefsByName.get(simpleKey) || [],
          factionId
        );
        return {
          label,
          tooltip: coreTip
            ? coreTip
            : found
            ? buildTooltipPayload(label, found.legend || "", found.description || "")
            : null,
        };
      });

      return {
        name: firstNonEmpty(item, ["name"]),
        type: firstNonEmpty(item, ["type"]),
        description,
        range: firstNonEmpty(item, ["range"]),
        A: firstNonEmpty(item, ["A"]),
        BS_WS: firstNonEmpty(item, ["BS_WS"]),
        S: firstNonEmpty(item, ["S"]),
        AP: firstNonEmpty(item, ["AP"]),
        D: firstNonEmpty(item, ["D"]),
        ruleTags,
      };
    });

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
        legend: def?.legend || "",
        description: inlineDescription || def?.description || "",
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

  coreRuleDefsByName = new Map();
  if (files.includes("core_rules.json")) {
    try {
      const coreRulesResponse = await fetch("./data/core_rules.json", { cache: "no-store" });
      if (coreRulesResponse.ok) {
        const coreRulesPayload = await coreRulesResponse.json();
        coreRuleDefsByName = buildCoreRuleIndex(coreRulesPayload);
      }
    } catch {
      coreRuleDefsByName = new Map();
    }
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
