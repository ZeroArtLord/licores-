const convCategoriaSelectEl = document.getElementById("conv-categoria");
const convCategoriaTragosEl = document.getElementById("conv-categoria-tragos");
const convCategoriaAddBtn = document.getElementById("conv-categoria-add");
const convCategoriaListEl = document.getElementById("conv-categoria-list");
const convProductoInputEl = document.getElementById("conv-producto");
const convProductoTragosEl = document.getElementById("conv-producto-tragos");
const convProductoAddBtn = document.getElementById("conv-producto-add");
const convProductoListEl = document.getElementById("conv-producto-list");
const convBuscarEl = document.getElementById("conv-buscar");
const convOrdenEl = document.getElementById("conv-orden");
const convFiltroCategoriaEl = document.getElementById("conv-filtro-categoria");
const convStatusEl = document.getElementById("conv-status");

const CONVERSIONES_KEY = "conversiones";
let conversiones = { categorias: {}, productos: {} };
let categorias = {};
let catalogo = [];

function normalizeKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function setConvStatus(message, isError = false) {
  if (!convStatusEl) return;
  convStatusEl.textContent = message;
  convStatusEl.style.color = isError ? "#9b2c2c" : "#6b6b6b";
}

function loadConversiones() {
  try {
    const raw = localStorage.getItem(CONVERSIONES_KEY);
    conversiones = raw ? JSON.parse(raw) : { categorias: {}, productos: {} };
  } catch (_) {
    conversiones = { categorias: {}, productos: {} };
  }
}

function saveConversiones() {
  localStorage.setItem(CONVERSIONES_KEY, JSON.stringify(conversiones));
  fetch("/conversiones/guardar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(conversiones),
  }).catch(() => {});
}

function buildCategoriaIndex() {
  const map = new Map();
  for (const [cat, keys] of Object.entries(categorias || {})) {
    for (const key of keys || []) {
      map.set(normalizeKey(key), cat);
    }
  }
  return map;
}

function renderCategoriasSelect() {
  if (!convCategoriaSelectEl) return;
  convCategoriaSelectEl.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Sin categoria";
  convCategoriaSelectEl.appendChild(empty);
  const cats = Object.keys(categorias || {}).sort((a, b) => a.localeCompare(b));
  for (const cat of cats) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    convCategoriaSelectEl.appendChild(opt);
  }

  if (convFiltroCategoriaEl) {
    convFiltroCategoriaEl.innerHTML = "";
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Todas las categorias";
    convFiltroCategoriaEl.appendChild(optAll);
    for (const cat of cats) {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      convFiltroCategoriaEl.appendChild(opt);
    }
  }
}

function renderCategoriaRules() {
  if (!convCategoriaListEl) return;
  convCategoriaListEl.innerHTML = "";
  const keys = Object.keys(conversiones.categorias || {}).sort((a, b) =>
    a.localeCompare(b)
  );
  if (keys.length === 0) {
    convCategoriaListEl.textContent = "Sin reglas";
    return;
  }
  for (const cat of keys) {
    const row = document.createElement("div");
    row.className = "rule-row";
    row.innerHTML = `
      <span>${cat}</span>
      <span>${conversiones.categorias[cat]} tragos</span>
      <button class="ghost-btn" type="button">Eliminar</button>
    `;
    row.querySelector("button").addEventListener("click", () => {
      delete conversiones.categorias[cat];
      saveConversiones();
      renderCategoriaRules();
      renderProductosList();
    });
    convCategoriaListEl.appendChild(row);
  }
}

function renderProductosList() {
  if (!convProductoListEl) return;
  convProductoListEl.innerHTML = "";
  const search = normalizeKey(convBuscarEl?.value || "");
  const order = convOrdenEl?.value || "categoria";
  const filtroCat = convFiltroCategoriaEl?.value || "";
  const catIndex = buildCategoriaIndex();

  let base = catalogo && catalogo.length > 0 ? catalogo : Object.keys(conversiones.productos || {});
  let items = base.map((p) => {
    const key = normalizeKey(p);
    const cat = catIndex.get(key) || "SIN CATEGORIA";
    return { producto: p, key, categoria: cat };
  });

  if (search) {
    items = items.filter((it) => it.key.includes(search));
  }
  if (filtroCat) {
    items = items.filter((it) => it.categoria === filtroCat);
  }

  if (order === "alfabetico") {
    items.sort((a, b) => a.producto.localeCompare(b.producto));
  } else {
    items.sort((a, b) => {
      const c = a.categoria.localeCompare(b.categoria);
      if (c !== 0) return c;
      return a.producto.localeCompare(b.producto);
    });
  }

  if (items.length === 0) {
    convProductoListEl.innerHTML = `
      <tr><td colspan="4">Sin resultados</td></tr>
    `;
    return;
  }

  let lastCategory = null;
  for (const item of items) {
    if (order === "categoria" && item.categoria !== lastCategory) {
      lastCategory = item.categoria;
      const head = document.createElement("tr");
      head.className = "conv-category-row";
      head.innerHTML = `<td colspan="4">${item.categoria}</td>`;
      convProductoListEl.appendChild(head);
    }

    const rule = conversiones.productos[item.key];
    const catRule = conversiones.categorias[normalizeKey(item.categoria)];
    const displayRule = rule ?? catRule ?? "";
    const row = document.createElement("tr");
    row.className = "conv-product-row";
    row.innerHTML = `
      <td title="${item.producto}">${item.producto}</td>
      <td>${item.categoria}</td>
      <td><input class="rule-input" type="number" min="1" step="1" value="${displayRule}" placeholder="Tragos" /></td>
      <td class="no-print"><button class="secondary-btn" type="button">Guardar</button></td>
    `;
    const input = row.querySelector("input");
    const btn = row.querySelector("button");
    btn.addEventListener("click", () => {
      const val = Number(input.value || 0);
      if (!val || val <= 0) {
        delete conversiones.productos[item.key];
      } else {
        conversiones.productos[item.key] = val;
      }
      saveConversiones();
      setConvStatus("Producto guardado.");
      renderProductosList();
    });
    convProductoListEl.appendChild(row);
  }
}

loadConversiones();

fetch("/conversiones")
  .then((r) => r.json())
  .then((data) => {
    if (data && typeof data === "object") {
      conversiones = {
        categorias: data.categorias || {},
        productos: data.productos || {},
      };
      saveConversiones();
      renderCategoriaRules();
      renderProductosList();
    }
  })
  .catch(() => {});

fetch("/categorias")
  .then((r) => r.json())
  .then((data) => {
    categorias = data?.categorias || {};
    renderCategoriasSelect();
    renderCategoriaRules();
    renderProductosList();
  })
  .catch(() => {});

fetch("/catalogo")
  .then((r) => r.json())
  .then((data) => {
    catalogo = data?.items || [];
    renderProductosList();
  })
  .catch(() => {});

if (convCategoriaAddBtn) {
  convCategoriaAddBtn.addEventListener("click", () => {
    const cat = String(convCategoriaSelectEl.value || "").trim();
    const val = Number(convCategoriaTragosEl.value || 0);
    if (!cat) {
      setConvStatus("Selecciona una categoria.", true);
      return;
    }
    if (!val || val <= 0) {
      setConvStatus("Ingresa un numero valido.", true);
      return;
    }
    conversiones.categorias[normalizeKey(cat)] = val;
    saveConversiones();
    renderCategoriaRules();
    renderProductosList();
    setConvStatus("Categoria guardada.");
  });
}

if (convProductoAddBtn) {
  convProductoAddBtn.addEventListener("click", () => {
    const prod = String(convProductoInputEl.value || "").trim();
    const val = Number(convProductoTragosEl.value || 0);
    if (!prod) {
      setConvStatus("Ingresa un producto.", true);
      return;
    }
    if (!val || val <= 0) {
      setConvStatus("Ingresa un numero valido.", true);
      return;
    }
    conversiones.productos[normalizeKey(prod)] = val;
    convProductoInputEl.value = "";
    convProductoTragosEl.value = "";
    saveConversiones();
    renderProductosList();
    setConvStatus("Producto guardado.");
  });
}

if (convBuscarEl) {
  convBuscarEl.addEventListener("input", () => {
    renderProductosList();
  });
}

if (convOrdenEl) {
  convOrdenEl.addEventListener("change", () => {
    renderProductosList();
  });
}

if (convFiltroCategoriaEl) {
  convFiltroCategoriaEl.addEventListener("change", () => {
    renderProductosList();
  });
}
