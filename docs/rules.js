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
let hasOriginalPdf = false;
const ORIGINAL_PDF_URL = "./data/core_rules_full.pdf";

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

function formatUtc(dateLike) {
  const dt = new Date(dateLike);
  if (Number.isNaN(dt.valueOf())) return "unknown";
  return dt.toLocaleString("ru-RU", { timeZone: "UTC" }) + " UTC";
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
  if (currentSourceKey === "pdf_original") {
    metaEl.innerHTML = `<strong>Source:</strong> ${escapeHtml(payload.source || "Core Rules PDF")}
      <br><strong>Layout:</strong> Original PDF document
      <br><strong>Format:</strong> Embedded viewer`;
    return;
  }
  metaEl.innerHTML = `<strong>Source:</strong> ${escapeHtml(payload.source || "Wahapedia Core Rules")}
    <br><strong>Sections:</strong> ${count}
    <br><strong>Updated:</strong> ${escapeHtml(formatUtc(payload.updated_at_utc))}`;
}

function renderSectionsNav() {
  if (currentSourceKey === "pdf_original") {
    sectionsEl.innerHTML = `
      <a class="unit-btn" href="${ORIGINAL_PDF_URL}" target="_blank" rel="noopener noreferrer">
        Open PDF in new tab
      </a>
    `;
    return;
  }
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
  if (currentSourceKey === "pdf_original") {
    titleEl.textContent = "Core Rules (Original PDF)";
    subtitleEl.textContent = "Official PDF layout";
    contentEl.innerHTML = `
      <iframe
        class="rules-pdf-frame"
        src="${ORIGINAL_PDF_URL}#view=FitH"
        title="Warhammer 40,000 Core Rules PDF"
      ></iframe>
    `;
    return;
  }

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

  contentEl.innerHTML = `<div class="rules-grid">${sections
    .map((section, index) => {
      const blocks = splitSectionBlocks(section.blocks || []);
      const inner = blocks
        .map((block) => {
          if (block.type === "subheading") return `<h4 class="rule-heading">${escapeHtml(block.text)}</h4>`;
          if (block.type === "intro") return `<p class="rule-paragraph"><em>${escapeHtml(block.text)}</em></p>`;
          if (block.type === "paragraph") return `<p class="rule-paragraph">${escapeHtml(block.text)}</p>`;
          if (block.type === "points") {
            return `<ul class="keyword-tooltip-points">${block.items
              .map((item) => `<li>${escapeHtml(item)}</li>`)
              .join("")}</ul>`;
          }
          return "";
        })
        .join("");

      return `<section id="rule-sec-${index}" class="rule-card">
        <h3 class="rule-heading">${escapeHtml(section.title || `Section ${index + 1}`)}</h3>
        ${inner}
      </section>`;
    })
    .join("")}</div>`;
}

function renderCurrentSource() {
  if (workspaceEl) {
    workspaceEl.classList.toggle("pdf-mode", currentSourceKey === "pdf_original");
  }
  renderMeta();
  renderSectionsNav();
  renderAllSections();
}

function populateSourceSelect() {
  if (!sourceSelectEl) return;
  const options = [...payloadBySource.entries()].map(([key, payload]) => {
    let label = "Core Rules";
    if (key === "pdf_original") label = "Core Rules (PDF Original)";
    else if (key === "pdf") label = "Core Rules (PDF Parsed)";
    else if (key === "wahapedia") label = "Core Rules (Wahapedia)";
    const count = payload?.sections?.length || 0;
    if (key === "pdf_original") {
      return `<option value="${escapeHtml(key)}">${escapeHtml(label)}</option>`;
    }
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

async function hasPdfDocument() {
  try {
    const response = await fetch(ORIGINAL_PDF_URL, { method: "HEAD", cache: "no-store" });
    return response.ok;
  } catch {
    return false;
  }
}

async function init() {
  payloadBySource = new Map();
  hasOriginalPdf = await hasPdfDocument();

  if (hasOriginalPdf) {
    payloadBySource.set("pdf_original", {
      source: "Warhammer 40,000 Core Rules PDF",
      page_title: "Core Rules (Original PDF)",
      source_url: ORIGINAL_PDF_URL,
      sections: [],
    });
  }

  const wahapediaPayload = await loadRulesPayload("core_rules.json");
  if (wahapediaPayload) payloadBySource.set("wahapedia", wahapediaPayload);

  const pdfPayload = await loadRulesPayload("core_rules_pdf.json");
  if (pdfPayload) payloadBySource.set("pdf", pdfPayload);

  if (!payloadBySource.size) {
    throw new Error("Cannot load core rules sources.");
  }

  if (payloadBySource.has("pdf_original")) currentSourceKey = "pdf_original";
  else if (payloadBySource.has("pdf")) currentSourceKey = "pdf";
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
