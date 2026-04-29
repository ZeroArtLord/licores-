const API_URL = "/inventario";
const CACHE_KEY = "inventario_token";

const saintInput = document.getElementById("saint");
const cajaInput = document.getElementById("caja");
const barraInput = document.getElementById("barra");
const calcularBtn = document.getElementById("calcular");
const borrarCacheBtn = document.getElementById("borrar-cache");
const statusEl = document.getElementById("status");
const tablaFinalBody = document.querySelector("#tabla-final tbody");
const tablaOriginalBody = document.querySelector("#tabla-original tbody");
const guardarReglasBtn = document.getElementById("guardar-reglas");
const limpiarReglasBtn = document.getElementById("limpiar-reglas");
const deshacerCambiosBtn = document.getElementById("deshacer-cambios");
const resetearTodoBtn = document.getElementById("resetear-todo");
const statusReglasEl = document.getElementById("status-reglas");
const modoEdicionEl = document.getElementById("modo-edicion");
const ocultarIgnoradosEl = document.getElementById("ocultar-ignorados");
const nombreUnificadoEl = document.getElementById("nombre-unificado");
const aplicarUnificarBtn = document.getElementById("aplicar-unificar");
const deshacerSeleccionBtn = document.getElementById("deshacer-seleccion");
const listaPendientesEl = document.getElementById("lista-pendientes");
const verOriginalBtn = document.getElementById("ver-original");
const verFinalBtn = document.getElementById("ver-final");
const tablaOriginal = document.getElementById("tabla-original");
const tablaFinal = document.getElementById("tabla-final");
const listaGruposEl = document.getElementById("lista-grupos");
const accionesSeleccionEl = document.getElementById("acciones-seleccion");
const seleccionCountEl = document.getElementById("seleccion-count");
const unificarSeleccionBtn = document.getElementById("unificar-seleccion");
const limpiarSeleccionBtn = document.getElementById("limpiar-seleccion");
const csvRevisionInput = document.getElementById("csv-revision");
const listaCsvEl = document.getElementById("lista-csv");
const exportarPdfBtn = document.getElementById("exportar-pdf");
const categoriaSelectEl = document.getElementById("categoria-select");
const categoriaSelectBarEl = document.getElementById("categoria-select-bar");
const convCategoriaSelectEl = document.getElementById("conv-categoria");
const categoriaNuevaEl = document.getElementById("categoria-nueva");
const crearCategoriaBtn = document.getElementById("crear-categoria");
const asignarCategoriaBtn = document.getElementById("asignar-categoria");
const asignarCategoriaBarBtn = document.getElementById("asignar-categoria-bar");
const quitarCategoriaBtn = document.getElementById("quitar-categoria");
const quitarCategoriaBarBtn = document.getElementById("quitar-categoria-bar");
const listaCategoriasEl = document.getElementById("lista-categorias");
const categoriaFiltroEl = document.getElementById("categoria-filtro");
const notifPanelEl = document.getElementById("notif-panel");
const notifBellBtn = document.getElementById("notif-bell-btn");
const notifCloseBtn = document.getElementById("notif-close");
const notifCountEl = document.getElementById("notif-count");
const notifTextoEl = document.getElementById("notif-texto");
const verNuevosBtn = document.getElementById("ver-nuevos");
const verHistorialBtn = document.getElementById("ver-historial");
const ocultarNuevosBtn = document.getElementById("ocultar-nuevos");
const listaNuevosEl = document.getElementById("lista-nuevos");
const listaHistorialEl = document.getElementById("lista-historial");

const pendientesEquivalencias = new Map();
const pendientesIgnorar = new Set();
const seleccionados = new Map();
let grupoActual = 1;

let ultimoDetalle = null;
let baseOriginal = null;
let modoAgregarGrupo = null;
let displayNames = {};
let categorias = {};
let categoriaFiltro = "";
let mostrarNuevos = false;
let nuevosProductos = [];
let historialNuevos = [];
const undoStack = [];
let isUndoing = false;

const GROUP_CLASSES = ["group-1", "group-2", "group-3", "group-4", "group-5"];
const WINE_CUPS_PER_BOTTLE = 6;
const DISPLAY_KEY = "display_names";
const CATEGORIAS_KEY = "categorias";
const CONVERSIONES_KEY = "conversiones";

let conversiones = { categorias: {}, productos: {} };

function normalizeKey(value) {
  return String(value || "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

function renderNuevoBadge(flag) {
  return flag ? `<span class="badge-new">NUEVO</span>` : "";
}

function loadDisplayNames() {
  try {
    const raw = localStorage.getItem(DISPLAY_KEY);
    displayNames = raw ? JSON.parse(raw) : {};
  } catch (_) {
    displayNames = {};
  }
}

function saveDisplayNames() {
  localStorage.setItem(DISPLAY_KEY, JSON.stringify(displayNames));
}

function getDisplayName(key, fallback) {
  if (!key) return fallback;
  const value = displayNames[key];
  return value ? value : fallback;
}

function setDisplayName(key, value, record = true) {
  if (!key) return;
  if (record && !isUndoing) {
    const prev = displayNames[key] ?? "";
    undoStack.push({ type: "display", key, prev });
  }
  const cleaned = String(value || "").trim();
  if (!cleaned) {
    delete displayNames[key];
  } else {
    displayNames[key] = cleaned;
  }
  saveDisplayNames();
  aplicarCambiosVisuales();
}

function getNormalizedKeyForProducto(producto) {
  if (!producto) return "";
  const target = normalizeKey(producto);
  const found = (baseOriginal || []).find(
    (item) => normalizeKey(item.producto) === target
  );
  if (found) {
    return normalizeKey(found.normalizado || found.producto || producto);
  }
  return target;
}

function loadCategorias() {
  try {
    const raw = localStorage.getItem(CATEGORIAS_KEY);
    categorias = raw ? JSON.parse(raw) : {};
  } catch (_) {
    categorias = {};
  }
}

function saveCategorias() {
  localStorage.setItem(CATEGORIAS_KEY, JSON.stringify(categorias));
  fetch("/categorias/guardar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ categorias }),
  }).catch(() => {});
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

function setCategoriaForKeys(keys, categoria, record = true) {
  if (!keys || keys.length === 0) return;
  const cat = String(categoria || "").trim();
  if (!cat) return;
  if (record && !isUndoing) {
    const catIndex = buildCategoriaIndex();
    const prev = keys.map((k) => ({
      key: k,
      prevCat: catIndex.get(normalizeKey(k)) || "",
      newCat: cat,
    }));
    undoStack.push({ type: "categoria", items: prev });
  }
  for (const key of keys) {
    for (const [c, list] of Object.entries(categorias)) {
      categorias[c] = (list || []).filter((k) => k !== key);
    }
    if (!categorias[cat]) categorias[cat] = [];
    if (!categorias[cat].includes(key)) {
      categorias[cat].push(key);
    }
  }
  saveCategorias();
  renderCategoriasUI();
  aplicarCambiosVisuales();
}

function clearCategoriaForKeys(keys, record = true) {
  if (!keys || keys.length === 0) return;
  if (record && !isUndoing) {
    const catIndex = buildCategoriaIndex();
    const prev = keys.map((k) => ({
      key: k,
      prevCat: catIndex.get(normalizeKey(k)) || "",
      newCat: "",
    }));
    undoStack.push({ type: "categoria", items: prev });
  }
  for (const key of keys) {
    for (const [c, list] of Object.entries(categorias)) {
      categorias[c] = (list || []).filter((k) => k !== key);
    }
  }
  saveCategorias();
  renderCategoriasUI();
  aplicarCambiosVisuales();
}

function renderCategoriasUI() {
  if (!categoriaSelectEl || !listaCategoriasEl) return;
  const cats = Object.keys(categorias || {}).sort((a, b) => a.localeCompare(b));
  categoriaSelectEl.innerHTML = "";
  if (categoriaSelectBarEl) categoriaSelectBarEl.innerHTML = "";
  if (categoriaFiltroEl) categoriaFiltroEl.innerHTML = "";
  if (convCategoriaSelectEl) convCategoriaSelectEl.innerHTML = "";
  const empty = document.createElement("option");
  empty.value = "";
  empty.textContent = "Sin categoria";
  categoriaSelectEl.appendChild(empty);
  if (categoriaSelectBarEl) {
    const emptyBar = empty.cloneNode(true);
    categoriaSelectBarEl.appendChild(emptyBar);
  }
  if (categoriaFiltroEl) {
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = "Todas";
    categoriaFiltroEl.appendChild(optAll);
    const optNone = document.createElement("option");
    optNone.value = "__none__";
    optNone.textContent = "Solo sin categoria";
    categoriaFiltroEl.appendChild(optNone);
  }
  if (convCategoriaSelectEl) {
    const emptyConv = empty.cloneNode(true);
    convCategoriaSelectEl.appendChild(emptyConv);
  }
  for (const cat of cats) {
    const opt = document.createElement("option");
    opt.value = cat;
    opt.textContent = cat;
    categoriaSelectEl.appendChild(opt);
    if (categoriaSelectBarEl) {
      const optBar = opt.cloneNode(true);
      categoriaSelectBarEl.appendChild(optBar);
    }
    if (categoriaFiltroEl) {
      const optFilter = opt.cloneNode(true);
      categoriaFiltroEl.appendChild(optFilter);
    }
    if (convCategoriaSelectEl) {
      const optConv = opt.cloneNode(true);
      convCategoriaSelectEl.appendChild(optConv);
    }
  }
  listaCategoriasEl.innerHTML = "";
  if (cats.length === 0) {
    listaCategoriasEl.textContent = "Sin categorias";
    return;
  }
  for (const cat of cats) {
    const tag = document.createElement("span");
    tag.className = "category-tag";
    tag.textContent = `${cat} (${(categorias[cat] || []).length})`;
    listaCategoriasEl.appendChild(tag);
  }
}

function getTragosPorBotella(producto, categoria) {
  const prodKey = normalizeKey(producto);
  if (prodKey && conversiones.productos && conversiones.productos[prodKey]) {
    return Number(conversiones.productos[prodKey]);
  }
  const catKey = normalizeKey(categoria);
  if (catKey && conversiones.categorias && conversiones.categorias[catKey]) {
    return Number(conversiones.categorias[catKey]);
  }
  return null;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#9b2c2c" : "#6b6b6b";
}

function actualizarSeleccionUI() {
  const count = seleccionados.size;
  if (count > 0) {
    accionesSeleccionEl.classList.remove("hidden");
  } else {
    accionesSeleccionEl.classList.add("hidden");
  }
  seleccionCountEl.textContent = `${count} seleccionados`;
}

function limpiarTabla() {
  tablaFinalBody.innerHTML = "";
  tablaOriginalBody.innerHTML = "";
}

function renderFinal(items, gruposAll) {
  tablaFinalBody.innerHTML = "";
  if (!items || items.length === 0) {
    setStatus("No hay resultados para mostrar.");
    return;
  }

  const sorted = [...items].sort((a, b) =>
    (a.producto || "").localeCompare(b.producto || "")
  );
  const categoriaIndex = buildCategoriaIndex();
  const agrupado = new Map();
  for (const item of sorted) {
    const key = normalizeKey(item.producto);
    const cat = categoriaIndex.get(key) || "SIN CATEGORIA";
    if (!agrupado.has(cat)) agrupado.set(cat, []);
    agrupado.get(cat).push(item);
  }

  const categoriasOrdenadas = Array.from(agrupado.keys()).sort((a, b) =>
    a.localeCompare(b)
  );

  for (const categoria of categoriasOrdenadas) {
    const header = document.createElement("tr");
    header.className = "category-row";
    header.innerHTML = `
      <td colspan="4">${categoria}</td>
    `;
    tablaFinalBody.appendChild(header);

    for (const item of agrupado.get(categoria)) {
    const grupo =
      gruposAll && gruposAll[item.producto] ? gruposAll[item.producto] : [];
    const hasGroup = grupo.length > 0;
    const deposito = Number(item.deposito || 0);
    const caja = Number(item.caja || 0);
    const barra = Number(item.barra || 0);
    const totalBotellas = deposito + caja;
    const key = normalizeKey(item.producto);
    const displayName = getDisplayName(key, item.producto ?? "");
    const categoriaActual = normalizeKey(categoria || "SIN CATEGORIA");
    const esVinoCategoria =
      categoriaActual === "VINOS TINTOS" ||
      categoriaActual === "VINOS BLANCOS" ||
      categoriaActual.startsWith("VINO");
    const esVinoProducto = normalizeKey(item.producto || "").includes("VINO");
    const esVino = esVinoCategoria || esVinoProducto;
    const etiquetaBarra = esVino ? "COPAS" : "TRAGOS";
    let barraDisplay = `${barra} ${etiquetaBarra}`;
    const tragosPorBotella =
      getTragosPorBotella(item.producto, categoria) ??
      (esVino ? WINE_CUPS_PER_BOTTLE : null);
    if (tragosPorBotella && Number.isFinite(barra)) {
      const total = Math.max(0, Math.round(barra));
      const botellas = Math.floor(total / tragosPorBotella);
      const resto = total % tragosPorBotella;
      if (botellas > 0 && resto > 0) {
        barraDisplay = `${botellas} BOTELLAS + ${resto} ${etiquetaBarra}`;
      } else if (botellas > 0) {
        barraDisplay = `${botellas} BOTELLAS`;
      } else {
        barraDisplay = `${resto} ${etiquetaBarra}`;
      }
    }
    const row = document.createElement("tr");
    row.className = "group-row";
    row.innerHTML = `
      <td title="${item.producto ?? ""}">${displayName}</td>
      <td class="cell-tooltip" title="SAINT ${deposito} + CAJA ${caja}">
        ${totalBotellas} BOTELLAS
      </td>
      <td class="cell-tooltip" title="${etiquetaBarra} ${barra}">
        ${barraDisplay}
      </td>
      <td class="no-print actions-col">
        <button class="group-toggle" type="button">Ver</button>
        <button class="action-btn btn-unificar" type="button">Agregar</button>
        <button class="action-btn btn-unificar" type="button">Renombrar</button>
        <button class="action-btn btn-unificar" type="button">Categorizar</button>
        <button class="action-btn btn-ignorar" type="button">Ocultar</button>
      </td>
    `;
    tablaFinalBody.appendChild(row);

    const detailRow = document.createElement("tr");
    detailRow.className = "group-detail hidden";
    const tags = hasGroup
      ? grupo.map((g) => `<span class="detail-tag">${g}</span>`).join("")
      : `<span class="detail-tag">${item.producto}</span>`;
    detailRow.innerHTML = `
      <td colspan="4">
        <div class="detail-list">${tags}</div>
      </td>
    `;
    tablaFinalBody.appendChild(detailRow);

    const [btnVer, btnAgregar, btnRenombrar, btnCategorizar, btnOcultar] =
      row.querySelectorAll("button");
    btnVer.addEventListener("click", () => {
      detailRow.classList.toggle("hidden");
    });
    btnAgregar.addEventListener("click", () => {
      setModoAgregar(item.producto);
      actualizarSeleccionUI();
      tablaOriginal.classList.remove("hidden");
      tablaFinal.classList.add("hidden");
    });
    btnRenombrar.addEventListener("click", () => {
      const nuevo = window.prompt("Nombre visible:", displayName);
      if (nuevo === null) return;
      setDisplayName(key, nuevo);
    });
    btnCategorizar.addEventListener("click", () => {
      const elegido = window.prompt(
        "Categoria para este producto:",
        categoriaIndex.get(key) || ""
      );
      if (elegido === null) return;
      if (!elegido.trim()) {
        clearCategoriaForKeys([key]);
        return;
      }
      setCategoriaForKeys([key], elegido);
    });
    btnOcultar.addEventListener("click", () => {
      const productos = hasGroup ? grupo : [item.producto];
      addIgnorarBatch(productos);
    });
    }
  }
}

function normalizarRespuesta(data) {
  if (!data || typeof data !== "object") {
    return { original: [], final: [], grupos: {}, token: null, nuevos: [] };
  }
  if (Array.isArray(data)) {
    return { original: [], final: data, grupos: {}, token: null, nuevos: [] };
  }
  if (data.final && Array.isArray(data.final)) {
    return data;
  }
  const final = Object.entries(data).map(([producto, valores]) => ({
    producto,
    deposito: valores.deposito ?? 0,
    caja: valores.caja ?? 0,
    barra: valores.barra ?? 0,
  }));
  return { original: [], final, grupos: {}, token: null, nuevos: [] };
}

function renderPendientes() {
  const eq = Array.from(pendientesEquivalencias.entries())
    .slice(0, 20)
    .map(([orig, norm]) => `${orig} -> ${norm}`);
  const ign = Array.from(pendientesIgnorar.values()).slice(0, 20);
  const parts = [];
  if (eq.length) {
    parts.push(`Equivalencias (${pendientesEquivalencias.size}): ${eq.join("; ")}`);
  }
  if (ign.length) {
    parts.push(`Ignorar (${pendientesIgnorar.size}): ${ign.join("; ")}`);
  }
  listaPendientesEl.textContent =
    parts.length > 0 ? parts.join(" | ") : "Sin pendientes.";
}

function setEquivalencia(original, normalizado, record = true) {
  if (!original || !normalizado) return;
  if (record && !isUndoing) {
    const prev = pendientesEquivalencias.has(original)
      ? pendientesEquivalencias.get(original)
      : null;
    undoStack.push({ type: "equiv", original, prev });
  }
  pendientesEquivalencias.set(original, normalizado);
  renderPendientes();
  aplicarCambiosVisuales();
}

function addEquivalencia(original, normalizado) {
  setEquivalencia(original, normalizado);
}

function addIgnorar(producto, record = true) {
  if (!producto) return;
  if (record && !isUndoing) {
    const wasPresent = pendientesIgnorar.has(producto);
    undoStack.push({ type: "ignorar", producto, wasPresent });
  }
  pendientesIgnorar.add(producto);
  renderPendientes();
  aplicarCambiosVisuales();
}

function addIgnorarBatch(productos) {
  if (!productos || productos.length === 0) return;
  let changed = false;
  for (const producto of productos) {
    if (!producto) continue;
    if (!pendientesIgnorar.has(producto)) {
      addIgnorar(producto);
      changed = true;
    }
    if (seleccionados.has(producto)) {
      seleccionados.delete(producto);
    }
  }
  if (changed) {
    actualizarSeleccionUI();
  }
}

function computeDetalleFromBase() {
  if (!baseOriginal) {
    return { original: [], final: [], grupos: {}, gruposAll: {} };
  }
  const eqMap = new Map();
  for (const [orig, norm] of pendientesEquivalencias.entries()) {
    eqMap.set(normalizeKey(orig), String(norm || "").toUpperCase());
  }
  const ignorarSet = new Set(
    Array.from(pendientesIgnorar).map((x) => normalizeKey(x))
  );

  const original = baseOriginal.map((item) => {
    const producto = item.producto ?? "";
    const key = normalizeKey(producto);
    const normalizado = normalizeKey(eqMap.get(key) ?? item.normalizado ?? producto);
    return {
      ...item,
      normalizado,
      ignorado: ignorarSet.has(key) || item.ignorado === true,
      catalogo: item.catalogo === true,
    };
  });

  const grupos = {};
  const gruposAll = {};
  for (const item of original) {
    if (item.ignorado) continue;
    if (!grupos[item.normalizado]) grupos[item.normalizado] = [];
    grupos[item.normalizado].push(item.producto);
    if (!gruposAll[item.normalizado]) gruposAll[item.normalizado] = [];
    gruposAll[item.normalizado].push(item.producto);
  }
  Object.keys(grupos).forEach((k) => {
    if (grupos[k].length < 2) delete grupos[k];
  });

  const agg = new Map();
  for (const item of original) {
    if (item.ignorado) continue;
    const key = item.normalizado;
    if (!agg.has(key)) {
      agg.set(key, { producto: key, deposito: 0, caja: 0, barra: 0 });
    }
    const rec = agg.get(key);
    rec.deposito += Number(item.deposito || 0);
    rec.caja += Number(item.caja || 0);
    rec.barra += Number(item.barra || 0);
  }
  const final = Array.from(agg.values());
  return { original, final, grupos, gruposAll };
}

function aplicarCambiosVisuales() {
  const detalle = computeDetalleFromBase();
  ultimoDetalle = detalle;
  const finalSet = new Set(detalle.final.map((x) => normalizeKey(x.producto)));
  renderOriginal(detalle.original, detalle.grupos, finalSet);
  renderFinal(detalle.final, detalle.gruposAll || {});
  renderGrupos(detalle.grupos);
  localStorage.setItem("ultimo_detalle", JSON.stringify(detalle));
}

function setModoAgregar(nombreGrupo) {
  modoAgregarGrupo = nombreGrupo;
  if (modoAgregarGrupo) {
    modoEdicionEl.checked = true;
    statusReglasEl.textContent = `Modo agregar: selecciona productos y presiona UNIFICAR SELECCION para unir con "${modoAgregarGrupo}".`;
    nombreUnificadoEl.value = "";
    nombreUnificadoEl.placeholder = `Agregando a: ${modoAgregarGrupo}`;
  } else {
    nombreUnificadoEl.placeholder = "Nombre simplificado para el grupo seleccionado";
  }
}

async function calcularInventario(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }
  const saintFile = saintInput.files[0];
  const cajaFile = cajaInput.files[0];
  const barraFile = barraInput.files[0];
  const cachedToken = localStorage.getItem(CACHE_KEY);

  if (!saintFile || !cajaFile || !barraFile) {
    if (!cachedToken) {
      setStatus("Debe subir los tres archivos antes de calcular.", true);
      return;
    }
  }

  setStatus("Procesando archivos...");

  const formData = new FormData();
  if (saintFile && cajaFile && barraFile) {
    formData.append("saint", saintFile);
    formData.append("caja", cajaFile);
    formData.append("barra", barraFile);
  } else if (cachedToken) {
    formData.append("token", cachedToken);
  }

  try {
    const response = await fetch(`${API_URL}?detalle=1`, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(errorText || "Error al procesar.");
    }

    const data = await response.json();
    const detalle = normalizarRespuesta(data);
    ultimoDetalle = detalle;
    baseOriginal = JSON.parse(JSON.stringify(detalle.original || []));
    nuevosProductos = Array.isArray(detalle.nuevos) ? detalle.nuevos : [];
    historialNuevos = Array.isArray(detalle.historial_nuevos)
      ? detalle.historial_nuevos
      : [];

    if (detalle.token) {
      localStorage.setItem(CACHE_KEY, detalle.token);
    }

    aplicarCambiosVisuales();
    renderNotificaciones();

    tablaOriginal.classList.remove("hidden");
    tablaFinal.classList.add("hidden");

    setStatus("Inventario calculado.");
  } catch (error) {
    setStatus(`Error: ${error.message}`, true);
  }
}

function renderNotificaciones() {
  if (
    !notifPanelEl ||
    !notifTextoEl ||
    !listaNuevosEl ||
    !listaHistorialEl ||
    !notifCountEl
  )
    return;
  const totalNuevos = Array.isArray(nuevosProductos) ? nuevosProductos.length : 0;
  if (totalNuevos === 0) {
    notifCountEl.classList.add("hidden");
    notifCountEl.textContent = "";
    notifTextoEl.textContent = "No hay productos nuevos detectados.";
  } else {
    notifCountEl.classList.remove("hidden");
    notifCountEl.textContent = String(totalNuevos);
    notifTextoEl.textContent = `Se detecto un nuevo producto que no esta en la base de datos (${totalNuevos}).`;
  }
  listaNuevosEl.innerHTML = "";
  for (const item of nuevosProductos || []) {
    const row = document.createElement("div");
    row.className = "csv-item";
    row.textContent = item.normalizado || item.producto;
    listaNuevosEl.appendChild(row);
  }
  listaHistorialEl.innerHTML = "";
  for (const item of historialNuevos || []) {
    const row = document.createElement("div");
    row.className = "csv-item";
    const nombre = item.normalizado || item.producto || "";
    row.textContent = `${nombre} (visto ${item.count || 1}x)`;
    listaHistorialEl.appendChild(row);
  }
}

calcularBtn.addEventListener("click", calcularInventario);

borrarCacheBtn.addEventListener("click", () => {
  localStorage.removeItem(CACHE_KEY);
  setStatus("Archivos en cache eliminados. Debes subirlos de nuevo.");
});

window.addEventListener("DOMContentLoaded", () => {
  loadDisplayNames();
  loadCategorias();
  const localHasCats = Object.keys(categorias || {}).length > 0;
  fetch("/categorias")
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      const serverCats =
        data && data.categorias && Object.keys(data.categorias).length > 0
          ? data.categorias
          : null;
      if (serverCats) {
        categorias = serverCats;
        localStorage.setItem(CATEGORIAS_KEY, JSON.stringify(categorias));
      } else if (localHasCats) {
        saveCategorias();
      }
      renderCategoriasUI();
      aplicarCambiosVisuales();
    })
    .catch(() => {
      if (localHasCats) saveCategorias();
      renderCategoriasUI();
    });
  const cachedToken = localStorage.getItem(CACHE_KEY);
  if (cachedToken) {
    setStatus("Archivos en cache disponibles. Puedes calcular sin recargar archivos.");
  }
  const cachedDetalle = localStorage.getItem("ultimo_detalle");
  if (cachedDetalle) {
    try {
      const detalle = JSON.parse(cachedDetalle);
      ultimoDetalle = detalle;
      baseOriginal = JSON.parse(JSON.stringify(detalle.original || []));
      nuevosProductos = Array.isArray(detalle.nuevos) ? detalle.nuevos : [];
      historialNuevos = Array.isArray(detalle.historial_nuevos)
        ? detalle.historial_nuevos
        : [];
      aplicarCambiosVisuales();
      renderNotificaciones();
    } catch (_) {}
  }
  if (cachedToken) {
    calcularInventario();
  }
});

async function guardarReglas() {
  const equivalencias = Array.from(pendientesEquivalencias.entries()).map(
    ([producto_original, producto_normalizado]) => ({
      producto_original,
      producto_normalizado,
    })
  );
  const ignorar = Array.from(pendientesIgnorar.values());

  if (equivalencias.length === 0 && ignorar.length === 0) {
    statusReglasEl.textContent = "No hay reglas pendientes.";
    return;
  }

  try {
    const res = await fetch("/normalizacion/guardar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ equivalencias, ignorar }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || "Error al guardar reglas.");
    }
    pendientesEquivalencias.clear();
    pendientesIgnorar.clear();
    statusReglasEl.textContent =
      "Reglas guardadas. Vuelve a calcular para ver el resultado.";
    setModoAgregar(null);
    renderPendientes();
    actualizarSeleccionUI();
    aplicarCambiosVisuales();
  } catch (err) {
    statusReglasEl.textContent = `Error: ${err.message}`;
  }
}

async function designorarProducto(nombre) {
  try {
    const res = await fetch("/normalizacion/designorar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ productos: [nombre] }),
    });
    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(errorText || "Error al designorar.");
    }
    await calcularInventario();
  } catch (err) {
    statusReglasEl.textContent = `Error: ${err.message}`;
  }
}

function limpiarReglas() {
  pendientesEquivalencias.clear();
  pendientesIgnorar.clear();
  undoStack.length = 0;
  setModoAgregar(null);
  statusReglasEl.textContent = "Pendientes limpiados.";
  renderPendientes();
  actualizarSeleccionUI();
  aplicarCambiosVisuales();
}

function limpiarSeleccion() {
  seleccionados.clear();
  const rows = tablaOriginalBody.querySelectorAll("tr");
  rows.forEach((row) => {
    row.classList.remove("row-selected", ...GROUP_CLASSES);
  });
  actualizarSeleccionUI();
}

guardarReglasBtn.addEventListener("click", guardarReglas);
limpiarReglasBtn.addEventListener("click", limpiarReglas);
if (deshacerCambiosBtn) {
  deshacerCambiosBtn.addEventListener("click", () => {
    if (undoStack.length === 0) {
      statusReglasEl.textContent = "No hay cambios para deshacer.";
      return;
    }
    const action = undoStack.pop();
    isUndoing = true;
    if (action.type === "equiv") {
      if (action.prev === null || action.prev === undefined) {
        pendientesEquivalencias.delete(action.original);
      } else {
        pendientesEquivalencias.set(action.original, action.prev);
      }
    } else if (action.type === "ignorar") {
      if (!action.wasPresent) {
        pendientesIgnorar.delete(action.producto);
      } else {
        pendientesIgnorar.add(action.producto);
      }
    } else if (action.type === "display") {
      setDisplayName(action.key, action.prev, false);
    } else if (action.type === "categoria") {
      for (const item of action.items || []) {
        for (const [c, list] of Object.entries(categorias)) {
          categorias[c] = (list || []).filter((k) => k !== item.key);
        }
        if (item.prevCat) {
          if (!categorias[item.prevCat]) categorias[item.prevCat] = [];
          if (!categorias[item.prevCat].includes(item.key)) {
            categorias[item.prevCat].push(item.key);
          }
        }
      }
      saveCategorias();
      renderCategoriasUI();
      aplicarCambiosVisuales();
    }
    isUndoing = false;
    renderPendientes();
    actualizarSeleccionUI();
    aplicarCambiosVisuales();
    statusReglasEl.textContent = "Cambio deshecho.";
  });
}

function toggleSeleccion(row, producto) {
  if (!producto) return;
  if (pendientesIgnorar.has(producto)) return;
  if (seleccionados.has(producto)) {
    const grp = seleccionados.get(producto);
    seleccionados.delete(producto);
    row.classList.remove("row-selected");
    if (grp) row.classList.remove(grp);
    actualizarSeleccionUI();
    return;
  }
  const groupClass = GROUP_CLASSES[(grupoActual - 1) % GROUP_CLASSES.length];
  seleccionados.set(producto, groupClass);
  row.classList.add("row-selected", groupClass);
  actualizarSeleccionUI();
}

function toggleSeleccionGrupo(headerRow, groupItems, groupClass) {
  if (!groupItems || groupItems.length === 0) return;
  const allSelected = groupItems.every((it) => seleccionados.has(it.producto));
  if (allSelected) {
    for (const it of groupItems) {
      seleccionados.delete(it.producto);
    }
    headerRow.classList.remove("row-selected", groupClass);
  } else {
    for (const it of groupItems) {
      if (!pendientesIgnorar.has(it.producto)) {
        seleccionados.set(it.producto, groupClass);
      }
    }
    headerRow.classList.add("row-selected", groupClass);
  }
  actualizarSeleccionUI();
}

function aplicarUnificacionSeleccionada() {
  if (modoAgregarGrupo) {
    const seleccion = Array.from(seleccionados.keys());
    if (seleccion.length === 0) {
      statusReglasEl.textContent = "Selecciona productos para agregar al grupo.";
      return;
    }
    for (const producto of seleccion) {
      setEquivalencia(producto, modoAgregarGrupo);
    }
    seleccionados.clear();
    setModoAgregar(null);
    renderPendientes();
    actualizarSeleccionUI();
    aplicarCambiosVisuales();
    return;
  }

  const nombreBase = window.prompt("Nombre simplificado para la seleccion:", "");
  if (!nombreBase) return;
  const base = nombreBase.toUpperCase();
  const seleccion = Array.from(seleccionados.keys());
  if (seleccion.length === 0) {
    statusReglasEl.textContent = "Selecciona productos para unificar.";
    return;
  }
    for (const producto of seleccion) {
      setEquivalencia(producto, base);
    }
  seleccionados.clear();
  renderPendientes();
  actualizarSeleccionUI();
  aplicarCambiosVisuales();
}

aplicarUnificarBtn.addEventListener("click", () => {
  aplicarUnificacionSeleccionada();
});

unificarSeleccionBtn.addEventListener("click", () => {
  aplicarUnificacionSeleccionada();
});

limpiarSeleccionBtn.addEventListener("click", () => {
  limpiarSeleccion();
});

deshacerSeleccionBtn.addEventListener("click", () => {
  limpiarSeleccion();
});

resetearTodoBtn.addEventListener("click", () => {
  pendientesEquivalencias.clear();
  pendientesIgnorar.clear();
  seleccionados.clear();
  undoStack.length = 0;
  grupoActual = 1;
  setModoAgregar(null);
  statusReglasEl.textContent = "Estado reiniciado.";
  aplicarCambiosVisuales();
  renderPendientes();
  actualizarSeleccionUI();
});

function groupClassFor(key) {
  if (!key) return "";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 997;
  }
  return GROUP_CLASSES[hash % GROUP_CLASSES.length];
}

function groupIdFor(key) {
  if (!key) return "";
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) % 9973;
  }
  return `G${hash}`;
}

function renderGrupos(grupos) {
  listaGruposEl.innerHTML = "";
  const keys = Object.keys(grupos || {});
  if (keys.length === 0) {
    listaGruposEl.textContent = "Sin grupos";
    return;
  }

  for (const normalizado of keys) {
    const originales = grupos[normalizado] || [];
    const card = document.createElement("div");
    card.className = "grupo-card";
    card.innerHTML = `
      <div class="grupo-title">${normalizado}</div>
      <div class="grupo-count">${originales.length} productos</div>
      <div class="grupo-actions">
        <button class="action-btn btn-unificar" type="button">Editar nombre</button>
        <button class="action-btn btn-ignorar" type="button">Separar</button>
        <button class="action-btn btn-unificar" type="button">Agregar producto</button>
      </div>
    `;

    const [btnEditar, btnSeparar, btnAgregar] = card.querySelectorAll("button");
    btnEditar.addEventListener("click", () => {
      const nombreBase = window.prompt("Nuevo nombre para el grupo:", normalizado);
      if (!nombreBase) return;
      const base = nombreBase.toUpperCase();
      for (const orig of originales) {
        setEquivalencia(orig, base);
      }
      renderPendientes();
      aplicarCambiosVisuales();
    });

    btnSeparar.addEventListener("click", () => {
      for (const orig of originales) {
        setEquivalencia(orig, orig);
      }
      renderPendientes();
      aplicarCambiosVisuales();
    });

    btnAgregar.addEventListener("click", () => {
      setModoAgregar(normalizado);
      actualizarSeleccionUI();
    });

    listaGruposEl.appendChild(card);
  }
}

function renderOriginal(items, grupos, finalSet) {
  tablaOriginalBody.innerHTML = "";
  if (!items || items.length === 0) return;

  const categoriaIndex = buildCategoriaIndex();
  const grouped = new Set(Object.keys(grupos || {}));
  const groupsMap = new Map();
  const singles = [];

  for (const item of items) {
    if (ocultarIgnoradosEl && ocultarIgnoradosEl.checked && item.ignorado) {
      continue;
    }
    if (mostrarNuevos && item.nuevo !== true) {
      continue;
    }
    const catKey = normalizeKey(item.normalizado || item.producto || "");
    const catVal = categoriaIndex.get(catKey) || "";
    if (categoriaFiltro === "__none__" && catVal) {
      continue;
    }
    if (categoriaFiltro && categoriaFiltro !== "__none__" && catVal !== categoriaFiltro) {
      continue;
    }
    if (grouped.has(item.normalizado)) {
      if (!groupsMap.has(item.normalizado)) {
        groupsMap.set(item.normalizado, []);
      }
      groupsMap.get(item.normalizado).push(item);
    } else {
      singles.push(item);
    }
  }

  const groupKeys = Array.from(groupsMap.keys()).sort((a, b) =>
    (a || "").localeCompare(b || "")
  );
  singles.sort((a, b) => (a.producto || "").localeCompare(b.producto || ""));

  for (const key of groupKeys) {
    if (categoriaFiltro) {
      const catVal = categoriaIndex.get(normalizeKey(key)) || "";
      if (categoriaFiltro === "__none__" && catVal) continue;
      if (categoriaFiltro !== "__none__" && catVal !== categoriaFiltro) continue;
    }
    const groupItems = groupsMap.get(key) || [];
    groupItems.sort((a, b) => (a.producto || "").localeCompare(b.producto || ""));

    const sum = groupItems.reduce(
      (acc, it) => {
        acc.deposito += Number(it.deposito || 0);
        acc.caja += Number(it.caja || 0);
        acc.barra += Number(it.barra || 0);
        return acc;
      },
      { deposito: 0, caja: 0, barra: 0 }
    );

    const groupId = groupIdFor(key);
    const groupTitle = groupItems.map((g) => g.producto).join(" | ");
    const displayName = getDisplayName(normalizeKey(key), key);
    const categoriaLabel = categoriaIndex.get(normalizeKey(key)) || "";
    const tieneNuevo = groupItems.some((g) => g.nuevo === true);
    const badgeNuevo = renderNuevoBadge(tieneNuevo);
    const enResultado = finalSet && finalSet.has(normalizeKey(key))
      ? `<span class="en-resultado">EN</span>`
      : "";
    const enCatalogo = groupItems.some((g) => g.catalogo === true)
      ? `<span class="en-catalogo">OK</span>`
      : `<span class="fuera-catalogo">NO</span>`;

    const headerRow = document.createElement("tr");
    headerRow.className = `group-row ${groupClassFor(key)}`;
    headerRow.innerHTML = `
      <td title="${key}">${displayName} ${badgeNuevo}</td>
      <td>${key}</td>
      <td><span class="grupo-badge" title="${groupTitle}">${groupId}</span></td>
      <td>${categoriaLabel}</td>
      <td>${enCatalogo}</td>
      <td>${enResultado}</td>
      <td>${sum.deposito}</td>
      <td>${sum.caja}</td>
      <td>${sum.barra}</td>
      <td></td>
      <td class="actions-col">
        <button class="group-toggle" type="button">Ver</button>
        <button class="action-btn btn-unificar" type="button">Agregar</button>
        <button class="action-btn btn-unificar" type="button">Renombrar</button>
        <button class="action-btn btn-unificar" type="button">Categorizar</button>
      </td>
    `;
    tablaOriginalBody.appendChild(headerRow);

    const detailRow = document.createElement("tr");
    detailRow.className = `group-detail hidden ${groupClassFor(key)}`;
    const detailTags = groupItems
      .map((g) => `<span class="detail-tag">${g.producto}</span>`)
      .join("");
    detailRow.innerHTML = `
      <td colspan="11">
        <div class="detail-list">${detailTags}</div>
      </td>
    `;
    tablaOriginalBody.appendChild(detailRow);

    const [btnVer, btnAgregar, btnRenombrar, btnCategorizar] =
      headerRow.querySelectorAll("button");
    btnVer.addEventListener("click", () => {
      detailRow.classList.toggle("hidden");
    });
    btnAgregar.addEventListener("click", () => {
      setModoAgregar(key);
      actualizarSeleccionUI();
    });
    btnRenombrar.addEventListener("click", () => {
      const nuevo = window.prompt("Nombre visible del grupo:", displayName);
      if (nuevo === null) return;
      setDisplayName(normalizeKey(key), nuevo);
    });
    btnCategorizar.addEventListener("click", () => {
      const elegido = window.prompt(
        "Categoria para este grupo:",
        categoriaLabel
      );
      if (elegido === null) return;
      const keys = [normalizeKey(key)];
      if (!elegido.trim()) {
        clearCategoriaForKeys(keys);
        return;
      }
      setCategoriaForKeys(keys, elegido);
    });

    headerRow.addEventListener("click", (e) => {
      if (!modoEdicionEl.checked) return;
      if (e.target.tagName.toLowerCase() === "button") return;
      toggleSeleccionGrupo(headerRow, groupItems, groupClassFor(key));
    });
  }

  for (const item of singles) {
    const row = document.createElement("tr");
    const estado = item.ignorado ? "IGNORADO" : "";
    const isGrouped = grouped.has(item.normalizado);
    const groupId = isGrouped ? groupIdFor(item.normalizado) : "";
    const groupTitle = isGrouped && grupos[item.normalizado]
      ? grupos[item.normalizado].join(" | ")
      : "";
    const displayName = getDisplayName(normalizeKey(item.producto), item.producto);
    const categoriaLabel = categoriaIndex.get(normalizeKey(item.normalizado)) || "";
    const badgeNuevo = renderNuevoBadge(item.nuevo === true);

    const acciones = item.ignorado
      ? `<button class="action-btn btn-unificar" type="button">Unificar</button>
         <button class="action-btn btn-unificar" type="button">Renombrar</button>
         <button class="action-btn btn-ignorar" type="button" data-designorar="1">Designorar</button>`
      : `<button class="action-btn btn-unificar" type="button">Unificar</button>
         <button class="action-btn btn-unificar" type="button">Renombrar</button>
         <button class="action-btn btn-ignorar" type="button">Ignorar</button>`;
    const enResultado = finalSet && finalSet.has(normalizeKey(item.normalizado))
      ? `<span class="en-resultado">EN</span>`
      : "";
    const enCatalogo = item.catalogo === true
      ? `<span class="en-catalogo">OK</span>`
      : `<span class="fuera-catalogo">NO</span>`;

    row.innerHTML = `
      <td title="${item.producto ?? ""}">${displayName ?? ""} ${badgeNuevo}</td>
      <td>${item.normalizado ?? ""}</td>
      <td>${isGrouped ? `<span class="grupo-badge" title="${groupTitle}">${groupId}</span>` : ""}</td>
      <td>${categoriaLabel}</td>
      <td>${enCatalogo}</td>
      <td>${enResultado}</td>
      <td>${item.deposito ?? 0}</td>
      <td>${item.caja ?? 0}</td>
      <td>${item.barra ?? 0}</td>
      <td class="${item.ignorado ? "estado-ignorado" : ""}">${estado}</td>
      <td class="actions-col">${acciones}</td>
    `;

    const [btnUnificar, btnRenombrar, btnIgnorar] = row.querySelectorAll("button");
    btnUnificar.addEventListener("click", () => {
      if (modoEdicionEl.checked) {
        toggleSeleccion(row, item.producto ?? "");
        return;
      }
      const nombreBase = window.prompt(
        "Nombre simplificado para este producto:",
        item.producto ?? ""
      );
      if (!nombreBase) return;
      setEquivalencia(item.producto ?? "", nombreBase.toUpperCase());
      statusReglasEl.textContent = `Pendientes: ${pendientesEquivalencias.size} equivalencias, ${pendientesIgnorar.size} ignorar.`;
      renderPendientes();
      aplicarCambiosVisuales();
    });

    btnRenombrar.addEventListener("click", () => {
      const nuevo = window.prompt("Nombre visible:", displayName ?? "");
      if (nuevo === null) return;
      setDisplayName(normalizeKey(item.producto), nuevo);
    });

    btnIgnorar.addEventListener("click", () => {
      if (!item.producto) return;
      if (btnIgnorar.dataset.designorar === "1") {
        designorarProducto(item.producto);
        return;
      }
      addIgnorar(item.producto);
      if (seleccionados.has(item.producto)) {
        seleccionados.delete(item.producto);
      }
      statusReglasEl.textContent = `Pendientes: ${pendientesEquivalencias.size} equivalencias, ${pendientesIgnorar.size} ignorar.`;
      renderPendientes();
      aplicarCambiosVisuales();
    });

    row.addEventListener("click", (e) => {
      if (!modoEdicionEl.checked) return;
      if (e.target.tagName.toLowerCase() === "button") return;
      toggleSeleccion(row, item.producto ?? "");
    });

    if (isGrouped) {
      row.classList.add(groupClassFor(item.normalizado));
    }

    tablaOriginalBody.appendChild(row);
  }
}

verOriginalBtn.addEventListener("click", () => {
  aplicarCambiosVisuales();
  tablaOriginal.classList.remove("hidden");
  tablaFinal.classList.add("hidden");
});

verFinalBtn.addEventListener("click", () => {
  aplicarCambiosVisuales();
  tablaFinal.classList.remove("hidden");
  tablaOriginal.classList.add("hidden");
});

renderPendientes();

if (ocultarIgnoradosEl) {
  ocultarIgnoradosEl.addEventListener("change", () => {
    aplicarCambiosVisuales();
  });
}

if (exportarPdfBtn) {
  exportarPdfBtn.addEventListener("click", () => {
    window.print();
  });
}

if (verNuevosBtn) {
  verNuevosBtn.addEventListener("click", () => {
    mostrarNuevos = true;
    aplicarCambiosVisuales();
    tablaOriginal.classList.remove("hidden");
    tablaFinal.classList.add("hidden");
    if (listaNuevosEl) listaNuevosEl.classList.remove("hidden");
    if (listaHistorialEl) listaHistorialEl.classList.add("hidden");
  });
}

if (verHistorialBtn) {
  verHistorialBtn.addEventListener("click", () => {
    if (listaNuevosEl) listaNuevosEl.classList.add("hidden");
    if (listaHistorialEl) listaHistorialEl.classList.remove("hidden");
  });
}

if (ocultarNuevosBtn) {
  ocultarNuevosBtn.addEventListener("click", () => {
    mostrarNuevos = false;
    aplicarCambiosVisuales();
    if (notifPanelEl) notifPanelEl.classList.add("hidden");
  });
}

if (notifBellBtn) {
  notifBellBtn.addEventListener("click", () => {
    if (!notifPanelEl) return;
    notifPanelEl.classList.toggle("hidden");
  });
}

if (notifCloseBtn) {
  notifCloseBtn.addEventListener("click", () => {
    if (!notifPanelEl) return;
    notifPanelEl.classList.add("hidden");
  });
}

if (categoriaFiltroEl) {
  categoriaFiltroEl.addEventListener("change", () => {
    categoriaFiltro = categoriaFiltroEl.value || "";
    aplicarCambiosVisuales();
  });
}

if (crearCategoriaBtn) {
  crearCategoriaBtn.addEventListener("click", () => {
    const nombre = String(categoriaNuevaEl.value || "").trim();
    if (!nombre) return;
    if (!categorias[nombre]) categorias[nombre] = [];
    categoriaNuevaEl.value = "";
    saveCategorias();
    renderCategoriasUI();
  });
}

if (asignarCategoriaBtn) {
  asignarCategoriaBtn.addEventListener("click", () => {
    const categoria = categoriaSelectEl.value;
    if (!categoria) return;
    const keys = Array.from(seleccionados.keys()).map((p) =>
      getNormalizedKeyForProducto(p)
    );
    if (keys.length === 0) {
      statusReglasEl.textContent = "Selecciona productos para asignar categoria.";
      return;
    }
    setCategoriaForKeys(keys, categoria);
    limpiarSeleccion();
  });
}

if (asignarCategoriaBarBtn) {
  asignarCategoriaBarBtn.addEventListener("click", () => {
    const categoria = categoriaSelectBarEl.value;
    if (!categoria) return;
    const keys = Array.from(seleccionados.keys()).map((p) =>
      getNormalizedKeyForProducto(p)
    );
    if (keys.length === 0) {
      statusReglasEl.textContent = "Selecciona productos para asignar categoria.";
      return;
    }
    setCategoriaForKeys(keys, categoria);
    limpiarSeleccion();
  });
}

if (quitarCategoriaBtn) {
  quitarCategoriaBtn.addEventListener("click", () => {
    if (!window.confirm("Quitar categoria a los productos seleccionados?")) {
      return;
    }
    const keys = Array.from(seleccionados.keys()).map((p) =>
      getNormalizedKeyForProducto(p)
    );
    if (keys.length === 0) {
      statusReglasEl.textContent = "Selecciona productos para quitar categoria.";
      return;
    }
    clearCategoriaForKeys(keys);
    limpiarSeleccion();
  });
}

if (quitarCategoriaBarBtn) {
  quitarCategoriaBarBtn.addEventListener("click", () => {
    if (!window.confirm("Quitar categoria a los productos seleccionados?")) {
      return;
    }
    const keys = Array.from(seleccionados.keys()).map((p) =>
      getNormalizedKeyForProducto(p)
    );
    if (keys.length === 0) {
      statusReglasEl.textContent = "Selecciona productos para quitar categoria.";
      return;
    }
    clearCategoriaForKeys(keys);
    limpiarSeleccion();
  });
}

if (csvRevisionInput) {
  csvRevisionInput.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return;
    // Skip header if it contains 'producto'
    const startIndex = lines[0].toLowerCase().includes("producto") ? 1 : 0;
    const productos = lines.slice(startIndex).map((l) => l.split(",")[0].trim());

    listaCsvEl.innerHTML = "";
    for (const nombre of productos) {
      const item = document.createElement("div");
      item.className = "csv-item";
      item.innerHTML = `
        <div>${nombre}</div>
        <div class="csv-actions">
          <button class="action-btn btn-unificar" type="button">Unificar con...</button>
          <button class="action-btn btn-ignorar" type="button">Ignorar</button>
        </div>
      `;
      const [btnUni, btnIgn] = item.querySelectorAll("button");
      btnUni.addEventListener("click", () => {
        const nombreBase = window.prompt("Nombre simplificado:", "");
        if (!nombreBase) return;
        addEquivalencia(nombre.toUpperCase(), nombreBase.toUpperCase());
        item.remove();
      });
      btnIgn.addEventListener("click", () => {
        addIgnorar(nombre.toUpperCase());
        item.remove();
      });
      listaCsvEl.appendChild(item);
    }
  });
}

// Conversiones
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
      aplicarCambiosVisuales();
    }
  })
  .catch(() => {});

function refreshConversionesFromStorage() {
  loadConversiones();
  aplicarCambiosVisuales();
}

window.addEventListener("storage", (e) => {
  if (e.key === CONVERSIONES_KEY) {
    refreshConversionesFromStorage();
  }
});

window.addEventListener("focus", () => {
  fetch("/conversiones")
    .then((r) => r.json())
    .then((data) => {
      if (data && typeof data === "object") {
        conversiones = {
          categorias: data.categorias || {},
          productos: data.productos || {},
        };
        saveConversiones();
        aplicarCambiosVisuales();
      }
    })
    .catch(() => {
      refreshConversionesFromStorage();
    });
});
