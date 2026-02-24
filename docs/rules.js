const metaEl = document.querySelector("#rules-meta");
const sectionsEl = document.querySelector("#rules-sections");
const titleEl = document.querySelector("#rules-title");
const subtitleEl = document.querySelector("#rules-subtitle");
const contentEl = document.querySelector("#rules-content");
const themeToggleEl = document.querySelector("#theme-toggle");
const sourceSelectEl = document.querySelector("#rules-source-select");
const workspaceEl = document.querySelector(".rules-workspace");

let payloadBySource = new Map();
let currentSourceKey = "";

const RULES_OUTLINE_ITEMS = [
  {
    title: "Core Concepts",
    pages: "PG 5-9",
    description: "An introduction to the essential rules terms and concepts that underpin every Warhammer 40,000 battle.",
    targets: ["coreconcepts"],
  },
  {
    title: "The Battle Round",
    pages: "PG 10-36",
    description:
      "From manoeuvring your army to unleashing thunderous firepower and brutal assaults, the action in Warhammer 40,000 unfolds in rounds in which each player takes a turn.",
    targets: ["thebattleround"],
  },
  {
    title: "Datasheets And Unit Abilities",
    pages: "PG 37-39",
    description:
      "Every Warhammer 40,000 unit has a datasheet, reflecting the characteristics and abilities they can draw upon in battle.",
    targets: ["datasheetsandunitabilities", "datasheets"],
  },
  {
    title: "Strategic Reserves And Stratagems",
    pages: "PG 41-43",
    description:
      "From well-timed Strategic Reserves to deftly executed Stratagems, gifted generals make use of all the tactical advantages at their disposal.",
    targets: ["strategicreservesandstratagems", "strategicreserves", "stratagems"],
  },
  {
    title: "Terrain Features",
    pages: "PG 44-52",
    description:
      "Warhammer 40,000 battles are fought across all manner of grim and perilous landscapes, from ruins to wreckage and obstacles your forces must navigate.",
    targets: ["terrainfeatures"],
  },
  {
    title: "Muster Your Army",
    pages: "PG 55-56",
    description:
      "Use these steps before battle to organise your warriors and war machines into a formidable fighting force.",
    targets: ["musteryourarmy"],
  },
  {
    title: "Missions",
    pages: "PG 57-60",
    description:
      "Before committing your forces to war, establish your strategic goals and the battlefield to be fought over.",
    targets: ["missions"],
  },
];

const RULES_GUIDE_ITEMS = [
  {
    title: "Abilities",
    iconClass: "guide-icon-abilities",
    description:
      "Many unit rules reference Core abilities by name. In datasheets, click a highlighted keyword to open its full Core Rules definition.",
  },
  {
    title: "Hints And Tips",
    iconClass: "guide-icon-hints",
    description:
      "Hints and Tips are practical recommendations. They are advice for smoother play, not mandatory rules text.",
  },
  {
    title: "Summaries",
    iconClass: "guide-icon-summary",
    description:
      "Bullet summaries are quick references. If there is any conflict or doubt, the full rule paragraph has priority.",
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeRuleKey(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function formatUtc(dateLike) {
  const dt = new Date(dateLike);
  if (Number.isNaN(dt.valueOf())) return "unknown";
  return dt.toLocaleString("en-GB", { timeZone: "UTC" }) + " UTC";
}

function renderBattleRoundPhases() {
  const phases = [
    { num: 1, name: "Command Phase", icon: "✹" },
    { num: 2, name: "Movement Phase", icon: "⇅" },
    { num: 3, name: "Shooting Phase", icon: "◎" },
    { num: 4, name: "Charge Phase", icon: "⟰" },
    { num: 5, name: "Fight Phase", icon: "⚔" },
  ];

  return `<div class="phase-ribbon-list">${phases
    .map(
      (phase) => `<div class="phase-ribbon-item">
        <span class="phase-ribbon-num">${phase.num}</span>
        <span class="phase-ribbon-name">${escapeHtml(phase.name)}</span>
        <span class="phase-ribbon-icon-wrap"><span class="phase-ribbon-icon">${escapeHtml(phase.icon)}</span></span>
      </div>`
    )
    .join("")}</div>`;
}

function renderDieFace(value) {
  const face = Number(value);
  const pips = [];
  if ([2, 3, 4, 5, 6].includes(face)) pips.push("tl");
  if ([4, 5, 6].includes(face)) pips.push("tr");
  if ([6].includes(face)) pips.push("ml", "mr");
  if ([1, 3, 5].includes(face)) pips.push("c");
  if ([2, 3, 4, 5, 6].includes(face)) pips.push("br");
  if ([4, 5, 6].includes(face)) pips.push("bl");

  return `<span class="dice-face" aria-label="D6 result ${face}">
    ${pips.map((pip) => `<span class="pip pip-${pip}"></span>`).join("")}
  </span>`;
}

function renderRollingD3Table() {
  const rows = [
    { faces: [1, 2], result: 1 },
    { faces: [3, 4], result: 2 },
    { faces: [5, 6], result: 3 },
  ];
  return `<section class="rules-ref-card" aria-label="Rolling a D3">
    <h4 class="rules-ref-title">Rolling A D3</h4>
    <table class="rules-d3-table">
      <thead>
        <tr><th>Dice Result</th><th>D3 Result</th></tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
            <td><span class="dice-pair">${renderDieFace(row.faces[0])}<span class="dice-or">or</span>${renderDieFace(
              row.faces[1]
            )}</span></td>
            <td class="d3-result">${row.result}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </section>`;
}

function renderSectionReferenceBlocks(sectionKey, hasRerollsSection) {
  if (sectionKey === "rerolls") {
    return renderRollingD3Table();
  }
  if (!hasRerollsSection && sectionKey === "coreconcepts") {
    return renderRollingD3Table();
  }
  return "";
}

function renderRulesOutline(sections) {
  const sectionMap = new Map(
    sections.map((section, index) => [normalizeRuleKey(section?.title || `section-${index}`), `rule-sec-${index}`])
  );

  const itemsHtml = RULES_OUTLINE_ITEMS.map((item) => {
    const targetId = item.targets.map((key) => sectionMap.get(key)).find(Boolean) || "";
    const targetAttr = targetId ? ` data-target="${escapeHtml(targetId)}"` : "";
    const clickableClass = targetId ? " outline-linkable" : "";

    return `<article class="rules-outline-item${clickableClass}"${targetAttr}>
      <h4 class="rules-outline-title">${escapeHtml(item.title)} <span class="rules-outline-pages">(${escapeHtml(item.pages)})</span></h4>
      <p class="rules-outline-desc">${escapeHtml(item.description)}</p>
    </article>`;
  }).join("");

  return `<section class="rules-outline" aria-label="Core rules contents">
    ${itemsHtml}
  </section>`;
}

function renderRulesGuide() {
  return `<section class="rules-guide" aria-label="How to use these rules">
    ${RULES_GUIDE_ITEMS.map(
      (item) => `<article class="rules-guide-item">
      <div class="rules-guide-head">
        <span class="rules-guide-icon ${escapeHtml(item.iconClass)}" aria-hidden="true"></span>
        <h4 class="rules-guide-title">${escapeHtml(item.title)}</h4>
      </div>
      <p class="rules-guide-desc">${escapeHtml(item.description)}</p>
    </article>`
    ).join("")}
  </section>`;
}

function splitSectionBlocks(blocks) {
  const parsed = [];
  let firstParagraphUsedAsIntro = false;

  for (const block of blocks || []) {
    const text = String(block?.text || "").trim();
    if (!text) continue;

    if (block.type === "bullet") {
      const value = text.replace(/^[-\u2022]\s*/, "").trim();
      if (!parsed.length || parsed[parsed.length - 1].type !== "points") {
        parsed.push({ type: "points", items: [] });
      }
      parsed[parsed.length - 1].items.push(value);
      continue;
    }

    if (block.type === "heading") {
      parsed.push({ type: "subheading", text });
      continue;
    }

    if (/^[A-Z0-9][A-Z0-9 \-–—':,/()]+$/.test(text) && text.length <= 64 && text.split(" ").length <= 8) {
      parsed.push({ type: "subheading", text });
      continue;
    }

    if (!firstParagraphUsedAsIntro && text.length < 220) {
      parsed.push({ type: "intro", text });
      firstParagraphUsedAsIntro = true;
    } else {
      parsed.push({ type: "paragraph", text });
    }
  }

  return parsed;
}

function getCurrentPayload() {
  return payloadBySource.get(currentSourceKey) || null;
}

function renderMeta() {
  const payload = getCurrentPayload();
  if (!payload) {
    metaEl.innerHTML = '<span class="note">No rules source loaded.</span>';
    return;
  }
  const count = payload.sections?.length || 0;
  const format = payload.format ? `<br><strong>Format:</strong> ${escapeHtml(String(payload.format))}` : "";
  metaEl.innerHTML = `<strong>Source:</strong> ${escapeHtml(payload.source || "Wahapedia Core Rules")}
    <br><strong>Sections:</strong> ${count}
    <br><strong>Updated:</strong> ${escapeHtml(formatUtc(payload.updated_at_utc))}${format}`;
}

function renderSectionsNav() {
  const payload = getCurrentPayload();
  if (!payload) {
    sectionsEl.innerHTML = "";
    return;
  }
  const sections = payload.sections || [];
  sectionsEl.innerHTML = sections
    .map((section, index) => {
      const label = section.title || `Section ${index + 1}`;
      return `<button class="unit-btn" data-target="rule-sec-${index}">${escapeHtml(label)}</button>`;
    })
    .join("");

  for (const button of sectionsEl.querySelectorAll(".unit-btn")) {
    button.addEventListener("click", () => {
      const targetId = button.dataset.target;
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function renderAllSections() {
  const payload = getCurrentPayload();
  if (!payload) {
    titleEl.textContent = "Core Rules";
    subtitleEl.textContent = "";
    contentEl.innerHTML = '<p class="note">No rules source loaded.</p>';
    return;
  }
  const sections = payload.sections || [];

  if (!sections.length) {
    titleEl.textContent = payload.page_title || "Core Rules";
    subtitleEl.textContent = "No sections found";
    contentEl.innerHTML = '<p class="note">No rules data. Run the sync workflow.</p>';
    return;
  }

  titleEl.textContent = payload.page_title || "Core Rules";
  subtitleEl.textContent = payload.source_url || "";
  const guideHtml = currentSourceKey === "pdf" ? renderRulesGuide() : "";
  const outlineHtml = currentSourceKey === "pdf" ? renderRulesOutline(sections) : "";
  const hasRerollsSection = sections.some((section) => normalizeRuleKey(section?.title || "") === "rerolls");
  contentEl.innerHTML = `${guideHtml}${outlineHtml}<div class="rules-doc">${sections
    .map((section, index) => {
      const title = section.title || `Section ${index + 1}`;
      const sectionKey = normalizeRuleKey(title);
      const blocks = splitSectionBlocks(section.blocks || []);
      const inner = blocks
        .map((block) => {
          if (block.type === "subheading") return `<h4 class="rule-subheading">${escapeHtml(block.text)}</h4>`;
          if (block.type === "intro") return `<p class="rule-intro">${escapeHtml(block.text)}</p>`;
          if (block.type === "paragraph") return `<p class="rule-paragraph">${escapeHtml(block.text)}</p>`;
          if (block.type === "points") {
            return `<ul class="keyword-tooltip-points">${block.items
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("")}</ul>`;
          }
          return "";
        })
        .join("");
      const phaseRibbons = sectionKey === "thebattleround" ? renderBattleRoundPhases() : "";
      const referenceBlocks = renderSectionReferenceBlocks(sectionKey, hasRerollsSection);
      return `<section id="rule-sec-${index}" class="rule-doc-section">
        <h3 class="rule-doc-title"><span class="rule-doc-index">${index + 1}.</span> ${escapeHtml(title)}</h3>
        ${inner}
        ${phaseRibbons}
        ${referenceBlocks}
      </section>`;
    })
    .join("")}</div>`;

  for (const item of contentEl.querySelectorAll(".rules-outline-item[data-target]")) {
    item.addEventListener("click", () => {
      const targetId = item.getAttribute("data-target");
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
}

function renderCurrentSource() {
  if (workspaceEl) workspaceEl.classList.remove("pdf-mode");
  renderMeta();
  renderSectionsNav();
  renderAllSections();
}

function populateSourceSelect() {
  if (!sourceSelectEl) return;
  const options = [...payloadBySource.entries()].map(([key, payload]) => {
    let label = "Core Rules";
    if (key === "pdf") label = "Core Rules (PDF Normalized)";
    else if (key === "wahapedia") label = "Core Rules (Wahapedia)";
    const count = payload?.sections?.length || 0;
    return `<option value="${escapeHtml(key)}">${escapeHtml(label)} - ${count} sections</option>`;
  });
  sourceSelectEl.innerHTML = options.join("");
  sourceSelectEl.value = currentSourceKey;
}

async function loadRulesPayload(fileName) {
  const response = await fetch(`./data/${fileName}`, { cache: "no-store" });
  if (!response.ok) return null;
  return response.json();
}

async function init() {
  payloadBySource = new Map();

  const wahapediaPayload = await loadRulesPayload("core_rules.json");
  if (wahapediaPayload) payloadBySource.set("wahapedia", wahapediaPayload);

  const pdfPayload = await loadRulesPayload("core_rules_pdf.json");
  if (pdfPayload) payloadBySource.set("pdf", pdfPayload);

  if (!payloadBySource.size) {
    throw new Error("Cannot load core rules sources.");
  }

  if (payloadBySource.has("pdf")) currentSourceKey = "pdf";
  else currentSourceKey = payloadBySource.keys().next().value;
  populateSourceSelect();
  renderCurrentSource();

  if (sourceSelectEl) {
    sourceSelectEl.addEventListener("change", () => {
      const nextKey = sourceSelectEl.value;
      if (!payloadBySource.has(nextKey)) return;
      currentSourceKey = nextKey;
      renderCurrentSource();
    });
  }
}

initThemeToggle();

init().catch((error) => {
  metaEl.textContent = `Rules loading error: ${error.message}`;
});
