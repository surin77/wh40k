const metaEl = document.querySelector("#rules-meta");
const sectionsEl = document.querySelector("#rules-sections");
const titleEl = document.querySelector("#rules-title");
const subtitleEl = document.querySelector("#rules-subtitle");
const contentEl = document.querySelector("#rules-content");

let payload = null;
let activeSection = 0;

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

function renderMeta() {
  const count = payload.sections?.length || 0;
  metaEl.innerHTML = `<strong>Источник:</strong> ${escapeHtml(payload.source || "Wahapedia Core Rules")}
    <br><strong>Секции:</strong> ${count}
    <br><strong>Обновлено:</strong> ${escapeHtml(formatUtc(payload.updated_at_utc))}`;
}

function renderSections() {
  const sections = payload.sections || [];
  sectionsEl.innerHTML = sections
    .map((section, index) => {
      const active = index === activeSection ? "active" : "";
      return `<button class="unit-btn ${active}" data-index="${index}">${escapeHtml(section.title || `Section ${index + 1}`)}</button>`;
    })
    .join("");

  for (const button of sectionsEl.querySelectorAll(".unit-btn")) {
    button.addEventListener("click", () => {
      activeSection = Number(button.dataset.index || "0");
      renderSections();
      renderContent();
    });
  }
}

function renderContent() {
  const sections = payload.sections || [];
  const section = sections[activeSection] || null;

  if (!section) {
    titleEl.textContent = payload.page_title || "Core Rules";
    subtitleEl.textContent = "Секции не найдены";
    contentEl.innerHTML = '<p class="note">Нет данных правил. Запустите sync workflow.</p>';
    return;
  }

  titleEl.textContent = section.title || payload.page_title || "Core Rules";
  subtitleEl.textContent = payload.source_url || "";

  const blocks = section.blocks || [];
  contentEl.innerHTML = blocks
    .map((block) => {
      if (block.type === "bullet") {
        return `<p class="rule-bullet">${escapeHtml(block.text)}</p>`;
      }
      if (block.type === "heading") {
        return `<h3 class="rule-heading">${escapeHtml(block.text)}</h3>`;
      }
      return `<p class="rule-paragraph">${escapeHtml(block.text)}</p>`;
    })
    .join("");
}

async function init() {
  const response = await fetch("./data/core_rules.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Cannot load core_rules.json: ${response.status}`);
  }

  payload = await response.json();
  renderMeta();
  renderSections();
  renderContent();
}

init().catch((error) => {
  metaEl.textContent = `Ошибка загрузки правил: ${error.message}`;
});
