// Mesa — lógica de la PWA (vanilla JS, sin dependencias)

const state = {
  apiUrl: localStorage.getItem("mesa_api_url") || "",
  apiKey: localStorage.getItem("mesa_api_key") || "",
  currentRestaurantId: null,
  currentDishId: null,
  editingRestaurant: false,
  me: null,
};

const views = {
  config: document.getElementById("view-config"),
  list: document.getElementById("view-list"),
  detail: document.getElementById("view-detail"),
  form: document.getElementById("view-form"),
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
  const list = document.getElementById("restaurant-list");
  const empty = document.getElementById("list-empty");
  list.innerHTML = "";
  try {
    if (!state.me) {
      const me = await api("/api/me");
      state.me = me.owner;
    }
    const restaurants = await api("/api/restaurants");
    empty.classList.toggle("hidden", restaurants.length > 0);
    for (const r of restaurants) {
      const li = document.createElement("li");
      li.className = "ticket-card";
      const notMine = r.owner !== state.me;
      li.innerHTML = `
        ${r.cover_key
          ? `<img class="ticket-cover" src="${photoUrl(r.cover_key)}" alt="" />`
          : `<div class="ticket-cover-placeholder">${r.name.charAt(0).toUpperCase()}</div>`}
        <div class="ticket-info">
          <p class="ticket-name">${escapeHtml(r.name)}${notMine ? `<span class="ticket-shared-badge">${escapeHtml(r.owner)}</span>` : ""}</p>
          <p class="ticket-address">${escapeHtml(r.address || "")}</p>
        </div>`;
      li.addEventListener("click", () => openDetail(r.id));
      list.appendChild(li);
    }
  } catch (e) {
    toast(e.message);
  }
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
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
  document.getElementById("detail-name").textContent = r.name;

  const ownerTag = document.getElementById("detail-owner-tag");
  ownerTag.classList.toggle("hidden", r.mine);
  ownerTag.textContent = r.mine ? "" : `De ${r.owner}`;

  document.getElementById("edit-restaurant").classList.toggle("hidden", !r.mine);
  document.getElementById("delete-restaurant").classList.toggle("hidden", !r.mine);
  document.getElementById("add-dish").classList.toggle("hidden", !r.mine);
  document.querySelector(".upload-label").classList.toggle("hidden", !r.mine);

  const addrEl = document.getElementById("detail-address");
  if (r.address) {
    addrEl.textContent = "📍 " + r.address;
    addrEl.href = mapsUrl(r.address);
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

  const photosEl = document.getElementById("detail-photos");
  photosEl.innerHTML = "";
  for (const p of r.photos) {
    const img = document.createElement("img");
    img.src = photoUrl(p.r2_key);
    img.alt = "";
    img.addEventListener("click", () => {
      if (confirm("¿Eliminar esta foto?")) deletePhoto(p.id);
    });
    photosEl.appendChild(img);
  }

  const dishList = document.getElementById("dish-list");
  dishList.innerHTML = "";
  for (const d of r.dishes) {
    const li = document.createElement("li");
    li.className = "dish-row";
    const stampClass = d.liked === 1 ? "liked" : d.liked === 0 ? "disliked" : "neutral";
    const stampText = d.liked === 1 ? "SÍ" : d.liked === 0 ? "NO" : "—";
    const thumbs = (d.photos || [])
      .map((p) => `<img class="dish-thumb" data-photo-id="${p.id}" src="${photoUrl(p.r2_key)}" alt="" />`)
      .join("");
    li.innerHTML = `
      <div class="dish-row-main">
        <span class="stamp ${stampClass}">${stampText}</span>
        <span class="dish-name">${escapeHtml(d.name)}${d.notes ? `<span class="dish-notes">${escapeHtml(d.notes)}</span>` : ""}</span>
        ${r.mine ? `<button class="dish-photo-btn" data-dish-id="${d.id}" aria-label="Añadir foto al plato">📷</button>` : ""}
      </div>
      ${thumbs ? `<div class="dish-thumbs">${thumbs}</div>` : ""}`;
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
    li.querySelectorAll(".dish-thumb").forEach((img) => {
      img.addEventListener("click", (e) => {
        e.stopPropagation();
        if (confirm("¿Eliminar esta foto?")) deletePhoto(img.dataset.photoId);
      });
    });
    dishList.appendChild(li);
  }
}

async function deletePhoto(photoId) {
  try {
    await api(`/api/photos/${photoId}`, { method: "DELETE" });
    openDetail(state.currentRestaurantId);
  } catch (e) {
    toast(e.message);
  }
}

document.getElementById("photo-input").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const fd = new FormData();
    fd.append("photo", file);
    try {
      await api(`/api/restaurants/${state.currentRestaurantId}/photos`, { method: "POST", body: fd });
    } catch (err) {
      toast(err.message);
    }
  }
  e.target.value = "";
  openDetail(state.currentRestaurantId);
});

document.getElementById("dish-photo-input").addEventListener("change", async (e) => {
  const files = Array.from(e.target.files);
  for (const file of files) {
    const fd = new FormData();
    fd.append("photo", file);
    try {
      await api(`/api/dishes/${state.currentDishId}/photos`, { method: "POST", body: fd });
    } catch (err) {
      toast(err.message);
    }
  }
  e.target.value = "";
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
  document.getElementById("form-phone").value = r.phone || "";
  document.getElementById("form-notes").value = r.notes || "";
  document.getElementById("form-shared").checked = !!r.shared;
  showView("form");
});

document.getElementById("back-from-detail").addEventListener("click", loadList);

// ---------- Formulario (crear / editar) ----------

document.getElementById("fab-add").addEventListener("click", () => {
  state.editingRestaurant = false;
  document.getElementById("form-title").textContent = "Nueva mesa";
  document.getElementById("form-name").value = "";
  document.getElementById("form-address").value = "";
  document.getElementById("form-phone").value = "";
  document.getElementById("form-notes").value = "";
  document.getElementById("form-shared").checked = false;
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
