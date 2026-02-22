const metaEl = document.querySelector("#meta");
const selectEl = document.querySelector("#dataset-select");
const searchEl = document.querySelector("#search-input");
const reloadBtn = document.querySelector("#reload-button");
const tableHead = document.querySelector("#data-table thead");
const tableBody = document.querySelector("#data-table tbody");

let indexData = null;
let activeRows = [];
let activeHeaders = [];

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
  const changed = indexData.changed_files?.length
    ? indexData.changed_files.join(", ")
    : "изменений нет";
  metaEl.innerHTML = `
    <strong>Источник:</strong> ${escapeHtml(indexData.source)}<br />
    <strong>Последняя проверка:</strong> ${escapeHtml(formatUtc(indexData.updated_at_utc))}<br />
    <strong>Файлы с изменениями:</strong> ${escapeHtml(changed)}
  `;
}

function renderTable(rows, headers) {
  tableHead.innerHTML = "";
  tableBody.innerHTML = "";

  if (!headers.length) {
    tableHead.innerHTML = "<tr><th>No columns</th></tr>";
    tableBody.innerHTML = "<tr><td>No data</td></tr>";
    return;
  }

  tableHead.innerHTML = `<tr>${headers
    .map((header) => `<th>${escapeHtml(header)}</th>`)
    .join("")}</tr>`;

  const fragment = document.createDocumentFragment();
  for (const row of rows.slice(0, 500)) {
    const tr = document.createElement("tr");
    tr.innerHTML = headers
      .map((header) => `<td>${escapeHtml(row[header] ?? "")}</td>`)
      .join("");
    fragment.appendChild(tr);
  }
  tableBody.appendChild(fragment);
}

function renderEmptyState(message) {
  tableHead.innerHTML = "<tr><th>Нет данных</th></tr>";
  tableBody.innerHTML = `<tr><td>${escapeHtml(message)}</td></tr>`;
}

function applyFilter() {
  const query = searchEl.value.trim().toLowerCase();
  if (!query) {
    renderTable(activeRows, activeHeaders);
    return;
  }

  const filtered = activeRows.filter((row) =>
    activeHeaders.some((header) =>
      String(row[header] ?? "").toLowerCase().includes(query)
    )
  );

  renderTable(filtered, activeHeaders);
}

async function loadCsv(fileName) {
  const response = await fetch(`./data/${encodeURIComponent(fileName)}`);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${fileName}: ${response.status}`);
  }
  const text = await response.text();

  const parsed = Papa.parse(text, {
    header: true,
    skipEmptyLines: true,
  });

  if (parsed.errors.length) {
    throw new Error(parsed.errors[0].message);
  }

  activeRows = parsed.data;
  activeHeaders = parsed.meta.fields ?? [];

  applyFilter();
}

async function loadIndexAndInit() {
  const response = await fetch("./data/index.json", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Cannot load data index: ${response.status}`);
  }

  indexData = await response.json();
  renderMeta();

  const files = Object.keys(indexData.files || {})
    .filter((name) => name.endsWith(".csv"))
    .sort((a, b) => a.localeCompare(b));

  if (!files.length) {
    renderEmptyState(
      "CSV еще не загружены. Запустите workflow Sync Wahapedia WH40k вручную в GitHub Actions."
    );
    return;
  }

  selectEl.innerHTML = files
    .map((file) => `<option value="${escapeHtml(file)}">${escapeHtml(file)}</option>`)
    .join("");

  if (files.length) {
    await loadCsv(files[0]);
  }
}

selectEl.addEventListener("change", () => {
  loadCsv(selectEl.value).catch((error) => {
    metaEl.textContent = `Ошибка загрузки таблицы: ${error.message}`;
  });
});

searchEl.addEventListener("input", applyFilter);

reloadBtn.addEventListener("click", () => {
  loadIndexAndInit().catch((error) => {
    metaEl.textContent = `Ошибка обновления: ${error.message}`;
  });
});

loadIndexAndInit().catch((error) => {
  metaEl.textContent = `Ошибка инициализации: ${error.message}`;
});
