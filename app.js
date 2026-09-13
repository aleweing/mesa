// Mesa — lógica de la PWA (vanilla JS, sin dependencias)

const state = {
  apiUrl: localStorage.getItem("mesa_api_url") || "",
  apiKey: localStorage.getItem("mesa_api_key") || "",
  currentRestaurantId: null,
  currentDishId: null,
  editingRestaurant: false,
  detailMine: true,
  currentDishes: [],
  galleryByCategory: { general: [], menu: [], ticket: [] },
  me: null,
  allRestaurants: [],
  searchQuery: "",
  activeFilter: "all",
  formRepeatValue: "",
  cityFilter: "",
  formLat: null,
  formLng: null,
  // Visor de fotos
  galleryPhotos: [],
  galleryIndex: 0,
  viewerContext: "general", // "general" | "dish"
  viewerDishId: null,
};

const views = {
  config: document.getElementById("view-config"),
  list: document.getElementById("view-list"),
  detail: document.getElementById("view-detail"),
  form: document.getElementById("view-form"),
  map: document.getElementById("view-map"),
  pinDrop: document.getElementById("view-pin-drop"),
};

function showView(name) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 2200);
}

async function api(path, options = {}) {
  const res = await fetch(state.apiUrl + path, {
    ...options,
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      "X-API-Key": state.apiKey,
      ...options.headers,
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Error de red" }));
    throw new Error(err.error || "Error de red");
  }
  if (res.status === 204) return null;
  return res.json();
}

function photoUrl(key) {
  return `${state.apiUrl}/api/photos/${encodeURIComponent(key)}`;
}

function mapsUrl(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

// ---------- Lista ----------

async function loadList() {
  showView("list");
  try {
    if (!state.me) {
      const me = await api("/api/me");
      state.me = me.owner;
    }
    state.allRestaurants = await api("/api/restaurants");
    updateCityDatalist();
    renderRestaurantList();
  } catch (e) {
    toast(e.message);
  }
}

function updateCityDatalist() {
  const cities = [...new Set(state.allRestaurants.map((r) => r.city).filter(Boolean))].sort();
  document.getElementById("city-datalist").innerHTML = cities.map((c) => `<option value="${escapeHtml(c)}"></option>`).join("");
}

function applyFilters(list) {
  const query = (state.searchQuery || "").trim().toLowerCase();
  let filtered = list.filter((r) => r.name.toLowerCase().includes(query));
  if (state.activeFilter === "mine") filtered = filtered.filter((r) => r.owner === state.me);
  if (state.activeFilter === "shared") filtered = filtered.filter((r) => r.owner !== state.me);
  if (state.activeFilter === "repeat") filtered = filtered.filter((r) => r.repeat_visit === 1);
  if (state.cityFilter.trim()) {
    const c = state.cityFilter.trim().toLowerCase();
    filtered = filtered.filter((r) => (r.city || "").toLowerCase() === c);
  }
  return filtered;
}

function renderRestaurantList() {
  const list = document.getElementById("restaurant-list");
  const empty = document.getElementById("list-empty");
  const cityEmptyMsg = document.getElementById("city-empty-msg");
  list.innerHTML = "";

  const filtered = applyFilters(state.allRestaurants);

  empty.classList.toggle("hidden", state.allRestaurants.length > 0);

  const cityIsEmpty = state.cityFilter.trim() && filtered.length === 0;
  cityEmptyMsg.classList.toggle("hidden", !cityIsEmpty);
  if (cityIsEmpty) {
    cityEmptyMsg.textContent = `No tienes restaurantes visitados en ${state.cityFilter.trim()}.`;
  }

  for (const r of filtered) {
    const li = document.createElement("li");
    li.className = "ticket-card";
    const notMine = r.owner !== state.me;
    const repeatBadge = r.repeat_visit === 1
      ? `<span class="ticket-repeat-badge yes">Repetiría</span>`
      : r.repeat_visit === 0
      ? `<span class="ticket-repeat-badge no">No repetiría</span>`
      : "";
    li.innerHTML = `
      ${r.cover_key
        ? `<img class="ticket-cover" src="${photoUrl(r.cover_key)}" alt="" />`
        : `<div class="ticket-cover-placeholder">${r.name.charAt(0).toUpperCase()}</div>`}
      <div class="ticket-info">
        <p class="ticket-name">${escapeHtml(r.name)}${notMine ? `<span class="ticket-shared-badge">${escapeHtml(r.owner)}</span>` : ""}${repeatBadge}</p>
        <p class="ticket-address">${escapeHtml(r.address || "")}</p>
      </div>`;
    li.addEventListener("click", () => openDetail(r.id));
    list.appendChild(li);
  }
}

document.getElementById("search-input").addEventListener("input", (e) => {
  state.searchQuery = e.target.value;
  renderRestaurantList();
});

document.getElementById("filter-chips").addEventListener("click", (e) => {
  const btn = e.target.closest(".chip");
  if (!btn) return;
  state.activeFilter = btn.dataset.filter;
  document.querySelectorAll("#filter-chips .chip").forEach((c) => c.classList.toggle("active", c === btn));
  renderRestaurantList();
});

function setCityFilter(value) {
  state.cityFilter = value;
  document.getElementById("city-filter-input").value = value;
  document.getElementById("city-filter-input-map").value = value;
  renderRestaurantList();
  if (mapMain) renderMapMarkers();
}

document.getElementById("city-filter-input").addEventListener("input", (e) => setCityFilter(e.target.value));
document.getElementById("city-filter-input-map").addEventListener("input", (e) => setCityFilter(e.target.value));
document.getElementById("clear-city-filter").addEventListener("click", () => setCityFilter(""));

// ---------- Mapa ----------

let mapMain = null;
let mapMarkers = [];
const MALLORCA_CENTER = [39.55, 2.85];

function pinIcon(r) {
  const cls = r.repeat_visit === 1 ? "repeat" : r.owner !== state.me ? "notmine" : "";
  const letter = r.name.charAt(0).toUpperCase();
  return L.divIcon({
    className: "",
    html: `<div class="mesa-pin ${cls}"><div class="mesa-pin-head"><span>${letter}</span></div></div>`,
    iconSize: [34, 42],
    iconAnchor: [17, 42],
  });
}

function initMainMap() {
  if (mapMain) {
    setTimeout(() => mapMain.invalidateSize(), 50);
    return;
  }
  mapMain = L.map("leaflet-map", { zoomControl: false, attributionControl: false }).setView(MALLORCA_CENTER, 10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(mapMain);
  L.control.attribution({ position: "bottomleft", prefix: false }).addTo(mapMain);
  renderMapMarkers();
  setTimeout(() => mapMain.invalidateSize(), 100);
}

function renderMapMarkers() {
  if (!mapMain) return;
  mapMarkers.forEach((m) => mapMain.removeLayer(m));
  mapMarkers = [];

  const filtered = applyFilters(state.allRestaurants);
  const plottable = filtered.filter((r) => r.lat != null && r.lng != null);

  plottable.forEach((r) => {
    const marker = L.marker([r.lat, r.lng], { icon: pinIcon(r) }).addTo(mapMain);
    marker.on("click", () => openDetail(r.id));
    mapMarkers.push(marker);
  });

  const emptyMsg = document.getElementById("map-empty-msg");
  const emptyText = document.getElementById("map-empty-text");
  if (filtered.length === 0) {
    emptyMsg.classList.remove("hidden");
    emptyText.textContent = state.cityFilter.trim()
      ? `No tienes restaurantes visitados en ${state.cityFilter.trim()}.`
      : "Ningún restaurante coincide con estos filtros.";
  } else if (plottable.length === 0) {
    emptyMsg.classList.remove("hidden");
    emptyText.textContent = "Ninguno de estos restaurantes tiene ubicación guardada en el mapa todavía.";
  } else {
    emptyMsg.classList.add("hidden");
    if (plottable.length === 1) {
      mapMain.setView([plottable[0].lat, plottable[0].lng], 15);
    } else {
      mapMain.fitBounds(L.latLngBounds(plottable.map((r) => [r.lat, r.lng])), { padding: [40, 60] });
    }
  }
}

document.getElementById("open-map").addEventListener("click", () => {
  showView("map");
  initMainMap();
});
document.getElementById("back-from-map").addEventListener("click", loadList);

document.getElementById("fab-map-add").addEventListener("click", () => {
  state.editingRestaurant = false;
  document.getElementById("form-title").textContent = "Nueva mesa";
  document.getElementById("form-name").value = "";
  document.getElementById("form-address").value = "";
  document.getElementById("form-city").value = "";
  document.getElementById("form-phone").value = "";
  document.getElementById("form-notes").value = "";
  document.getElementById("form-shared").checked = false;
  setRepeatToggle("");
  state.formLat = null;
  state.formLng = null;
  openPinDrop();
});

// ---------- Elegir ubicación en el mapa ----------

let mapPin = null;

function openPinDrop() {
  showView("pinDrop");
  const center = state.formLat != null && state.formLng != null ? [state.formLat, state.formLng] : MALLORCA_CENTER;
  if (!mapPin) {
    mapPin = L.map("leaflet-map-pin", { zoomControl: false, attributionControl: false }).setView(center, 16);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(mapPin);
    L.control.attribution({ position: "bottomleft", prefix: false }).addTo(mapPin);
  } else {
    mapPin.setView(center, 16);
  }
  setTimeout(() => mapPin.invalidateSize(), 100);
}

document.getElementById("open-pin-drop").addEventListener("click", openPinDrop);
document.getElementById("pin-drop-cancel").addEventListener("click", () => showView("form"));

document.getElementById("pin-drop-confirm").addEventListener("click", async () => {
  const center = mapPin.getCenter();
  state.formLat = center.lat;
  state.formLng = center.lng;
  const btn = document.getElementById("pin-drop-confirm");
  btn.textContent = "Localizando dirección…";
  btn.disabled = true;
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${center.lat}&lon=${center.lng}`
    );
    const data = await res.json();
    const a = data.address || {};
    document.getElementById("form-address").value = data.display_name || "";
    document.getElementById("form-city").value = a.city || a.town || a.village || a.municipality || "";
  } catch (e) {
    toast("No se pudo obtener la dirección automáticamente, escríbela a mano");
  }
  btn.textContent = "Confirmar ubicación aquí";
  btn.disabled = false;
  showView("form");
});

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

function formatDate(isoLike) {
  if (!isoLike) return "";
  const d = new Date(isoLike.replace(" ", "T") + "Z");
  if (isNaN(d)) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

function renderPhotoStrip(elementId, photos) {
  const el = document.getElementById(elementId);
  el.innerHTML = "";
  if (photos.length === 0) {
    el.innerHTML = `<p class="photo-strip-empty">—</p>`;
    return;
  }
  photos.forEach((p, index) => {
    const item = document.createElement("div");
    item.className = "photo-strip-item";
    item.innerHTML = `<img src="${photoUrl(p.r2_key)}" alt="" /><div class="photo-strip-date">${formatDate(p.created_at)}</div>`;
    item.querySelector("img").addEventListener("click", () => openPhotoViewer("general", photos, index));
    el.appendChild(item);
  });
}

// ---------- Detalle ----------

async function openDetail(id) {
  state.currentRestaurantId = id;
  showView("detail");
  try {
    const r = await api(`/api/restaurants/${id}`);
    renderDetail(r);
  } catch (e) {
    toast(e.message);
  }
}

function renderDetail(r) {
  state.detailMine = r.mine;
  document.getElementById("detail-name").textContent = r.name;

  const ownerTag = document.getElementById("detail-owner-tag");
  ownerTag.classList.toggle("hidden", r.mine);
  ownerTag.textContent = r.mine ? "" : `De ${r.owner}`;

  const repeatTag = document.getElementById("detail-repeat-tag");
  if (r.repeat_visit === 1) {
    repeatTag.textContent = "Repetiría";
    repeatTag.className = "repeat-tag yes";
  } else if (r.repeat_visit === 0) {
    repeatTag.textContent = "No repetiría";
    repeatTag.className = "repeat-tag no";
  } else {
    repeatTag.className = "repeat-tag hidden";
  }

  document.getElementById("edit-restaurant").classList.toggle("hidden", !r.mine);
  document.getElementById("delete-restaurant").classList.toggle("hidden", !r.mine);
  document.getElementById("add-dish").classList.toggle("hidden", !r.mine);
  document.querySelectorAll(".upload-label").forEach((el) => el.classList.toggle("hidden", !r.mine));

  const addrEl = document.getElementById("detail-address");
  if (r.address) {
    addrEl.textContent = "📍 " + r.address;
    addrEl.href = r.lat != null && r.lng != null
      ? `https://www.google.com/maps/search/?api=1&query=${r.lat},${r.lng}`
      : mapsUrl(r.address);
  } else {
    addrEl.textContent = "";
    addrEl.removeAttribute("href");
  }

  const phoneEl = document.getElementById("detail-phone");
  if (r.phone) {
    phoneEl.textContent = "📞 " + r.phone;
    phoneEl.href = "tel:" + r.phone.replace(/\s+/g, "");
  } else {
    phoneEl.textContent = "";
  }

  const notesEl = document.getElementById("detail-notes");
  notesEl.classList.toggle("hidden", !r.notes);
  notesEl.textContent = r.notes || "";

  state.currentDishes = r.dishes;

  const assignedPhotoIds = new Set(r.dishes.map((d) => d.photo_id).filter(Boolean));
  const visiblePhotos = r.photos.filter((p) => !assignedPhotoIds.has(p.id));
  const byCategory = {
    general: visiblePhotos.filter((p) => !p.category || p.category === "general"),
    menu: visiblePhotos.filter((p) => p.category === "menu"),
    ticket: visiblePhotos.filter((p) => p.category === "ticket"),
  };
  state.galleryByCategory = byCategory;

  renderPhotoStrip("photos-general", byCategory.general);
  renderPhotoStrip("photos-menu", byCategory.menu);
  renderPhotoStrip("photos-ticket", byCategory.ticket);

  const dishList = document.getElementById("dish-list");
  dishList.innerHTML = "";
  for (const d of r.dishes) {
    const li = document.createElement("li");
    li.className = "dish-row";
    const stampClass = d.liked === 1 ? "liked" : d.liked === 0 ? "disliked" : "neutral";
    const stampText = d.liked === 1 ? "SÍ" : d.liked === 0 ? "NO" : "—";
    const thumb = d.photo
      ? `<div class="dish-thumbs"><img class="dish-thumb" src="${photoUrl(d.photo.r2_key)}" alt="" /></div>`
      : "";
    li.innerHTML = `
      <div class="dish-row-main">
        <span class="stamp ${stampClass}">${stampText}</span>
        <span class="dish-name">${escapeHtml(d.name)}${d.notes ? `<span class="dish-notes">${escapeHtml(d.notes)}</span>` : ""}</span>
        ${r.mine ? `<button class="dish-photo-btn" data-dish-id="${d.id}" aria-label="Cambiar foto del plato">📷</button>` : ""}
      </div>
      ${thumb}`;
    li.querySelector(".dish-row-main").addEventListener("click", (e) => {
      if (e.target.closest(".dish-photo-btn")) return;
      editDish(d);
    });
    const photoBtn = li.querySelector(".dish-photo-btn");
    if (photoBtn) {
      photoBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.currentDishId = d.id;
        document.getElementById("dish-photo-input").click();
      });
    }
    const thumbImg = li.querySelector(".dish-thumb");
    if (thumbImg) {
      thumbImg.addEventListener("click", (e) => {
        e.stopPropagation();
        openPhotoViewer("dish", [d.photo], 0, d.id);
      });
    }
    dishList.appendChild(li);
  }
}

async function deletePhoto(photoId) {
  await api(`/api/photos/${photoId}`, { method: "DELETE" });
}

// ---------- Visor de fotos (galería con navegación) ----------

function openPhotoViewer(context, photos, index, dishId = null) {
  state.viewerContext = context;
  state.galleryPhotos = photos;
  state.galleryIndex = index;
  state.viewerDishId = dishId;
  document.getElementById("pv-dish-picker").classList.add("hidden");
  document.getElementById("pv-category-picker").classList.add("hidden");
  document.getElementById("pv-assign").classList.toggle("hidden", context !== "general" || !state.detailMine);
  document.getElementById("pv-category").classList.toggle("hidden", context !== "general" || !state.detailMine);
  document.getElementById("pv-delete").textContent = context === "dish" ? "🗑 Quitar del plato" : "🗑 Eliminar";
  document.getElementById("pv-delete").classList.toggle("hidden", !state.detailMine);
  showCurrentGalleryPhoto();
  document.getElementById("photo-viewer").classList.remove("hidden");
}

function showCurrentGalleryPhoto() {
  const photo = state.galleryPhotos[state.galleryIndex];
  document.getElementById("pv-image").src = photoUrl(photo.r2_key);
  const showNav = state.galleryPhotos.length > 1;
  document.getElementById("pv-prev").classList.toggle("hidden", !showNav);
  document.getElementById("pv-next").classList.toggle("hidden", !showNav);
}

function closePhotoViewer() {
  document.getElementById("photo-viewer").classList.add("hidden");
  document.getElementById("pv-dish-picker").classList.add("hidden");
  document.getElementById("pv-category-picker").classList.add("hidden");
  document.getElementById("pv-image").src = "";
  state.galleryPhotos = [];
}

document.getElementById("pv-close").addEventListener("click", closePhotoViewer);
document.getElementById("photo-viewer").addEventListener("click", (e) => {
  if (e.target.id === "photo-viewer") closePhotoViewer();
});

// Swipe táctil para pasar de foto (izquierda = siguiente, derecha = anterior)
let pvTouchStartX = null;
const pvViewer = document.getElementById("photo-viewer");
pvViewer.addEventListener("touchstart", (e) => {
  pvTouchStartX = e.touches[0].clientX;
}, { passive: true });
pvViewer.addEventListener("touchend", (e) => {
  if (pvTouchStartX === null) return;
  const dx = e.changedTouches[0].clientX - pvTouchStartX;
  pvTouchStartX = null;
  if (Math.abs(dx) < 40 || state.galleryPhotos.length <= 1) return;
  if (dx < 0) document.getElementById("pv-next").click();
  else document.getElementById("pv-prev").click();
}, { passive: true });
document.getElementById("pv-prev").addEventListener("click", () => {
  const n = state.galleryPhotos.length;
  state.galleryIndex = (state.galleryIndex - 1 + n) % n;
  showCurrentGalleryPhoto();
});
document.getElementById("pv-next").addEventListener("click", () => {
  const n = state.galleryPhotos.length;
  state.galleryIndex = (state.galleryIndex + 1) % n;
  showCurrentGalleryPhoto();
});

document.getElementById("pv-delete").addEventListener("click", async () => {
  const photo = state.galleryPhotos[state.galleryIndex];
  try {
    if (state.viewerContext === "dish") {
      if (!confirm("¿Quitar la foto de este plato? (seguirá en Fotos generales)")) return;
      await api(`/api/dishes/${state.viewerDishId}/photo`, {
        method: "PUT",
        body: JSON.stringify({ photo_id: null }),
      });
      closePhotoViewer();
      openDetail(state.currentRestaurantId);
    } else {
      if (!confirm("¿Eliminar esta foto? Si estaba asignada a algún plato, también se quitará de ahí.")) return;
      await deletePhoto(photo.id);
      state.galleryPhotos.splice(state.galleryIndex, 1);
      if (state.galleryPhotos.length === 0) {
        closePhotoViewer();
      } else {
        state.galleryIndex = state.galleryIndex % state.galleryPhotos.length;
        showCurrentGalleryPhoto();
      }
      openDetail(state.currentRestaurantId);
    }
  } catch (e) {
    toast(e.message);
  }
});

document.getElementById("pv-assign").addEventListener("click", () => {
  document.getElementById("pv-category-picker").classList.add("hidden");
  const select = document.getElementById("pv-dish-select");
  select.innerHTML = state.currentDishes
    .map((d) => `<option value="${d.id}">${escapeHtml(d.name)}</option>`)
    .join("");
  document.getElementById("pv-dish-picker").classList.toggle("hidden");
});
document.getElementById("pv-dish-cancel").addEventListener("click", () => {
  document.getElementById("pv-dish-picker").classList.add("hidden");
});
document.getElementById("pv-dish-confirm").addEventListener("click", async () => {
  const dishId = document.getElementById("pv-dish-select").value;
  if (!dishId) { toast("Este restaurante aún no tiene platos"); return; }
  const photo = state.galleryPhotos[state.galleryIndex];
  try {
    await api(`/api/dishes/${dishId}/photo`, {
      method: "PUT",
      body: JSON.stringify({ photo_id: photo.id }),
    });
    toast("Foto asignada al plato");
    closePhotoViewer();
    openDetail(state.currentRestaurantId);
  } catch (e) {
    toast(e.message);
  }
});

document.getElementById("pv-category").addEventListener("click", () => {
  document.getElementById("pv-dish-picker").classList.add("hidden");
  const photo = state.galleryPhotos[state.galleryIndex];
  document.getElementById("pv-category-select").value = photo.category || "";
  document.getElementById("pv-category-picker").classList.toggle("hidden");
});
document.getElementById("pv-category-cancel").addEventListener("click", () => {
  document.getElementById("pv-category-picker").classList.add("hidden");
});
document.getElementById("pv-category-confirm").addEventListener("click", async () => {
  const photo = state.galleryPhotos[state.galleryIndex];
  const category = document.getElementById("pv-category-select").value || null;
  try {
    await api(`/api/photos/${photo.id}/category`, {
      method: "PUT",
      body: JSON.stringify({ category }),
    });
    closePhotoViewer();
    openDetail(state.currentRestaurantId);
  } catch (e) {
    toast(e.message);
  }
});

async function uploadPhotos(files, category) {
  for (const file of files) {
    const fd = new FormData();
    fd.append("photo", file);
    if (category) fd.append("category", category);
    try {
      await api(`/api/restaurants/${state.currentRestaurantId}/photos`, { method: "POST", body: fd });
    } catch (err) {
      toast(err.message);
    }
  }
  openDetail(state.currentRestaurantId);
}

document.getElementById("photo-input-general").addEventListener("change", async (e) => {
  await uploadPhotos(Array.from(e.target.files), null);
  e.target.value = "";
});
document.getElementById("photo-input-menu").addEventListener("change", async (e) => {
  await uploadPhotos(Array.from(e.target.files), "menu");
  e.target.value = "";
});
document.getElementById("photo-input-ticket").addEventListener("change", async (e) => {
  await uploadPhotos(Array.from(e.target.files), "ticket");
  e.target.value = "";
});

// Subir una foto directamente para un plato: se añade al repositorio
// general del restaurante y se asigna a ese plato en el mismo paso
// (reemplaza la foto que tuviera antes, si tenía).
document.getElementById("dish-photo-input").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const fd = new FormData();
    fd.append("photo", file);
    const uploaded = await api(`/api/restaurants/${state.currentRestaurantId}/photos`, { method: "POST", body: fd });
    await api(`/api/dishes/${state.currentDishId}/photo`, {
      method: "PUT",
      body: JSON.stringify({ photo_id: uploaded.id }),
    });
  } catch (err) {
    toast(err.message);
  }
  openDetail(state.currentRestaurantId);
});

document.getElementById("add-dish").addEventListener("click", () => addDish());

async function addDish() {
  const name = prompt("Nombre del plato:");
  if (!name) return;
  const likedRaw = prompt("¿Te gustó? Escribe: si / no / (deja vacío si no lo sabes)");
  const liked = likedRaw?.toLowerCase().startsWith("s") ? 1 : likedRaw?.toLowerCase().startsWith("n") ? 0 : null;
  const notes = prompt("Notas (opcional), ej. 'para mi hija: pedir solo esto'") || null;
  try {
    await api(`/api/restaurants/${state.currentRestaurantId}/dishes`, {
      method: "POST",
      body: JSON.stringify({ name, liked, notes }),
    });
    openDetail(state.currentRestaurantId);
  } catch (e) {
    toast(e.message);
  }
}

async function editDish(dish) {
  const action = confirm("Pulsa Aceptar para editar, Cancelar para eliminar");
  if (!action) {
    if (confirm(`¿Eliminar "${dish.name}"?`)) {
      await api(`/api/dishes/${dish.id}`, { method: "DELETE" });
      openDetail(state.currentRestaurantId);
    }
    return;
  }
  const name = prompt("Nombre del plato:", dish.name) || dish.name;
  const likedRaw = prompt("¿Te gustó? si / no / vacío", dish.liked === 1 ? "si" : dish.liked === 0 ? "no" : "");
  const liked = likedRaw?.toLowerCase().startsWith("s") ? 1 : likedRaw?.toLowerCase().startsWith("n") ? 0 : null;
  const notes = prompt("Notas:", dish.notes || "") || null;
  try {
    await api(`/api/dishes/${dish.id}`, { method: "PUT", body: JSON.stringify({ name, liked, notes }) });
    openDetail(state.currentRestaurantId);
  } catch (e) {
    toast(e.message);
  }
}

document.getElementById("delete-restaurant").addEventListener("click", async () => {
  if (!confirm("¿Eliminar este restaurante y todo su contenido?")) return;
  try {
    await api(`/api/restaurants/${state.currentRestaurantId}`, { method: "DELETE" });
    loadList();
  } catch (e) {
    toast(e.message);
  }
});

document.getElementById("edit-restaurant").addEventListener("click", async () => {
  const r = await api(`/api/restaurants/${state.currentRestaurantId}`);
  state.editingRestaurant = true;
  document.getElementById("form-title").textContent = "Editar mesa";
  document.getElementById("form-name").value = r.name;
  document.getElementById("form-address").value = r.address || "";
  document.getElementById("form-city").value = r.city || "";
  document.getElementById("form-phone").value = r.phone || "";
  document.getElementById("form-notes").value = r.notes || "";
  document.getElementById("form-shared").checked = !!r.shared;
  state.formLat = r.lat ?? null;
  state.formLng = r.lng ?? null;
  setRepeatToggle(r.repeat_visit === 1 ? "1" : r.repeat_visit === 0 ? "0" : "");
  showView("form");
});

document.getElementById("back-from-detail").addEventListener("click", loadList);

// ---------- Formulario (crear / editar) ----------

function setRepeatToggle(value) {
  state.formRepeatValue = value;
  document.querySelectorAll("#form-repeat-toggle .stamp-option").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.value === value);
  });
}

document.getElementById("form-repeat-toggle").addEventListener("click", (e) => {
  const btn = e.target.closest(".stamp-option");
  if (!btn) return;
  setRepeatToggle(btn.dataset.value);
});

document.getElementById("fab-add").addEventListener("click", () => {
  state.editingRestaurant = false;
  document.getElementById("form-title").textContent = "Nueva mesa";
  document.getElementById("form-name").value = "";
  document.getElementById("form-address").value = "";
  document.getElementById("form-city").value = "";
  document.getElementById("form-phone").value = "";
  document.getElementById("form-notes").value = "";
  document.getElementById("form-shared").checked = false;
  setRepeatToggle("");
  state.formLat = null;
  state.formLng = null;
  showView("form");
});

document.getElementById("back-from-form").addEventListener("click", () => {
  if (state.editingRestaurant) openDetail(state.currentRestaurantId);
  else loadList();
});

document.getElementById("save-restaurant").addEventListener("click", async () => {
  const name = document.getElementById("form-name").value.trim();
  if (!name) { toast("El nombre es obligatorio"); return; }
  const body = {
    name,
    address: document.getElementById("form-address").value.trim() || null,
    phone: document.getElementById("form-phone").value.trim() || null,
    notes: document.getElementById("form-notes").value.trim() || null,
    shared: document.getElementById("form-shared").checked,
    repeat_visit: state.formRepeatValue === "1" ? 1 : state.formRepeatValue === "0" ? 0 : null,
    city: document.getElementById("form-city").value.trim() || null,
    lat: state.formLat,
    lng: state.formLng,
  };
  try {
    if (state.editingRestaurant) {
      await api(`/api/restaurants/${state.currentRestaurantId}`, { method: "PUT", body: JSON.stringify(body) });
      openDetail(state.currentRestaurantId);
    } else {
      const { id } = await api("/api/restaurants", { method: "POST", body: JSON.stringify(body) });
      openDetail(id);
    }
  } catch (e) {
    toast(e.message);
  }
});

// ---------- Configuración ----------

document.getElementById("cfg-save").addEventListener("click", () => {
  const url = document.getElementById("cfg-url").value.trim().replace(/\/$/, "");
  const key = document.getElementById("cfg-key").value.trim();
  if (!url || !key) { toast("Rellena los dos campos"); return; }
  state.apiUrl = url;
  state.apiKey = key;
  state.me = null;
  localStorage.setItem("mesa_api_url", url);
  localStorage.setItem("mesa_api_key", key);
  loadList();
});

document.getElementById("open-settings").addEventListener("click", () => {
  document.getElementById("cfg-url").value = state.apiUrl;
  document.getElementById("cfg-key").value = state.apiKey;
  showView("config");
});

// ---------- Arranque ----------

if (state.apiUrl && state.apiKey) {
  loadList();
} else {
  showView("config");
}

// Service worker
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
