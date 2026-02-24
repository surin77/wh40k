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

function normalizeBlockText(value) {
  return String(value || "")
    .replaceAll("\u00a0", " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/([(\[])\s+/g, "$1")
    .replace(/\s+([)\]])/g, "$1")
    .trim();
}

function shouldMergeContinuation(prevText, nextText) {
  const prev = String(prevText || "").trim();
  const next = String(nextText || "").trim();
  if (!prev || !next) return false;
  if (/:$/.test(prev)) return true;
  if (!/[.!?]$/.test(prev)) return true;
  if (/^[,.;:)\]]/.test(next)) return true;
  if (/^[a-z]/.test(next)) return true;
  if (
    /^(and|or|but|if|when|while|then|that|which|with|without|within|to|of|for|in|on|at|from|as|because|before|after|unless)\b/i.test(
      next
    )
  ) {
    return true;
  }
  return false;
}

function splitLongParagraph(text, maxLen = 320) {
  const clean = normalizeBlockText(text);
  if (clean.length <= maxLen) return [clean];
  const sentences = clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/g).filter(Boolean);
  if (sentences.length <= 1) return [clean];

  const chunks = [];
  let current = "";
  for (const sentence of sentences) {
    if (!current) {
      current = sentence;
      continue;
    }
    if ((current + " " + sentence).length <= maxLen || current.length < 160) {
      current += " " + sentence;
    } else {
      chunks.push(current);
      current = sentence;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function preprocessSectionBlocks(blocks) {
  const merged = [];
  for (const rawBlock of blocks || []) {
    const type = rawBlock?.type === "bullet" ? "bullet" : rawBlock?.type === "heading" ? "heading" : "paragraph";
    const text = normalizeBlockText(rawBlock?.text || "");
    if (!text) continue;
    if (/^CORE RULES\s*\|/i.test(text)) continue;
    if (/^\d+$/.test(text)) continue;

    const prev = merged[merged.length - 1];
    if (prev) {
      const mergeBulletContinuation =
        prev.type === "bullet" &&
        type === "paragraph" &&
        (!/[.!?]$/.test(prev.text) || prev.text.split(" ").length <= 8 || /^[A-Z][a-z]+ [a-z]/.test(text));
      if (mergeBulletContinuation) {
        prev.text = normalizeBlockText(`${prev.text} ${text}`);
        continue;
      }
      if (prev.type === type && (type === "paragraph" || type === "bullet") && shouldMergeContinuation(prev.text, text)) {
        prev.text = normalizeBlockText(`${prev.text} ${text}`);
        continue;
      }
    }
    merged.push({ type, text });
  }
  return merged;
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

function renderHitRollTable() {
  return `<section class="rules-ref-card" aria-label="Hit roll quick reference">
    <h4 class="rules-ref-title">Hit Roll Quick Reference</h4>
    <table class="rules-d3-table rules-hit-table">
      <thead>
        <tr><th>D6 Result</th><th>Outcome</th></tr>
      </thead>
      <tbody>
        <tr>
          <td><span class="dice-pair">${renderDieFace(1)}</span></td>
          <td>Always fails</td>
        </tr>
        <tr>
          <td><span class="rules-range-pill">2-5</span></td>
          <td>Compare with BS / WS of the attack</td>
        </tr>
        <tr>
          <td><span class="dice-pair">${renderDieFace(6)}</span></td>
          <td>Critical Hit (always successful)</td>
        </tr>
      </tbody>
    </table>
  </section>`;
}

function renderWoundRollTable() {
  const rows = [
    ["Strength is at least double Toughness", "2+"],
    ["Strength is greater than Toughness", "3+"],
    ["Strength equals Toughness", "4+"],
    ["Strength is lower than Toughness", "5+"],
    ["Strength is at most half Toughness", "6+"],
  ];

  return `<section class="rules-ref-card" aria-label="Wound roll table">
    <h4 class="rules-ref-title">Wound Roll Table</h4>
    <table class="rules-d3-table rules-wound-table">
      <thead>
        <tr><th>Strength vs Toughness</th><th>Required Roll</th></tr>
      </thead>
      <tbody>
        ${rows
          .map(
            ([relation, roll]) => `<tr>
            <td>${escapeHtml(relation)}</td>
            <td><span class="rules-roll-badge">${escapeHtml(roll)}</span></td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  </section>`;
}

function renderSummaryPointsCard(points, title = "Summary") {
  const items = (points || []).map((x) => String(x || "").trim()).filter(Boolean);
  if (!items.length) return "";
  return `<section class="rules-summary-card" aria-label="${escapeHtml(title)}">
    <h4 class="rules-summary-title">${escapeHtml(title)}</h4>
    <ul class="rules-summary-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  </section>`;
}

function renderSectionReferenceBlocks(section, sectionKey, hasRerollsSection) {
  const summaryPoints = Array.isArray(section?.summary_points) ? section.summary_points : [];
  let html = "";
  if (sectionKey === "1hitroll" || sectionKey === "hitroll") {
    html += renderHitRollTable();
  }
  if (sectionKey === "2woundroll" || sectionKey === "woundroll") {
    html += renderWoundRollTable();
  }
  if (sectionKey === "rerolls") {
    html += renderRollingD3Table();
  }
  if (!hasRerollsSection && sectionKey === "coreconcepts") {
    html += renderRollingD3Table();
  }
  if (summaryPoints.length) {
    const summaryTitle = sectionKey.includes("chargingwithaunit") ? "Charge Summary" : "Summary";
    html += renderSummaryPointsCard(summaryPoints, summaryTitle);
  }
  return html;
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

function splitSectionBlocks(blocks, options = {}) {
  const suppressBullets = Boolean(options?.suppressBullets);
  const preparedBlocks = preprocessSectionBlocks(blocks);
  const parsed = [];
  let firstParagraphUsedAsIntro = false;

  for (const block of preparedBlocks) {
    const text = String(block?.text || "").trim();
    if (!text) continue;

    if (block.type === "bullet") {
      if (suppressBullets) continue;
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

    const chunks = splitLongParagraph(text);
    for (const chunk of chunks) {
      const keyline = chunk.match(/^([A-Z][A-Za-z0-9 '"()\/+\-]{2,54}):\s+(.+)$/);
      if (keyline && keyline[2].length <= 220) {
        parsed.push({ type: "keyline", label: keyline[1], text: keyline[2] });
        continue;
      }
      if (!firstParagraphUsedAsIntro && chunk.length < 220) {
        parsed.push({ type: "intro", text: chunk });
        firstParagraphUsedAsIntro = true;
      } else {
        parsed.push({ type: "paragraph", text: chunk });
      }
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
      const hasSummaryPoints = Array.isArray(section.summary_points) && section.summary_points.length > 0;
      const blocks = splitSectionBlocks(section.blocks || [], { suppressBullets: hasSummaryPoints });
      const inner = blocks
        .map((block) => {
          if (block.type === "subheading") return `<h4 class="rule-subheading">${escapeHtml(block.text)}</h4>`;
          if (block.type === "intro") return `<p class="rule-intro">${escapeHtml(block.text)}</p>`;
          if (block.type === "paragraph") return `<p class="rule-paragraph">${escapeHtml(block.text)}</p>`;
          if (block.type === "keyline") {
            return `<p class="rule-keyline"><span class="rule-keyline-label">${escapeHtml(block.label)}:</span> ${escapeHtml(
              block.text
            )}</p>`;
          }
          if (block.type === "points") {
            return `<ul class="rule-points">${block.items
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("")}</ul>`;
          }
          return "";
        })
        .join("");
      const phaseRibbons = sectionKey === "thebattleround" ? renderBattleRoundPhases() : "";
      const referenceBlocks = renderSectionReferenceBlocks(section, sectionKey, hasRerollsSection);
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
