const metaEl = document.querySelector("#meta");
const factionSelectEl = document.querySelector("#faction-select");
const detachmentSelectEl = document.querySelector("#detachment-select");
const unitSearchEl = document.querySelector("#unit-search");
const themeToggleEl = document.querySelector("#theme-toggle");
const showLegendsToggleEl = document.querySelector("#show-legends-toggle");
const unitListEl = document.querySelector("#unit-list");
const keywordFilterIndicatorEl = document.querySelector("#keyword-filter-indicator");
const unitTitleEl = document.querySelector("#unit-title");
const unitPhotoBtnEl = document.querySelector("#unit-photo-btn");
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
const unitCostEl = document.querySelector("#unit-cost");
const compositionEl = document.querySelector("#composition");
const detachmentContentEl = document.querySelector("#detachment-content");
const scrollTopBtnEl = document.querySelector("#scroll-top-btn");
const tooltipEl = document.createElement("div");
const imagePreviewEl = document.createElement("div");

const REQUIRED_FILES = [
  "Factions.csv",
  "Datasheets.csv",
  "Datasheets_models.csv",
  "Datasheets_wargear.csv",
  "Datasheets_keywords.csv",
  "Datasheets_abilities.csv",
  "Datasheets_stratagems.csv",
  "Datasheets_enhancements.csv",
  "Abilities.csv",
  "Stratagems.csv",
  "Enhancements.csv",
  "Detachment_abilities.csv",
  "Source.csv",
];

const OPTIONAL_FILES = ["Datasheets_models_cost.csv"];

let indexData = null;
let parserWarnings = [];
let catalog = { factions: [], units: [], detachmentsByFaction: new Map() };
let currentUnitId = null;
let tooltipVisible = false;
let tooltipAnchorEl = null;
let suppressTooltipClickUntil = 0;
let coreRuleDefsByName = new Map();
let unitImageEntriesById = new Map();
let unitImageEntriesByKey = new Map();
let imagePreviewVisible = false;
let imagePreviewAnchorEl = null;
let activeKeywordFilter = "";
let showLegends = false;

const CANONICAL_CORE_TOOLTIPS = [
  {
    title: "ASSAULT",
    intro: "Assault weapons fire so indiscriminately that they can be shot from the hip as warriors dash forward.",
    body:
      "Weapons with [ASSAULT] in their profile are known as Assault weapons. If a unit that Advanced this turn contains models equipped with Assault weapons, it is still eligible to shoot in this turn's Shooting phase, but can only resolve attacks using Assault weapons.",
    points: ["Can be shot even if the bearer's unit Advanced."],
  },
  {
    title: "PISTOL",
    intro: "Pistols can be wielded even at point-blank range.",
    body:
      "Weapons with [PISTOL] in their profile are known as Pistols. Units with Pistols can shoot in their controlling player's Shooting phase while within Engagement Range, but can only target one enemy unit they are within Engagement Range of. Unless a model is a MONSTER or VEHICLE, it can shoot with its Pistols or all of its other ranged weapons, not both.",
    points: [
      "Can be shot even if the bearer's unit is within Engagement Range of enemy units, but must target one of those enemy units.",
      "Cannot be shot alongside any other non-Pistol weapon (except by a MONSTER or VEHICLE).",
    ],
  },
  {
    title: "RAPID FIRE",
    intro: "Rapid fire weapons are capable of long-ranged precision shots or controlled bursts at nearby targets.",
    body:
      "Weapons with [RAPID FIRE X] in their profile are known as Rapid Fire weapons. Each time such a weapon targets a unit within half range, increase that weapon's Attacks characteristic by X.",
    points: ["[RAPID FIRE X]: Increase the Attacks by X when targeting units within half range."],
  },
  {
    title: "IGNORES COVER",
    intro: "Some weapons are designed to root enemy formations out of entrenched positions.",
    body:
      "Weapons with [IGNORES COVER] in their profile are known as Ignores Cover weapons. Each time an attack is made with such a weapon, the target cannot have the Benefit of Cover against that attack (pg 44).",
    points: [],
  },
  {
    title: "TWIN-LINKED",
    intro: "Dual weapons are often grafted to the same targeting system for greater lethality.",
    body:
      "Weapons with [TWIN-LINKED] in their profile are known as Twin-linked weapons. Each time an attack is made with such a weapon, you can re-roll that attack's Wound roll.",
    points: [],
  },
  {
    title: "TORRENT",
    intro: "Torrent weapons shoot clouds of fire, gas or other lethal substances that few foes can hope to evade.",
    body:
      "Weapons with [TORRENT] in their profile are known as Torrent weapons. Each time an attack is made with such a weapon, that attack automatically hits the target.",
    points: [],
  },
  {
    title: "LETHAL HITS",
    intro: "Some weapons can inflict fatal injuries on any foe, no matter their resilience.",
    body:
      "Weapons with [LETHAL HITS] in their profile are known as Lethal Hits weapons. Each time an attack is made with such a weapon, a Critical Hit automatically wounds the target.",
    points: [],
  },
  {
    title: "LANCE",
    intro: "Lance weapons are deadly on the charge.",
    body:
      "Weapons with [LANCE] in their profile are known as Lance weapons. Each time an attack is made with such a weapon, if the bearer made a Charge move this turn, add 1 to that attack's Wound roll.",
    points: [],
  },
  {
    title: "INDIRECT FIRE",
    intro: "Indirect fire weapons launch munitions over or around intervening obstacles.",
    body:
      "Weapons with [INDIRECT FIRE] in their profile are known as Indirect Fire weapons and can target units not visible to the attacker. If no models in the target unit are visible when selected, attacks made with Indirect Fire are at -1 to Hit and the target has the Benefit of Cover.",
    points: [
      "Can target units that are not visible to the attacking unit.",
      "If no models are visible, attacks are at -1 to Hit and the target has Benefit of Cover.",
    ],
  },
  {
    title: "PRECISION",
    intro: "Precision attacks can pick high-value targets out in a crowd.",
    body:
      "Weapons with [PRECISION] in their profile are known as Precision weapons. Each time an attack made with such a weapon successfully wounds an Attached unit, if a CHARACTER model in that unit is visible to the attacker, the attacking player can allocate that attack to that CHARACTER model.",
    points: ["Can allocate attacks to a visible CHARACTER model in an Attached unit."],
  },
  {
    title: "BLAST",
    intro: "High-explosive weapons can fell several warriors in a single detonation.",
    body:
      "Weapons with [BLAST] in their profile are known as Blast weapons. Add 1 to their Attacks characteristic for every five models in the target unit (rounding down). Blast weapons can never target units within Engagement Range of one or more units from the attacking model's army.",
    points: [
      "Add 1 Attack for every five models in the target unit (rounding down).",
      "Cannot target units within Engagement Range of the attacker's army.",
    ],
  },
  {
    title: "MELTA",
    intro: "Melta weapons are powerful heat rays whose fury is magnified at close range.",
    body:
      "Weapons with [MELTA X] in their profile are known as Melta weapons. Each time such a weapon targets a unit within half range, increase that attack's Damage characteristic by X.",
    points: ["[MELTA X]: Increase Damage by X within half range."],
  },
  {
    title: "HEAVY",
    intro: "Heavy weapons are strongest when braced by stationary firing positions.",
    body:
      "Weapons with [HEAVY] in their profile are known as Heavy weapons. Each time an attack is made with such a weapon, if the attacking model's unit Remained Stationary this turn, add 1 to that attack's Hit roll.",
    points: ["Add 1 to Hit rolls if the bearer's unit Remained Stationary this turn."],
  },
  {
    title: "HAZARDOUS",
    intro: "Weapons powered by unstable energy sources pose a risk to the bearer.",
    body:
      "Weapons with [HAZARDOUS] in their profile are known as Hazardous weapons. After a unit shoots or fights, roll one D6 for each Hazardous weapon used. For each result of 1, one model in that unit equipped with a Hazardous weapon suffers 3 mortal wounds.",
    points: [
      "After shooting/fighting, roll one D6 for each Hazardous weapon used.",
      "Each result of 1 inflicts 3 mortal wounds on a model equipped with a Hazardous weapon.",
    ],
  },
  {
    title: "DEVASTATING WOUNDS",
    intro: "Some attacks inflict catastrophic injuries that bypass normal protections.",
    body:
      "Weapons with [DEVASTATING WOUNDS] in their profile are known as Devastating Wounds weapons. Each time such an attack scores a Critical Wound, it inflicts mortal wounds equal to the weapon's Damage characteristic instead of normal damage.",
    points: ["A Critical Wound inflicts mortal wounds equal to the weapon's Damage characteristic."],
  },
  {
    title: "SUSTAINED HITS",
    intro: "Some weapons strike in a flurry of blows, tearing the foe apart with relentless ferocity.",
    body:
      "Weapons with [SUSTAINED HITS X] in their profile are known as Sustained Hits weapons. Each time an attack with such a weapon scores a Critical Hit, it scores X additional hits on the target.",
    points: ["[SUSTAINED HITS X]: Each Critical Hit scores X additional hits on the target."],
  },
  {
    title: "EXTRA ATTACKS",
    intro: "Some weapons are used for additional strikes beyond a model's primary attacks.",
    body:
      "Weapons with [EXTRA ATTACKS] in their profile are known as Extra Attacks weapons. The bearer can make attacks with this weapon in addition to the weapons it selects to fight with.",
    points: ["The bearer can attack with this weapon in addition to its other selected weapons."],
  },
  {
    title: "ANTI",
    intro: "Certain weapons are the bane of a particular foe.",
    body:
      "Weapons with [ANTI-KEYWORD X+] in their profile are known as Anti weapons. Each time an attack is made with such a weapon against a target with the matching keyword, an unmodified Wound roll of X+ scores a Critical Wound.",
    points: ["[ANTI-KEYWORD X+]: An unmodified Wound roll of X+ scores a Critical Wound against a matching keyword."],
  },
];

function initThemeToggle() {
  if (!themeToggleEl) return;
  document.documentElement.classList.remove("theme-light");
  themeToggleEl.checked = false;
  themeToggleEl.addEventListener("change", () => {
    document.documentElement.classList.toggle("theme-light", themeToggleEl.checked);
  });
}

tooltipEl.className = "keyword-tooltip";
tooltipEl.innerHTML = `
  <div class="keyword-tooltip-title"></div>
  <div class="keyword-tooltip-intro"></div>
  <div class="keyword-tooltip-body"></div>
  <ul class="keyword-tooltip-points"></ul>
`;
document.body.appendChild(tooltipEl);

imagePreviewEl.className = "unit-image-preview";
imagePreviewEl.innerHTML = `
  <a class="unit-image-preview-link" href="#" target="_blank" rel="noopener noreferrer">
    <div class="unit-image-preview-frame">
      <img class="unit-image-preview-img" alt="" loading="lazy" referrerpolicy="no-referrer" />
      <div class="unit-image-preview-status">Loading image...</div>
    </div>
    <div class="unit-image-preview-caption"></div>
    <div class="unit-image-preview-source">Source: warhammer.com</div>
  </a>
`;
document.body.appendChild(imagePreviewEl);

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
  return dt.toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
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

function unitLookupKey(unitOrFaction, maybeName) {
  if (typeof unitOrFaction === "object" && unitOrFaction) {
    return `${normalized(unitOrFaction.factionName)}::${normalized(unitOrFaction.name)}`;
  }
  return `${normalized(unitOrFaction)}::${normalized(maybeName)}`;
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
    parserWarnings.push(`${fileName}: ${best.mismatchErrors} row(s) with non-standard field count`);
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

async function loadJsonOptional(fileName) {
  const response = await fetch(`./data/${encodeURIComponent(fileName)}`, { cache: "no-store" }).catch(() => null);
  if (!response || !response.ok) return null;
  return response.json();
}

function renderMeta() {
  if (!metaEl) return;
  const changed = indexData.changed_files?.length ? indexData.changed_files.join(", ") : "no changes";
  const skipped = indexData.skipped_missing_files?.length
    ? `<br><strong>Skipped (404):</strong> ${escapeHtml(indexData.skipped_missing_files.join(", "))}`
    : "";
  const warnings = parserWarnings.length
    ? `<br><strong>Parsing warnings:</strong> ${escapeHtml(parserWarnings.join(" | "))}`
    : "";

  metaEl.innerHTML = `<strong>Source:</strong> ${escapeHtml(indexData.source || "Wahapedia")}
    <br><strong>Updated:</strong> ${escapeHtml(formatUtc(indexData.updated_at_utc))}
    <br><strong>Changes:</strong> ${escapeHtml(changed)}${skipped}${warnings}`;
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

function formatBsWs(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  if (/^\d+$/.test(raw)) return `${raw}+`;
  return raw;
}

function formatRange(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "-";
  if (/^\d+$/.test(raw)) return `${raw}"`;
  return raw;
}

function parseCostNumber(value) {
  const raw = String(value ?? "").trim();
  const match = raw.match(/\d+/);
  if (!match) return null;
  const num = Number(match[0]);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function buildUnitImageIndex(payload) {
  unitImageEntriesById = new Map();
  unitImageEntriesByKey = new Map();

  const entries = Array.isArray(payload?.entries) ? payload.entries : [];
  for (const entry of entries) {
    if (!entry || entry.status !== "ok" || (!entry.local_path && !entry.image_url)) continue;
    const key = String(entry.unit_key || "").trim();
    if (key) unitImageEntriesByKey.set(key, entry);

    const ids = Array.isArray(entry.datasheet_ids) ? entry.datasheet_ids : [];
    for (const id of ids) {
      const value = String(id || "").trim();
      if (value) unitImageEntriesById.set(value, entry);
    }
  }
}

function resolveUnitImage(unit) {
  if (!unit) return null;
  return unitImageEntriesById.get(String(unit.id || "").trim()) || unitImageEntriesByKey.get(unitLookupKey(unit)) || null;
}

function buildUnitImageSearchUrl(unit) {
  const unitName = String(unit?.name || "").trim();
  if (!unitName) return "";
  return `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(`warhammer.com ${unitName}`)}`;
}

function normalizeRuleName(text) {
  return normalized(String(text || "").replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim());
}

function simplifyRuleName(text) {
  return String(text || "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s+(x|d\d+|\d+\+?)$/i, "")
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
  const tooltipRules = Array.isArray(coreRulesPayload?.tooltip_rules) ? coreRulesPayload.tooltip_rules : [];
  if (tooltipRules.length) {
    for (const rule of tooltipRules) {
      const title = String(rule?.title || "").trim();
      if (!title) continue;
      const tip = {
        title,
        intro: String(rule?.intro || "").trim(),
        body: String(rule?.body || "").trim(),
        points: Array.isArray(rule?.points) ? rule.points.map((x) => String(x || "").trim()).filter(Boolean) : [],
      };
      if (!tip.intro && !tip.body && !tip.points.length) continue;
      const k1 = normalizeRuleName(title);
      if (k1) index.set(k1, tip);
      const k2 = normalizeRuleName(simplifyRuleName(title));
      if (k2) index.set(k2, tip);
    }
    return index;
  }

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

function tooltipStrength(tip) {
  if (!tip) return 0;
  const intro = String(tip.intro || "").trim();
  const body = String(tip.body || "").trim();
  const points = Array.isArray(tip.points) ? tip.points.filter(Boolean) : [];
  return intro.length + body.length + points.join(" ").length;
}

function mergeCoreRuleIndexes(baseIndex, overrideIndex) {
  const out = new Map(baseIndex || []);
  for (const [key, tip] of overrideIndex || new Map()) {
    const prev = out.get(key);
    if (!prev || tooltipStrength(tip) >= tooltipStrength(prev)) {
      out.set(key, tip);
    }
  }
  return out;
}

function buildCanonicalCoreRuleIndex() {
  const index = new Map();
  for (const rule of CANONICAL_CORE_TOOLTIPS) {
    const title = String(rule?.title || "").trim();
    if (!title) continue;
    const tip = {
      title,
      intro: String(rule?.intro || "").trim(),
      body: String(rule?.body || "").trim(),
      points: Array.isArray(rule?.points) ? rule.points.map((x) => String(x || "").trim()).filter(Boolean) : [],
    };
    if (!tip.intro && !tip.body && !tip.points.length) continue;
    const k1 = normalizeRuleName(title);
    if (k1) index.set(k1, tip);
    const k2 = normalizeRuleName(simplifyRuleName(title));
    if (k2) index.set(k2, tip);
  }
  return index;
}

function parseAntiTag(label) {
  const raw = String(label || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  const match = raw.match(/^ANTI[- ]([A-Z0-9 ]+?)\s+(\d\+)$/);
  if (!match) return null;
  return {
    keyword: match[1].trim(),
    threshold: match[2].trim(),
  };
}

function makeAntiTooltip(label, antiCoreTip) {
  const parsed = parseAntiTag(label);
  if (!parsed) return antiCoreTip;
  return {
    title: String(label || "Anti").toUpperCase(),
    intro: antiCoreTip?.intro || "Certain weapons are the bane of a particular foe.",
    body: `Weapons with [${String(label || "").toUpperCase()}] in their profile are Anti weapons. Each time an attack is made with such a weapon against a target with the ${parsed.keyword} keyword, an unmodified Wound roll of ${parsed.threshold} scores a Critical Wound.`,
    points: [
      `Against ${parsed.keyword}, an unmodified Wound roll of ${parsed.threshold} scores a Critical Wound.`,
    ],
  };
}

function makeOneShotTooltip() {
  return {
    title: "ONE SHOT",
    intro: "This weapon can be fired once during the battle.",
    body: "In the current Wahapedia Core Rules export there is no standalone One Shot section. The rule is referenced in Core Rules (Firing Deck), where weapons with [ONE SHOT] are excluded from being selected via Firing Deck.",
    points: [
      "This weapon can be used once per battle.",
      "It is excluded from Firing Deck selection in Core Rules.",
    ],
  };
}

function makePsychicTooltip() {
  return {
    title: "PSYCHIC",
    intro: "This is a Psychic weapon ability.",
    body: "In the current Core Rules export there is no standalone Psychic weapon ability section. Keep this tag available as a rules marker for interactions that reference Psychic attacks.",
    points: [
      "Used as a keyword marker for Psychic attack interactions.",
    ],
  };
}

function buildAbilityTooltipIndex(abilities) {
  const index = new Map();
  for (const ability of abilities || []) {
    const name = String(ability?.name || "").trim();
    if (!name) continue;
    const tip = buildTooltipPayload(name, ability.legend || "", ability.description || "");
    if (!tip.intro && !tip.body && !tip.points.length) continue;

    const k1 = normalizeRuleName(name);
    if (k1) index.set(k1, tip);
    const k2 = normalizeRuleName(simplifyRuleName(name));
    if (k2) index.set(k2, tip);
  }
  return index;
}

function abilityDisplayName(ability) {
  const baseName = String(ability?.name || "").trim() || "Unnamed ability";
  const parameter = String(ability?.parameter || "").trim();
  if (!parameter) return baseName;

  const hasParamAlready = new RegExp(`\\b${parameter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(baseName);
  if (hasParamAlready) return baseName;

  // Common Wahapedia format uses "x" placeholder (e.g. "Deadly Demise x").
  if (/\bx\b/i.test(baseName)) {
    return baseName.replace(/\bx\b/i, parameter);
  }
  return `${baseName} ${parameter}`;
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
                : { title: tag.label || "", intro: "", body: "Rule description not found in source.", points: [] };
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
        <td>${escapeHtml(formatRange(weapon.range))}</td>
        <td>${escapeHtml(weapon.A || "-")}</td>
        <td>${escapeHtml(formatBsWs(weapon.BS_WS))}</td>
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
    abilitiesListEl.innerHTML = '<p class="note">No data</p>';
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
      const showTextDescriptions = !["CORE", "FACTION"].includes(type);
      const chips = list
        .map((ability) => {
          const title = abilityDisplayName(ability);
          const tip = buildTooltipPayload(title, ability.legend || "", ability.description || "");
          const hasDesc = Boolean(tip.intro || tip.body || (tip.points && tip.points.length));
          const cls = hasDesc ? "kw-link" : "kw-link disabled";
          const fallback = hasDesc
            ? tip
            : { title, intro: "", body: "Description is missing in source.", points: [] };
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

      const details = showTextDescriptions
        ? list
            .map((ability) => {
              const title = abilityDisplayName(ability);
              const desc = stripHtml(ability.description || ability.legend || "");
              if (!isMeaningfulValue(desc)) return "";
              return `<div class="ability-detail">
                <div class="ability-detail-name">${escapeHtml(title)}:</div>
                <div class="ability-detail-text">${escapeHtml(desc)}</div>
              </div>`;
            })
            .filter(Boolean)
            .join("")
        : "";

      return `<div class="ability">
        <div class="ability-top">${escapeHtml(type)}</div>
        <div class="ability-keywords">${chips}</div>
        ${details ? `<div class="ability-details">${details}</div>` : ""}
      </div>`;
    })
    .join("");
}

function renderKeywords(keywords) {
  if (!keywords.length) {
    keywordsEl.innerHTML = '<span class="note">No keywords</span>';
    return;
  }

  keywordsEl.innerHTML = keywords
    .slice(0, 80)
    .map((keyword) => {
      const active = activeKeywordFilter === keyword ? "active" : "";
      return `<button type="button" class="chip keyword-chip ${active}" data-keyword="${escapeHtml(keyword)}">${escapeHtml(keyword)}</button>`;
    })
    .join("");

  for (const button of keywordsEl.querySelectorAll(".keyword-chip")) {
    button.addEventListener("click", () => {
      const kw = button.dataset.keyword || "";
      activeKeywordFilter = activeKeywordFilter === kw ? "" : kw;
      renderKeywords(keywords);
      renderUnitList();
    });
  }
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
    chunks.push('<p class="note">No additional descriptions</p>');
  }

  compositionEl.innerHTML = chunks.join("");
}

function renderUnitCost(unit) {
  if (!unitCostEl) return;
  const costs = (unit.costOptions || []).filter((item) => Number.isFinite(item.points) && item.points > 0);
  if (!costs.length) {
    unitCostEl.innerHTML = '<p class="note">No unit cost data</p>';
    return;
  }

  unitCostEl.innerHTML = costs
    .map(
      (item) =>
        `<div class="cost-row"><div class="cost-row-label">${escapeHtml(item.label || unit.name)}</div><div class="cost-row-points">${escapeHtml(String(item.points))}</div></div>`
    )
    .join("");
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

function setUnitPhotoButton(unit) {
  if (!unitPhotoBtnEl) return;
  if (!unit) {
    unitPhotoBtnEl.hidden = true;
    unitPhotoBtnEl.title = "";
    unitPhotoBtnEl.dataset.imageUrl = "";
    unitPhotoBtnEl.dataset.imagePageUrl = "";
    unitPhotoBtnEl.dataset.imageSearchUrl = "";
    unitPhotoBtnEl.dataset.imageTitle = "";
    unitPhotoBtnEl.dataset.hasPreview = "false";
    unitPhotoBtnEl.dataset.previewStatus = "";
    if (imagePreviewAnchorEl === unitPhotoBtnEl) hideImagePreview();
    return;
  }

  const imageEntry = resolveUnitImage(unit);
  const searchUrl = buildUnitImageSearchUrl(unit);
  unitPhotoBtnEl.hidden = false;
  unitPhotoBtnEl.dataset.imageSearchUrl = searchUrl;
  unitPhotoBtnEl.dataset.imageTitle = String(unit.name || "Unit image");

  if (!imageEntry) {
    unitPhotoBtnEl.title = "Open unit image search";
    unitPhotoBtnEl.dataset.imageUrl = "";
    unitPhotoBtnEl.dataset.imagePageUrl = searchUrl;
    unitPhotoBtnEl.dataset.hasPreview = "false";
    unitPhotoBtnEl.dataset.previewStatus = "pending";
    if (imagePreviewAnchorEl === unitPhotoBtnEl) hideImagePreview();
    return;
  }

  unitPhotoBtnEl.title = "Preview unit image";
  unitPhotoBtnEl.dataset.imageUrl = String(imageEntry.local_path || imageEntry.image_url || "");
  unitPhotoBtnEl.dataset.imagePageUrl = String(imageEntry.source_page_url || imageEntry.image_url || "");
  unitPhotoBtnEl.dataset.imageTitle = String(imageEntry.unit_name || unit.name || "Unit image");
  unitPhotoBtnEl.dataset.hasPreview = "true";
  unitPhotoBtnEl.dataset.previewStatus = "ready";
}

function openUnitImageSearch(target) {
  const searchUrl = String(target?.dataset?.imageSearchUrl || target?.dataset?.imagePageUrl || "").trim();
  if (!searchUrl) return false;
  window.open(searchUrl, "_blank", "noopener,noreferrer");
  return true;
}

function renderUnit(unit) {
  hideImagePreview();
  unitTitleEl.textContent = unit.name || "Unknown unit";
  setUnitPhotoButton(unit);
  unitMetaEl.textContent = `${unit.factionName} • ${unit.baseSize || "base n/a"}`;
  roleBadgeEl.textContent = unit.role || "Role n/a";

  renderStatline(unit);
  const hasRanged = renderWeaponTable("Ranged", unit.weapons.ranged);
  const hasMelee = renderWeaponTable("Melee", unit.weapons.melee);
  rangedBlockEl.style.display = hasRanged ? "" : "none";
  meleeBlockEl.style.display = hasMelee ? "" : "none";
  renderAbilities(unit.abilities);
  renderKeywords(unit.keywords);
  renderUnitCost(unit);
  renderComposition(unit);
}

function getActiveDetachment() {
  const detId = detachmentSelectEl.value;
  if (!detId || detId === "__all__") return null;
  const faction = factionSelectEl.value;
  const sample = catalog.units.find((u) => u.factionName === faction);
  if (!sample) return null;
  const byFaction = catalog.detachmentsByFaction.get(sample.factionId);
  if (!byFaction) return null;
  return byFaction.get(detId) || null;
}

function renderDetachmentInfo() {
  const det = getActiveDetachment();
  if (!det) {
    detachmentContentEl.innerHTML = '<p class="note">Select a detachment to view its rules.</p>';
    return;
  }

  const abilityItems = det.abilities
    .slice(0, 6)
    .map((a) => {
      const tip = buildTooltipPayload(a.name || "Detachment Rule", a.legend || "", a.description || "");
      return `<button
        type="button"
        class="kw-link det-link"
        data-tip-title="${escapeHtml(tip.title || a.name || "Detachment Rule")}"
        data-tip-intro="${escapeHtml(tip.intro || "")}"
        data-tip-body="${escapeHtml(tip.body || "")}"
        data-tip-points="${escapeHtml((tip.points || []).join("||"))}"
      >${escapeHtml(a.name || "Detachment Rule")}</button>`;
    })
    .join("");
  const stratItems = det.stratagems
    .slice(0, 8)
    .map((s) => {
      const tip = buildTooltipPayload(s.name || "Stratagem", s.type || "", s.description || "");
      const label = `${s.name || "Stratagem"}${s.cpCost ? ` (${s.cpCost}CP)` : ""}`;
      return `<button
        type="button"
        class="kw-link det-link"
        data-tip-title="${escapeHtml(tip.title || s.name || "Stratagem")}"
        data-tip-intro="${escapeHtml(tip.intro || "")}"
        data-tip-body="${escapeHtml(tip.body || "")}"
        data-tip-points="${escapeHtml((tip.points || []).join("||"))}"
      >${escapeHtml(label)}</button>`;
    })
    .join("");
  const enhItems = det.enhancements
    .slice(0, 8)
    .map((e) => {
      const tip = buildTooltipPayload(e.name || "Enhancement", e.legend || "", e.description || "");
      const label = `${e.name || "Enhancement"}${e.cost ? ` (${e.cost} pts)` : ""}`;
      return `<button
        type="button"
        class="kw-link det-link"
        data-tip-title="${escapeHtml(tip.title || e.name || "Enhancement")}"
        data-tip-intro="${escapeHtml(tip.intro || "")}"
        data-tip-body="${escapeHtml(tip.body || "")}"
        data-tip-points="${escapeHtml((tip.points || []).join("||"))}"
      >${escapeHtml(label)}</button>`;
    })
    .join("");

  detachmentContentEl.innerHTML = `
    <p><strong>${escapeHtml(det.name)}</strong></p>
    ${abilityItems ? `<p><strong>Rule:</strong></p><div class="det-chip-list">${abilityItems}</div>` : ""}
    ${stratItems ? `<p><strong>Stratagems:</strong></p><div class="det-chip-list">${stratItems}</div>` : ""}
    ${enhItems ? `<p><strong>Enhancements:</strong></p><div class="det-chip-list">${enhItems}</div>` : ""}
  `;
}

function showTooltip(target, x, y) {
  if (!target) return;
  hideImagePreview();
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
  tooltipAnchorEl = target;
  moveTooltip(x, y);
}

function hideTooltip() {
  tooltipEl.classList.remove("visible");
  tooltipVisible = false;
  tooltipAnchorEl = null;
  const active = document.activeElement;
  if (active && active.classList && active.classList.contains("kw-link")) {
    active.blur();
  }
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

function moveImagePreview() {
  if (!imagePreviewVisible || !imagePreviewAnchorEl) return;
  const rect = imagePreviewAnchorEl.getBoundingClientRect();
  const width = imagePreviewEl.offsetWidth || 320;
  const height = imagePreviewEl.offsetHeight || 340;
  const margin = 12;

  let left = rect.right - width;
  let top = rect.bottom + margin;

  if (left < 8) left = 8;
  if (left + width > window.innerWidth - 8) left = window.innerWidth - width - 8;
  if (top + height > window.innerHeight - 8) top = rect.top - height - margin;
  if (top < 8) top = 8;

  imagePreviewEl.style.left = `${Math.max(8, left)}px`;
  imagePreviewEl.style.top = `${Math.max(8, top)}px`;
}

function hideImagePreview() {
  imagePreviewEl.classList.remove("visible");
  imagePreviewVisible = false;
  imagePreviewAnchorEl = null;
}

function showImagePreview(target) {
  if (!target) return;
  const imageUrl = target.dataset.imageUrl || "";

  hideTooltip();

  const linkEl = imagePreviewEl.querySelector(".unit-image-preview-link");
  const imgEl = imagePreviewEl.querySelector(".unit-image-preview-img");
  const statusEl = imagePreviewEl.querySelector(".unit-image-preview-status");
  const captionEl = imagePreviewEl.querySelector(".unit-image-preview-caption");
  const sourceEl = imagePreviewEl.querySelector(".unit-image-preview-source");

  const title = target.dataset.imageTitle || "Unit image";
  const pageUrl = target.dataset.imagePageUrl || target.dataset.imageSearchUrl || imageUrl || "#";

  imagePreviewEl.classList.remove("is-loaded", "is-error", "is-empty");
  captionEl.textContent = title;
  linkEl.href = pageUrl;
  linkEl.setAttribute("aria-label", title);

  if (!imageUrl) {
    const previewStatus = target.dataset.previewStatus || "pending";
    imgEl.dataset.currentSrc = "";
    imgEl.removeAttribute("src");
    imgEl.alt = "";
    imagePreviewEl.classList.add("is-empty");
    statusEl.textContent =
      previewStatus === "not_found" ? "No cached preview yet. Click to open image search." : "Preview is being indexed. Click to open image search.";
    sourceEl.textContent = "Google Images search";
    imagePreviewEl.classList.add("visible");
    imagePreviewVisible = true;
    imagePreviewAnchorEl = target;
    moveImagePreview();
    return;
  }

  imgEl.alt = title;
  statusEl.textContent = "Loading image...";
  sourceEl.textContent = "Cached preview";

  const sameImage = imgEl.dataset.currentSrc === imageUrl;
  if (!sameImage) {
    imgEl.dataset.currentSrc = imageUrl;
    imgEl.removeAttribute("src");
    imgEl.src = imageUrl;
  }

  imgEl.onload = () => {
    imagePreviewEl.classList.add("is-loaded");
    imagePreviewEl.classList.remove("is-error");
    statusEl.textContent = "";
  };

  imgEl.onerror = () => {
    imagePreviewEl.classList.add("is-error");
    imagePreviewEl.classList.remove("is-loaded");
    statusEl.textContent = "Image unavailable";
  };

  if (sameImage && imgEl.complete) {
    if (imgEl.naturalWidth > 0) {
      imagePreviewEl.classList.add("is-loaded");
      imagePreviewEl.classList.remove("is-error");
      statusEl.textContent = "";
    } else {
      imagePreviewEl.classList.add("is-error");
      imagePreviewEl.classList.remove("is-loaded");
      statusEl.textContent = "Image unavailable";
    }
  }

  imagePreviewEl.classList.add("visible");
  imagePreviewVisible = true;
  imagePreviewAnchorEl = target;
  moveImagePreview();
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

  document.addEventListener("click", (event) => {
    if (Date.now() < suppressTooltipClickUntil) return;
    const target = event.target.closest(".kw-link");
    if (!target || target.classList.contains("disabled")) {
      hideTooltip();
      return;
    }
    if (tooltipVisible && tooltipAnchorEl === target) {
      hideTooltip();
      return;
    }
    const rect = target.getBoundingClientRect();
    showTooltip(target, rect.left + rect.width / 2, rect.bottom);
  });

  document.addEventListener(
    "touchstart",
    (event) => {
      suppressTooltipClickUntil = Date.now() + 700;
      const target = event.target.closest(".kw-link");
      if (!target || target.classList.contains("disabled")) {
        hideTooltip();
        return;
      }
      if (tooltipVisible && tooltipAnchorEl === target) {
        hideTooltip();
        return;
      }
      const rect = target.getBoundingClientRect();
      showTooltip(target, rect.left + rect.width / 2, rect.bottom);
    },
    { passive: true }
  );
  document.addEventListener("scroll", hideTooltip, true);
  window.addEventListener("blur", hideTooltip);
}

function initImagePreviewHandlers() {
  if (!unitPhotoBtnEl) return;

  const onLeave = (relatedTarget) => {
    const toButton = relatedTarget?.closest?.(".unit-photo-btn");
    const toPreview = relatedTarget?.closest?.(".unit-image-preview");
    if (!toButton && !toPreview) hideImagePreview();
  };

  unitPhotoBtnEl.addEventListener("mouseenter", () => {
    if (unitPhotoBtnEl.hidden) return;
    showImagePreview(unitPhotoBtnEl);
  });

  unitPhotoBtnEl.addEventListener("mouseleave", (event) => {
    onLeave(event.relatedTarget);
  });

  unitPhotoBtnEl.addEventListener("focus", () => {
    if (unitPhotoBtnEl.hidden) return;
    showImagePreview(unitPhotoBtnEl);
  });

  unitPhotoBtnEl.addEventListener("blur", (event) => {
    onLeave(event.relatedTarget);
  });

  unitPhotoBtnEl.addEventListener("click", (event) => {
    event.preventDefault();
    if (unitPhotoBtnEl.hidden) return;
    if (!unitPhotoBtnEl.dataset.imageUrl) {
      hideImagePreview();
      openUnitImageSearch(unitPhotoBtnEl);
      return;
    }
    if (imagePreviewVisible && imagePreviewAnchorEl === unitPhotoBtnEl) {
      hideImagePreview();
      return;
    }
    showImagePreview(unitPhotoBtnEl);
  });

  unitPhotoBtnEl.addEventListener(
    "touchstart",
    (event) => {
      event.preventDefault();
      if (unitPhotoBtnEl.hidden) return;
      if (!unitPhotoBtnEl.dataset.imageUrl) {
        hideImagePreview();
        openUnitImageSearch(unitPhotoBtnEl);
        return;
      }
      if (imagePreviewVisible && imagePreviewAnchorEl === unitPhotoBtnEl) {
        hideImagePreview();
        return;
      }
      showImagePreview(unitPhotoBtnEl);
    },
    { passive: false }
  );

  imagePreviewEl.addEventListener("mouseleave", (event) => {
    onLeave(event.relatedTarget);
  });

  document.addEventListener("pointerdown", (event) => {
    if (!event.target.closest(".unit-photo-btn") && !event.target.closest(".unit-image-preview")) {
      hideImagePreview();
    }
  });

  window.addEventListener("resize", moveImagePreview, { passive: true });
  window.addEventListener("scroll", hideImagePreview, { passive: true });
  window.addEventListener("blur", hideImagePreview);
}

function getFilteredUnits() {
  const faction = factionSelectEl.value;
  const detachmentId = detachmentSelectEl.value;
  const query = unitSearchEl.value.trim().toLowerCase();

  const filtered = catalog.units.filter((unit) => {
    if (!showLegends && unit.isLegend) return false;
    if (faction && faction !== "__all__" && unit.factionName !== faction) return false;
    if (detachmentId && detachmentId !== "__all__") {
      if (unit.detachmentIds.length && !unit.detachmentIds.includes(detachmentId)) return false;
    }
    if (activeKeywordFilter) {
      if (!unit.keywords.some((kw) => kw.toLowerCase() === activeKeywordFilter.toLowerCase())) return false;
    }
    if (!query) return true;
    return unit.name.toLowerCase().includes(query);
  });

  const byName = new Map();
  for (const unit of filtered) {
    const key = `${unit.factionName}::${unit.name}`.toLowerCase();
    const prev = byName.get(key);
    if (!prev) {
      byName.set(key, unit);
      continue;
    }
    const prevId = Number(prev.id || "0");
    const currId = Number(unit.id || "0");
    if (currId < prevId) byName.set(key, unit);
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function renderKeywordFilterIndicator() {
  if (!activeKeywordFilter) {
    keywordFilterIndicatorEl.innerHTML = "";
    keywordFilterIndicatorEl.style.display = "none";
    return;
  }

  keywordFilterIndicatorEl.style.display = "";
  keywordFilterIndicatorEl.innerHTML = `
    <span>Keyword filter: <strong>${escapeHtml(activeKeywordFilter)}</strong></span>
    <button type="button" id="clear-keyword-filter" class="clear-filter-btn">Clear</button>
  `;
  const btn = document.querySelector("#clear-keyword-filter");
  if (btn) {
    btn.addEventListener("click", () => {
      activeKeywordFilter = "";
      renderUnitList();
    });
  }
}

function renderUnitList() {
  hideImagePreview();
  const units = getFilteredUnits();
  renderDetachmentInfo();
  renderKeywordFilterIndicator();

  if (!units.length) {
    unitListEl.innerHTML = '<p class="note">No units match the current filters.</p>';
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
  const modelCostsRows = datasets.get("Datasheets_models_cost.csv")?.rows || [];
  const wargearRows = datasets.get("Datasheets_wargear.csv")?.rows || [];
  const keywordsRows = datasets.get("Datasheets_keywords.csv")?.rows || [];
  const datasheetAbilitiesRows = datasets.get("Datasheets_abilities.csv")?.rows || [];
  const datasheetStratRows = datasets.get("Datasheets_stratagems.csv")?.rows || [];
  const datasheetEnhRows = datasets.get("Datasheets_enhancements.csv")?.rows || [];
  const abilityRows = datasets.get("Abilities.csv")?.rows || [];
  const stratagemRows = datasets.get("Stratagems.csv")?.rows || [];
  const enhancementRows = datasets.get("Enhancements.csv")?.rows || [];
  const detachmentAbilityRows = datasets.get("Detachment_abilities.csv")?.rows || [];
  const sourceRows = datasets.get("Source.csv")?.rows || [];

  const factionById = new Map();
  for (const row of factionsRows) {
    const id = firstNonEmpty(row, ["id"]);
    const name = firstNonEmpty(row, ["name"]);
    if (id && name) factionById.set(id, name);
  }

  const sourceById = new Map();
  for (const row of sourceRows) {
    const id = firstNonEmpty(row, ["id"]);
    if (!id) continue;
    sourceById.set(id, {
      name: firstNonEmpty(row, ["name"]),
      type: firstNonEmpty(row, ["type"]),
    });
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

  const costsByDsId = new Map();
  const costsByName = new Map();
  for (const row of modelCostsRows) {
    const dsId = firstNonEmpty(row, ["datasheet_id", "datasheetid", "id_datasheet"]);
    const dsName = firstNonEmpty(row, ["datasheet", "datasheet_name", "datasheet_name_en", "unit_name", "name"]);
    if (dsId) {
      if (!costsByDsId.has(dsId)) costsByDsId.set(dsId, []);
      costsByDsId.get(dsId).push(row);
    }
    if (dsName) {
      const key = normalized(dsName);
      if (key) {
        if (!costsByName.has(key)) costsByName.set(key, []);
        costsByName.get(key).push(row);
      }
    }
  }
  for (const [dsId, lines] of costsByDsId.entries()) {
    lines.sort((a, b) => Number(firstNonEmpty(a, ["line", "id"]) || "0") - Number(firstNonEmpty(b, ["line", "id"]) || "0"));
    costsByDsId.set(dsId, lines);
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

  const stratagemById = new Map();
  for (const row of stratagemRows) {
    const sid = firstNonEmpty(row, ["id"]);
    if (!sid) continue;
    stratagemById.set(sid, {
      id: sid,
      factionId: firstNonEmpty(row, ["faction_id"]),
      name: firstNonEmpty(row, ["name"]),
      detachmentId: firstNonEmpty(row, ["detachment_id"]),
      detachmentName: firstNonEmpty(row, ["detachment"]),
      cpCost: firstNonEmpty(row, ["cp_cost"]),
      phase: firstNonEmpty(row, ["phase"]),
      type: firstNonEmpty(row, ["type"]),
      description: firstNonEmpty(row, ["description"]),
    });
  }

  const enhancementById = new Map();
  for (const row of enhancementRows) {
    const eid = firstNonEmpty(row, ["id"]);
    if (!eid) continue;
    enhancementById.set(eid, {
      id: eid,
      factionId: firstNonEmpty(row, ["faction_id"]),
      name: firstNonEmpty(row, ["name"]),
      detachmentId: firstNonEmpty(row, ["detachment_id"]),
      detachmentName: firstNonEmpty(row, ["detachment"]),
      cost: firstNonEmpty(row, ["cost"]),
      description: firstNonEmpty(row, ["description"]),
      legend: firstNonEmpty(row, ["legend"]),
    });
  }

  const detachmentsByFaction = new Map();
  function ensureDetachment(factionId, detachmentId, detachmentName) {
    const fId = factionId || "__unknown__";
    if (!detachmentsByFaction.has(fId)) detachmentsByFaction.set(fId, new Map());
    const detMap = detachmentsByFaction.get(fId);
    const dId = detachmentId || "__unknown_detachment__";
    if (!detMap.has(dId)) {
      detMap.set(dId, {
        id: dId,
        name: detachmentName || "Unknown Detachment",
        abilities: [],
        stratagems: [],
        enhancements: [],
      });
    }
    const det = detMap.get(dId);
    if (detachmentName && !det.name) det.name = detachmentName;
    return det;
  }

  for (const row of detachmentAbilityRows) {
    const factionId = firstNonEmpty(row, ["faction_id"]);
    const detachmentId = firstNonEmpty(row, ["detachment_id"]);
    const detachmentName = firstNonEmpty(row, ["detachment"]);
    if (!factionId || !detachmentId) continue;
    const det = ensureDetachment(factionId, detachmentId, detachmentName);
    det.abilities.push({
      id: firstNonEmpty(row, ["id"]),
      name: firstNonEmpty(row, ["name"]),
      legend: firstNonEmpty(row, ["legend"]),
      description: firstNonEmpty(row, ["description"]),
    });
  }

  for (const row of stratagemRows) {
    const factionId = firstNonEmpty(row, ["faction_id"]);
    const detachmentId = firstNonEmpty(row, ["detachment_id"]);
    const detachmentName = firstNonEmpty(row, ["detachment"]);
    if (!factionId || !detachmentId) continue;
    const det = ensureDetachment(factionId, detachmentId, detachmentName);
    det.stratagems.push({
      id: firstNonEmpty(row, ["id"]),
      name: firstNonEmpty(row, ["name"]),
      cpCost: firstNonEmpty(row, ["cp_cost"]),
      phase: firstNonEmpty(row, ["phase"]),
      type: firstNonEmpty(row, ["type"]),
      description: firstNonEmpty(row, ["description"]),
    });
  }

  for (const row of enhancementRows) {
    const factionId = firstNonEmpty(row, ["faction_id"]);
    const detachmentId = firstNonEmpty(row, ["detachment_id"]);
    const detachmentName = firstNonEmpty(row, ["detachment"]);
    if (!factionId || !detachmentId) continue;
    const det = ensureDetachment(factionId, detachmentId, detachmentName);
    det.enhancements.push({
      id: firstNonEmpty(row, ["id"]),
      name: firstNonEmpty(row, ["name"]),
      cost: firstNonEmpty(row, ["cost"]),
      legend: firstNonEmpty(row, ["legend"]),
      description: firstNonEmpty(row, ["description"]),
    });
  }

  const dsDetachmentIds = new Map();
  function pushDsDet(dsId, detId) {
    if (!dsId || !detId) return;
    if (!dsDetachmentIds.has(dsId)) dsDetachmentIds.set(dsId, new Set());
    dsDetachmentIds.get(dsId).add(detId);
  }

  for (const row of datasheetStratRows) {
    const dsId = firstNonEmpty(row, ["datasheet_id"]);
    const stratId = firstNonEmpty(row, ["stratagem_id"]);
    const strat = stratagemById.get(stratId);
    if (!strat || !strat.detachmentId) continue;
    pushDsDet(dsId, strat.detachmentId);
  }

  for (const row of datasheetEnhRows) {
    const dsId = firstNonEmpty(row, ["datasheet_id"]);
    const enhId = firstNonEmpty(row, ["enhancement_id"]);
    const enh = enhancementById.get(enhId);
    if (!enh || !enh.detachmentId) continue;
    pushDsDet(dsId, enh.detachmentId);
  }

  const units = [];

  for (const row of datasheetsRows) {
    const id = firstNonEmpty(row, ["id"]);
    const name = firstNonEmpty(row, ["name"]);
    const factionId = firstNonEmpty(row, ["faction_id"]);
    if (!id || !name) continue;

    const modelLines = modelsByDsId.get(id) || [];
    const primaryModel = modelLines[0] || {};

    const resolvedAbilities = (abilitiesByDsId.get(id) || []).map((item) => {
      const abilityId = firstNonEmpty(item, ["ability_id"]);
      const inlineName = firstNonEmpty(item, ["name"]);
      const inlineDescription = firstNonEmpty(item, ["description"]);
      const type = firstNonEmpty(item, ["type"]);
      const def = abilityId ? chooseAbilityDefinition(abilityDefs, abilityId, factionId) : null;

      return {
        type: type || "Datasheet",
        name: inlineName || def?.name || "",
        parameter: firstNonEmpty(item, ["parameter"]),
        legend: def?.legend || "",
        description: inlineDescription || def?.description || "",
      };
    });
    const unitAbilityTipIndex = buildAbilityTooltipIndex(resolvedAbilities);

    const weapons = (wargearByDsId.get(id) || []).map((item) => {
      const description = firstNonEmpty(item, ["description"]);
      const ruleTags = parseWeaponTags(description).map((label) => {
        const exactKey = normalizeRuleName(label);
        const simpleKey = normalizeRuleName(simplifyRuleName(label));
        let coreTip = coreRuleDefsByName.get(exactKey) || coreRuleDefsByName.get(simpleKey) || null;
        if (!coreTip && exactKey.startsWith("anti")) {
          const antiCore = coreRuleDefsByName.get("anti");
          if (antiCore) coreTip = makeAntiTooltip(label, antiCore);
        }
        if (!coreTip && exactKey === "oneshot") {
          coreTip = makeOneShotTooltip();
        }
        if (!coreTip && exactKey === "psychic") {
          coreTip = coreRuleDefsByName.get("psychic") || makePsychicTooltip();
        }
        const found = chooseByFaction(
          abilityDefsByName.get(exactKey) || abilityDefsByName.get(simpleKey) || [],
          factionId
        );
        const unitTip = unitAbilityTipIndex.get(exactKey) || unitAbilityTipIndex.get(simpleKey) || null;
        return {
          label,
          tooltip: coreTip
            ? coreTip
            : unitTip
            ? unitTip
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
      detachmentIds: [...(dsDetachmentIds.get(id) || new Set())],
      costOptions: [],
      isLegend: false,
    };

    const sourceId = firstNonEmpty(row, ["source_id"]);
    const sourceName = sourceById.get(sourceId)?.name || "";
    const sourceType = sourceById.get(sourceId)?.type || "";
    const sourceText = `${sourceName} ${sourceType}`.toLowerCase();
    unit.isLegend = sourceText.includes("legend");

    const rawCostRows = [...(costsByDsId.get(id) || []), ...(costsByName.get(normalized(name)) || [])];
    const seenCosts = new Set();
    for (const costRow of rawCostRows) {
      const pointsRaw = firstNonEmpty(costRow, ["cost", "pts", "points", "unit_cost", "model_cost", "cost_pts"]);
      const points = parseCostNumber(pointsRaw);
      if (!points) continue;
      const label =
        firstNonEmpty(costRow, [
          "description",
          "models",
          "unit_composition",
          "model",
          "model_name",
          "name",
          "variant",
          "option",
          "loadout",
        ]) || name;
      const key = `${normalized(label)}::${points}`;
      if (seenCosts.has(key)) continue;
      seenCosts.add(key);
      unit.costOptions.push({ label, points });
    }

    units.push(unit);
  }

  units.sort((a, b) => a.name.localeCompare(b.name));

  const factions = [...new Set(units.map((unit) => unit.factionName))].sort((a, b) => a.localeCompare(b));
  return { factions, units, detachmentsByFaction };
}

function populateFactionSelect() {
  factionSelectEl.innerHTML = [
    '<option value="__all__">All factions</option>',
    ...catalog.factions.map((faction) => `<option value="${escapeHtml(faction)}">${escapeHtml(faction)}</option>`),
  ].join("");
}

function populateDetachmentSelect() {
  const faction = factionSelectEl.value;
  if (!faction || faction === "__all__") {
    detachmentSelectEl.innerHTML = '<option value="__all__">All detachments</option>';
    return;
  }
  const sample = catalog.units.find((u) => (faction === "__all__" ? true : u.factionName === faction));
  if (!sample) {
    detachmentSelectEl.innerHTML = '<option value="__all__">All detachments</option>';
    return;
  }
  const byFaction = catalog.detachmentsByFaction.get(sample.factionId);
  if (!byFaction || !byFaction.size) {
    detachmentSelectEl.innerHTML = '<option value="__all__">All detachments</option>';
    return;
  }
  const options = ['<option value="__all__">All detachments</option>'];
  const sorted = [...byFaction.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const det of sorted) {
    options.push(`<option value="${escapeHtml(det.id)}">${escapeHtml(det.name)}</option>`);
  }
  detachmentSelectEl.innerHTML = options.join("");
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
    throw new Error(`Missing CSV files: ${missingFiles.join(", ")}`);
  }

  const datasets = new Map();
  for (const file of REQUIRED_FILES) {
    const parsed = await loadCsv(file);
    datasets.set(file, parsed);
  }

  for (const file of OPTIONAL_FILES) {
    try {
      const parsed = await loadCsv(file);
      datasets.set(file, parsed);
    } catch {
      // Optional dataset: skip when unavailable.
    }
  }

  coreRuleDefsByName = new Map();
  try {
    const [pdfResponse, wahapediaResponse] = await Promise.all([
      fetch("./data/core_rules_pdf.json", { cache: "no-store" }).catch(() => null),
      fetch("./data/core_rules.json", { cache: "no-store" }).catch(() => null),
    ]);
    const pdfIndex =
      pdfResponse && pdfResponse.ok ? buildCoreRuleIndex(await pdfResponse.json()) : new Map();
    const wahapediaIndex =
      wahapediaResponse && wahapediaResponse.ok ? buildCoreRuleIndex(await wahapediaResponse.json()) : new Map();
    const mergedRemote = mergeCoreRuleIndexes(wahapediaIndex, pdfIndex);
    const canonicalIndex = buildCanonicalCoreRuleIndex();
    coreRuleDefsByName = mergeCoreRuleIndexes(mergedRemote, canonicalIndex);
  } catch {
    coreRuleDefsByName = new Map();
  }

  buildUnitImageIndex(await loadJsonOptional("unit_images.json"));

  catalog = buildCatalog(datasets);
  if (!catalog.units.length) {
    throw new Error("Failed to build unit catalog");
  }

  populateFactionSelect();
  populateDetachmentSelect();
  renderMeta();
  renderUnitList();
}

factionSelectEl.addEventListener("change", () => {
  populateDetachmentSelect();
  activeKeywordFilter = "";
  renderUnitList();
});
detachmentSelectEl.addEventListener("change", renderUnitList);
unitSearchEl.addEventListener("input", renderUnitList);
if (showLegendsToggleEl) {
  showLegendsToggleEl.checked = false;
  showLegendsToggleEl.addEventListener("change", () => {
    showLegends = Boolean(showLegendsToggleEl.checked);
    renderUnitList();
  });
}

function updateScrollTopButton() {
  if (!scrollTopBtnEl) return;
  scrollTopBtnEl.classList.toggle("visible", window.scrollY > 260);
}

if (scrollTopBtnEl) {
  scrollTopBtnEl.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  window.addEventListener("scroll", updateScrollTopButton, { passive: true });
  updateScrollTopButton();
}

initTooltipHandlers();
initImagePreviewHandlers();
initThemeToggle();

loadIndexAndInit().catch((error) => {
  if (metaEl) {
    metaEl.textContent = `Initialization error: ${error.message}`;
  } else {
    console.error("Initialization error:", error);
  }
});
