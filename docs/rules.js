const metaEl = document.querySelector("#rules-meta");
const sectionsEl = document.querySelector("#rules-sections");
const titleEl = document.querySelector("#rules-title");
const subtitleEl = document.querySelector("#rules-subtitle");
const contentEl = document.querySelector("#rules-content");

let payload = null;

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

function renderMeta() {
  const count = payload.sections?.length || 0;
  metaEl.innerHTML = `<strong>Источник:</strong> ${escapeHtml(payload.source || "Wahapedia Core Rules")}
    <br><strong>Секции:</strong> ${count}
    <br><strong>Обновлено:</strong> ${escapeHtml(formatUtc(payload.updated_at_utc))}`;
}

function renderSectionsNav() {
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
  const sections = payload.sections || [];

  if (!sections.length) {
    titleEl.textContent = payload.page_title || "Core Rules";
    subtitleEl.textContent = "Секции не найдены";
    contentEl.innerHTML = '<p class="note">Нет данных правил. Запустите sync workflow.</p>';
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

async function init() {
  const response = await fetch("./data/core_rules.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Cannot load core_rules.json: ${response.status}`);
  }

  payload = await response.json();
  renderMeta();
  renderSectionsNav();
  renderAllSections();
}

init().catch((error) => {
  metaEl.textContent = `Ошибка загрузки правил: ${error.message}`;
});
