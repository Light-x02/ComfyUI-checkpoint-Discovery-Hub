import { app } from "/scripts/app.js";
import { api } from "/scripts/api.js";

(function () {

    // ======================================================================
    // [CDH] Constantes
    // ======================================================================
    const EXT_NAME = "CheckpointDiscoveryHub.UI";
    const TARGET_CLASS = "CheckpointDiscoveryHub";
    const DISPLAY_NAME = "🧬 Checkpoint Discovery Hub";

    // ======================================================================
    // [CDH] Utilitaires
    // ======================================================================
    const getJSON = async (url) => {
        const r = await api.fetchApi(url);
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return await r.json();
    };
    const postJSON = async (url, body) => {
        const r = await api.fetchApi(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body || {}),
        });
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
        return await r.json();
    };
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const safeStr = (x) => (x == null ? "" : String(x));

    const sanitizeProxyWidgets = (props) => {
        if (!props || typeof props !== "object" || Array.isArray(props)) return { proxyWidgets: [] };
        if ("proxyWidget" in props && !("proxyWidgets" in props)) {
            props.proxyWidgets = props.proxyWidget;
            delete props.proxyWidget;
        }
        if (!("proxyWidgets" in props)) props.proxyWidgets = [];
        else if (!Array.isArray(props.proxyWidgets)) {
            const v = props.proxyWidgets;
            if (v == null) props.proxyWidgets = [];
            else if (typeof v === "string") {
                const s = v.trim();
                if (!s) props.proxyWidgets = [];
                else if (s.startsWith("[") && s.endsWith("]")) {
                    try { const arr = JSON.parse(s); props.proxyWidgets = Array.isArray(arr) ? arr : [s]; }
                    catch { props.proxyWidgets = [s]; }
                } else props.proxyWidgets = [s];
            } else props.proxyWidgets = [];
        }
        return props;
    };

    // ======================================================================
    // [CDH] Enregistrement de l'extension
    // ======================================================================
    app.registerExtension({
        name: EXT_NAME,

        // --------------------------------------------------------------
        // [CDH] Hooks de définition du nœud
        // --------------------------------------------------------------
        beforeRegisterNodeDef(nodeType, nodeData) {
            const comfyClass = (nodeType?.comfyClass || nodeData?.name || "").toString();
            if (comfyClass !== TARGET_CLASS) return;

            // -- configure()
            const _configure = nodeType.prototype.configure;
            nodeType.prototype.configure = function (o, ...rest) {
                if (o && o.properties) o.properties = sanitizeProxyWidgets({ ...o.properties });
                const r = _configure?.call(this, o, ...rest);
                this.properties = this.properties || {};
                this.properties.__cdh = this.properties.__cdh || {};
                if (o?.properties?.__cdh) Object.assign(this.properties.__cdh, o.properties.__cdh);
                return r;
            };

            // -- onSerialize()
            const _onSerialize = nodeType.prototype.onSerialize;
            nodeType.prototype.onSerialize = function (o, ...rest) {
                const out = _onSerialize?.call(this, o, ...rest) ?? o ?? {};
                out.properties = out.properties || {};
                out.properties.__cdh = JSON.parse(JSON.stringify(this.properties?.__cdh || {}));
                if (out && out.properties) sanitizeProxyWidgets(out.properties);
                return out;
            };

            // --------------------------------------------------------------
            // [CDH] Création du nœud (UI + logique)
            // --------------------------------------------------------------
            const _onNodeCreated = nodeType.prototype.onNodeCreated;
            nodeType.prototype.onNodeCreated = function () {
                const r = _onNodeCreated?.apply(this, arguments);
                const node = this;

                // -------------------------
                // SECTION: Boot propriétés
                // -------------------------
                node.properties = sanitizeProxyWidgets(node.properties || {});
                node.properties.__cdh = node.properties.__cdh || {};

                if (!node.properties.__cdh.colored_once) {
                    node.color = "#000000";
                    node.bgcolor = "#0b0b0b";
                    node.boxcolor = "#1e1e1e";
                    node.title_color = "#ffffff";
                    node.properties.__cdh.colored_once = true;
                    node.setDirtyCanvas(true, true);
                }

                const wSel = node.addWidget(
                    "text",
                    "selection_data",
                    node.properties.__cdh.selection_data || "{}",
                    () => { },
                    { multiline: true }
                );
                wSel.serializeValue = () => node.properties.__cdh.selection_data || "{}";
                wSel.draw = function () { };
                wSel.computeSize = () => [0, -4];

                // -------------------------
                // SECTION: IDs & LS key
                // -------------------------
                const findUniqueIdWidget = () => node.widgets?.find((w) => w.name === "unique_id");
                const wUid = findUniqueIdWidget();
                const gallery_id = (wUid && wUid.value)
                    ? String(wUid.value)
                    : (node.properties.__cdh.gallery_id ? String(node.properties.__cdh.gallery_id) : String(node.id));
                node.properties.__cdh.gallery_id = gallery_id;

                const lsKey = (k) => `CDH:${location.pathname}:${TARGET_CLASS}:${node.id}:${k}`;

                // -------------------------
                // SECTION: UI Markup + CSS
                // -------------------------
                const uid = `cdh-${Math.random().toString(36).slice(2, 9)}`;
                const root = document.createElement("div");
                root.id = uid;
                root.innerHTML = `
<style>
#${uid} .cdh-hidden{display:none !important}
#${uid}{height:100%;width:100%;box-sizing:border-box}
#${uid} .cdh-root{height:100%;display:flex;flex-direction:column;gap:10px;color:var(--node-text-color);font-family:ui-sans-serif,system-ui,-apple-system;overflow:hidden;--cdh-accent:#39d0ff;--cdh-accent2:#6a5cff;--cdh-chip-bg:rgba(255,255,255,.06);--cdh-surface:rgba(20,20,30,.55);--cdh-border:rgba(255,255,255,.12);--cdh-shadow:0 10px 30px rgba(0,0,0,.35);background:radial-gradient(1200px 400px at -10% -10%, rgba(57,208,255,.10), transparent 70%),radial-gradient(900px 300px at 120% -20%, rgba(106,92,255,.08), transparent 60%);border-radius:14px}
#${uid} .cdh-header{position:relative;padding:10px 12px;border-radius:14px;background:linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02));border:1px solid var(--cdh-border);box-shadow:var(--cdh-shadow)}
#${uid} .cdh-title{display:flex;align-items:center;gap:10px;margin-bottom:8px;letter-spacing:.3px;font-weight:700}
#${uid} .cdh-title .dot{width:10px;height:10px;border-radius:50%;background:radial-gradient(closest-side, var(--cdh-accent), transparent);box-shadow:0 0 12px var(--cdh-accent)}
#${uid} .cdh-controls{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:8px}
#${uid} .cdh-input,#${uid} .cdh-select{padding:8px 10px;border:1px solid var(--cdh-border);background:var(--cdh-surface);color:var(--node-text-color);border-radius:10px;height:32px;backdrop-filter:blur(8px)}
#${uid} .cdh-select{appearance:none;background-image:linear-gradient(45deg, transparent 50%, var(--cdh-accent) 50%),linear-gradient(135deg, var(--cdh-accent) 50%, transparent 50%);background-position:calc(100% - 16px) calc(50% + 3px), calc(100% - 12px) calc(50% + 3px);background-size:6px 6px, 6px 6px;background-repeat:no-repeat;padding-right:26px}
#${uid} .cdh-btn{padding:8px 12px;border:1px solid var(--cdh-border);background:linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.02));border-radius:10px;cursor:pointer;user-select:none;position:relative;overflow:hidden;transition:.18s ease;box-shadow:var(--cdh-shadow)}
#${uid} .cdh-btn.toggle.on{color:#22c55e;border-color:#22c55e66}
#${uid} .cdh-btn.toggle.off{color:#ef4444;border-color:#ef444466}
#${uid} .cdh-chip{font-size:12px;background:var(--cdh-chip-bg);border:1px solid var(--cdh-border);padding:4px 10px;border-radius:999px}
#${uid} .cdh-scroll{flex:1;min-height:0;overflow:auto;border-radius:14px;background:linear-gradient(180deg, rgba(255,255,255,.02), rgba(255,255,255,.01));border:1px solid var(--cdh-border);padding:10px;backdrop-filter:blur(4px);box-shadow:var(--cdh-shadow)}
#${uid} .cdh-scroll::-webkit-scrollbar{width:10px;height:10px}
#${uid} .cdh-scroll::-webkit-scrollbar-thumb{background:linear-gradient(var(--cdh-accent), var(--cdh-accent2));border-radius:10px}
#${uid} .cdh-masonry{column-gap:12px;--colw:260px;column-width:var(--colw)}
#${uid} .cdh-card{display:inline-block;width:100%;margin:0 0 12px;border:1px solid var(--cdh-border);border-radius:14px;overflow:hidden;background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.02));position:relative;break-inside:avoid;opacity:0;transform:translateY(6px);transition:opacity .18s ease, transform .18s ease, box-shadow .2s ease;box-shadow:var(--cdh-shadow)}
#${uid} .cdh-card.show{opacity:1;transform:translateY(0)}
#${uid} .cdh-card:hover{box-shadow:0 0 24px rgba(57,208,255,.13), var(--cdh-shadow)}
#${uid} .cdh-card.selected{outline:2px solid #3aa9ff;outline-offset:-2px;box-shadow:0 0 28px rgba(58,169,255,.18), var(--cdh-shadow)}
#${uid} .cdh-name{padding:8px 10px;font-size:12px;line-height:1.35;border-bottom:1px solid var(--cdh-border);background:rgba(255,255,255,.04);word-break:break-all}

/* media wrapper (for overlay tools) */
#${uid} .cdh-media-wrap{position:relative}
#${uid} .cdh-media{width:100%;height:auto;display:block;background:#0e0f13}
#${uid} .cdh-vid{max-height:72vh}

/* top-left overlay tools (show on hover) */
#${uid} .cdh-corner-tools{position:absolute;top:10px;left:10px;display:flex;gap:8px;z-index:6;opacity:0}
#${uid} .cdh-card:hover .cdh-corner-tools, #${uid} .cdh-media-wrap:hover .cdh-corner-tools{opacity:1}
#${uid} .cdh-card-btn{width:26px;height:26px;border-radius:50%;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;font-size:14px;color:#fff;cursor:pointer;border:1px solid var(--cdh-border);transition:transform .15s ease,opacity .18s ease}
#${uid} .cdh-card-btn:hover{transform:scale(1.06)}
#${uid} .cdh-card-btn.loading{animation:spin 1s linear infinite;background:#4a90e2}
@keyframes spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}

/* bottom meta + star */
#${uid} .cdh-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px 10px}
#${uid} .cdh-left{display:flex;align-items:center;gap:8px}
#${uid} .cdh-open{font-size:12px;text-decoration:none;border:1px solid var(--cdh-border);padding:4px 8px;border-radius:8px;background:var(--cdh-surface);color:var(--node-text-color);opacity:.95}

/* star favorite (bottom-left) */
#${uid} .cdh-star{cursor:pointer;user-select:none;font-size:16px;line-height:1;display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;margin-right:6px;opacity:.95;transition:.15s ease}
#${uid} .cdh-star:hover{transform:scale(1.08)}
#${uid} .cdh-star.on{color:#ffd043;text-shadow:0 0 10px rgba(255,208,67,.45)}

/* preset helpers */
#${uid} .cdh-preset-actions{display:flex;align-items:center;gap:8px}
#${uid} .cdh-preset-dd .cdh-preset-row.active{background:rgba(57,208,255,.12)}
</style>

<div class="cdh-root">
  <div class="cdh-header">
    <div class="cdh-title"><span class="dot"></span><div>${DISPLAY_NAME}</div></div>

    <div class="cdh-controls">
      <label>Folder</label>
      <select class="cdh-select cdh-folder"><option value="">All Folders</option></select>

      <label>UNet dtype</label>
      <select class="cdh-select cdh-dtype">
        <option value="default">default</option>
        <option value="fp8_e4m3fn">fp8_e4m3fn</option>
        <option value="fp8_e4m3fn_fast">fp8_e4m3fn_fast</option>
        <option value="fp8_e5m2">fp8_e5m2</option>
      </select>

      <label>CLIP type</label>
      <select class="cdh-select cdh-cliptype"></select>

      <label>Device</label>
      <select class="cdh-select cdh-device">
        <option value="default">default</option>
        <option value="cpu">cpu</option>
      </select>

      <label class="cdh-clip1-label">CLIP 1</label>
      <select class="cdh-select cdh-clip1"></select>

      <label class="cdh-clip2-label">CLIP 2</label>
      <select class="cdh-select cdh-clip2"></select>

      <label>VAE</label>
      <select class="cdh-select cdh-vae"></select>

      <button class="cdh-btn cdh-save">Save Preset</button>
      <div style="position:relative;display:inline-block">
        <button class="cdh-btn cdh-load">Load Preset ▼</button>
        <div class="cdh-preset-dd cdh-hidden" style="position:absolute;right:0;top:calc(100% + 6px);min-width:220px;background:var(--cdh-surface);border:1px solid var(--cdh-border);border-radius:10px;box-shadow:var(--cdh-shadow);z-index:50;max-height:280px;overflow:auto"></div>
      </div>

      <!-- NEW: active preset + actions -->
      <div class="cdh-preset-actions">
        <span class="cdh-chip">Preset: <b class="cdh-active-preset-label">None</b></span>
        <button class="cdh-btn cdh-preset-rename" title="Rename selected preset">Rename</button>
        <button class="cdh-btn cdh-preset-clear" title="Deselect preset">Deselect</button>
      </div>

      <button class="cdh-btn toggle cdh-favonly">Favorites: OFF</button>

      <span style="flex:1"></span>
      <button class="cdh-btn toggle cdh-toggle">Gallery: ON</button>
      <span class="cdh-chip cdh-selected-chip">Selected: <b class="cdh-selected-chip-label">None</b></span>
    </div>
  </div>

  <div class="cdh-scroll">
    <div class="cdh-masonry"></div>
    <div class="cdh-empty cdh-hidden">No checkpoints found.</div>
    <div class="cdh-sentinel"></div>
  </div>

  <div class="cdh-foot">
    <span class="cdh-status" style="margin-left:auto"></span>
  </div>
</div>
`;
                node.addDOMWidget("cdh_gallery", "div", root, {});
                node.size = [1120, 820];


                // -------------------------
                // SECTION: Références DOM
                // -------------------------
                const MIN_W = 900, MIN_H = 650, MIN_H_COLLAPSED = 310;
                const $ = (s) => root.querySelector(s);

                const elFolder = $(".cdh-folder");
                const elDType = $(".cdh-dtype");
                const elClipType = $(".cdh-cliptype");
                const elDevice = $(".cdh-device");
                const elClip1 = $(".cdh-clip1");
                const elClip2 = $(".cdh-clip2");
                const elClip1Lbl = $(".cdh-clip1-label");
                const elClip2Lbl = $(".cdh-clip2-label");
                const elVAE = $(".cdh-vae");

                const elSave = $(".cdh-save");
                const elLoad = $(".cdh-load");
                const elPresetDD = $(".cdh-preset-dd");

                const elToggle = $(".cdh-toggle");
                const elFavOnly = $(".cdh-favonly");
                const elControls = root.querySelector(".cdh-controls");
                const elSelChip = $(".cdh-selected-chip-label");

                // NEW refs
                const elActivePresetLbl = $(".cdh-active-preset-label");
                const btnPresetRename = $(".cdh-preset-rename");
                const btnPresetClear = $(".cdh-preset-clear");

                const elScroll = root.querySelector(".cdh-scroll");
                const elGrid = root.querySelector(".cdh-masonry");
                const elEmpty = root.querySelector(".cdh-empty");
                const elSentinel = root.querySelector(".cdh-sentinel");
                const elStatus = root.querySelector(".cdh-status");

                // -------------------------
                // SECTION: État
                // -------------------------
                let state = {
                    galleryOn: true,
                    folder: "",
                    selectedCkpt: "",
                    dtype: "default",
                    clipType: "flux",
                    clipDevice: "default",
                    clip1: "",
                    clip2: "",
                    vae: "",
                    favoritesOnly: false,
                    page: 1,
                    totalPages: 1,
                    perPage: 60,
                    // NEW: preset actif (nom)
                    activePreset: ""
                };
                let clipLabelMap = {};

                // ==================================================================
                // [CDH] Persistance (LocalStorage + serveur)  ----------------------
                // ==================================================================
                const loadLocal = () => {
                    try {
                        const raw = localStorage.getItem(lsKey("state"));
                        if (raw) state = { ...state, ...(JSON.parse(raw) || {}) };
                    } catch { }
                    const p = node.properties?.__cdh || {};
                    if (typeof p.gallery_on === "boolean") state.galleryOn = p.gallery_on;
                    state.folder = p.folder || state.folder;
                    state.selectedCkpt = p.selected_ckpt || state.selectedCkpt;
                    state.dtype = p.weight_dtype || state.dtype;
                    if (p.clip) {
                        state.clipType = p.clip.type || state.clipType;
                        state.clipDevice = p.clip.device || state.clipDevice;
                        state.clip1 = p.clip.clip_name_1 || state.clip1;
                        state.clip2 = p.clip.clip_name_2 || state.clip2;
                    }
                    if (p.vae) state.vae = p.vae.vae_name || state.vae;
                    if (p.state && typeof p.state === "object") {
                        if ("favoritesOnly" in p.state) state.favoritesOnly = !!p.state.favoritesOnly;
                        if ("activePreset" in p.state) state.activePreset = p.state.activePreset || "";
                    }
                };
                const saveLocal = () => {
                    try { localStorage.setItem(lsKey("state"), JSON.stringify(state)); } catch { }
                    try {
                        node.properties.__cdh.gallery_on = state.galleryOn;
                        node.properties.__cdh.folder = state.folder;
                        node.properties.__cdh.selected_ckpt = state.selectedCkpt;
                        node.properties.__cdh.weight_dtype = state.dtype;
                        node.properties.__cdh.clip = {
                            type: state.clipType,
                            device: state.clipDevice,
                            clip_name_1: state.clip1,
                            clip_name_2: state.clip2,
                        };
                        node.properties.__cdh.vae = { vae_name: state.vae };
                        node.properties.__cdh.state = JSON.parse(JSON.stringify(state));
                    } catch { }
                };
                const pushSelection = () => {
                    const payload = {
                        ckpt: state.selectedCkpt || "",
                        weight_dtype: state.dtype || "default",
                        clip: {
                            clip_name_1: state.clip1 || "",
                            clip_name_2: state.clip2 || "",
                            type: state.clipType || "flux",
                            device: state.clipDevice || "default",
                        },
                        vae: { vae_name: state.vae || "" },
                    };
                    node.properties.__cdh.selection_data = JSON.stringify(payload);
                    const w = node.widgets?.find((w) => w.name === "selection_data");
                    if (w) w.value = node.properties.__cdh.selection_data;
                    node.setDirtyCanvas(true, true);

                    postJSON("/localckptgallery/set_ui_state", {
                        node_id: node.id,
                        gallery_id,
                        state: {
                            gallery_on: state.galleryOn,
                            folder: state.folder,
                            selected_ckpt: state.selectedCkpt,
                            weight_dtype: state.dtype,
                            clip: {
                                type: state.clipType,
                                device: state.clipDevice,
                                clip_name_1: state.clip1,
                                clip_name_2: state.clip2,
                            },
                            vae: { vae_name: state.vae },
                            favorites_only: !!state.favoritesOnly,
                            // on pousse aussi le preset actif côté UI
                            active_preset: state.activePreset || ""
                        },
                    }).catch(() => { });
                };

                // ==================================================================
                // [CDH] Helpers UI (sélecteurs)  -----------------------------------
                // ==================================================================
                const fillSelectEnsureKeep = (sel, list, keep) => {
                    const arr = Array.from(new Set((list || []).map(String)));
                    const target = keep == null ? "" : String(keep);
                    if (target && !arr.includes(target)) arr.unshift(target);
                    sel.replaceChildren();
                    for (const v of arr) sel.appendChild(new Option(v, v));
                    sel.value = target || (sel.options[0]?.value || "");
                };
                const setIfExistsOrKeep = (sel, val) => {
                    if (!sel) return;
                    const v = String(val ?? "");
                    if (!v) return;
                    const ok = [...sel.options].some(o => o.value === v);
                    if (!ok) sel.prepend(new Option(v, v));
                    sel.value = v;
                };

                // ==================================================================
                // [CDH] Presets  ---------------------------------------------------
                // ==================================================================
                const cssEscape = (window.CSS && CSS.escape) ? (s) => CSS.escape(s) : (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, "\\$&");

                const updateActivePresetUI = () => {
                    elActivePresetLbl.textContent = state.activePreset || "None";
                    // highlight dans la liste si ouverte
                    elPresetDD.querySelectorAll(".cdh-preset-row").forEach(r => {
                        r.classList.toggle("active", r.dataset.name === state.activePreset);
                    });
                };

                const renderPresets = (presets) => {
                    const dd = elPresetDD;
                    dd.classList.add("cdh-hidden");
                    dd.replaceChildren();
                    Object.entries(presets || {}).forEach(([name, data]) => {
                        const row = document.createElement("div");
                        row.className = "cdh-preset-row";
                        row.dataset.name = name;
                        row.style.display = "flex";
                        row.style.alignItems = "center";
                        row.style.justifyContent = "space-between";
                        row.style.gap = "6px";
                        row.style.padding = "8px 10px";
                        row.style.borderBottom = "1px solid var(--cdh-border)";

                        const a = document.createElement("a");
                        a.href = "#";
                        a.textContent = name;
                        a.style.color = "var(--node-text-color)";
                        a.style.textDecoration = "none";
                        a.style.flex = "1";
                        a.addEventListener("click", (e) => {
                            e.preventDefault();
                            try {
                                const sel = JSON.parse(JSON.stringify(data || {}));
                                if (sel?.clip?.type && /flux\s*\/\s*sd3/i.test(sel.clip.type)) sel.clip.type = "flux";
                                state.selectedCkpt = safeStr(sel.ckpt || state.selectedCkpt);
                                state.dtype = safeStr(sel.weight_dtype || state.dtype);
                                state.clipType = safeStr(sel.clip?.type || state.clipType);
                                state.clipDevice = safeStr(sel.clip?.device || state.clipDevice);
                                state.clip1 = safeStr(sel.clip?.clip_name_1 || state.clip1);
                                state.clip2 = safeStr(sel.clip?.clip_name_2 || state.clip2);
                                state.vae = safeStr(sel.vae?.vae_name || state.vae);
                                state.activePreset = name;                           // NEW: mémorise le preset actif
                                saveLocal(); pushSelection(); syncControls(); applyClipLabels(); resetAndReload();
                                updateActivePresetUI();
                            } catch (err) { console.error("Preset load failed:", err); }
                            finally { dd.classList.add("cdh-hidden"); }
                        });

                        const del = document.createElement("button");
                        del.textContent = "✖";
                        del.title = "Delete preset";
                        del.className = "cdh-btn";
                        del.style.padding = "4px 8px";
                        del.addEventListener("click", async (e) => {
                            e.stopPropagation(); e.preventDefault();
                            if (!confirm(`Delete preset "${name}" ?`)) return;
                            try {
                                const res = await postJSON("/localckptgallery/delete_preset", { name });
                                if (state.activePreset === name) { state.activePreset = ""; saveLocal(); updateActivePresetUI(); }
                                renderPresets(res.presets);
                            } catch (err) { console.error(err); }
                        });

                        row.appendChild(a);
                        row.appendChild(del);
                        dd.appendChild(row);
                    });
                    updateActivePresetUI();
                };

                const loadPresets = async () => {
                    try { renderPresets(await getJSON("/localckptgallery/get_presets")); }
                    catch (e) { console.error("Load presets failed:", e); }
                };

                // save preset (inchangé) + MAJ preset actif si on le souhaite
                elSave.addEventListener("click", async () => {
                    const name = prompt("Preset name:", ""); if (!name) return;
                    if (!state.selectedCkpt) { alert("Select a checkpoint first."); return; }
                    if (!state.vae) { alert("Select a VAE first."); return; }
                    const payload = {
                        ckpt: state.selectedCkpt, weight_dtype: state.dtype,
                        clip: { clip_name_1: state.clip1, clip_name_2: state.clip2, type: state.clipType, device: state.clipDevice },
                        vae: { vae_name: state.vae },
                    };
                    try {
                        const res = await postJSON("/localckptgallery/save_preset", { name, data: payload });
                        state.activePreset = name; saveLocal(); updateActivePresetUI();
                        renderPresets(res.presets);
                    } catch (e) { console.error(e); }
                });

                // ouvrir/fermer la liste
                elLoad.addEventListener("click", (e) => { e.stopPropagation(); elPresetDD.classList.toggle("cdh-hidden"); });
                document.addEventListener("click", (e) => {
                    if (!root.contains(e.target)) return;
                    if (!elPresetDD.contains(e.target) && !elLoad.contains(e.target)) elPresetDD.classList.add("cdh-hidden");
                });


                // NEW: Renommer le preset sélectionné (save + delete)
                btnPresetRename.addEventListener("click", async () => {
                    if (!state.activePreset) { alert("No preset selected."); return; }
                    const newName = prompt("New preset name:", state.activePreset);
                    if (!newName || newName === state.activePreset) return;
                    try {
                        const all = await getJSON("/localckptgallery/get_presets");
                        const data = all[state.activePreset];
                        if (!data) { alert("Preset not found."); return; }
                        await postJSON("/localckptgallery/save_preset", { name: newName, data });
                        await postJSON("/localckptgallery/delete_preset", { name: state.activePreset });
                        state.activePreset = newName; saveLocal(); updateActivePresetUI();
                        await loadPresets();
                    } catch (e) { console.error("Rename failed:", e); }
                });

                // NEW: Désélectionner le preset actif (n’en charge aucun)
                btnPresetClear.addEventListener("click", () => {
                    state.activePreset = "";
                    saveLocal(); updateActivePresetUI();
                });

                // ==================================================================
                // [CDH] Toggles + sizing  ------------------------------------------
                // ==================================================================
                const setGalleryState = (on) => {
                    state.galleryOn = !!on; saveLocal(); pushSelection();
                    elToggle.classList.toggle("on", state.galleryOn);
                    elToggle.classList.toggle("off", !state.galleryOn);
                    elToggle.textContent = state.galleryOn ? "Gallery: ON" : "Gallery: OFF";
                    elSelChip.textContent = state.selectedCkpt || "None";
                    if (state.galleryOn) {
                        elControls.classList.remove("cdh-hidden");
                        elScroll.classList.remove("cdh-hidden");
                        root.querySelector(".cdh-foot")?.classList.remove("cdh-hidden");
                        adjustExpanded();
                    } else {
                        elControls.classList.remove("cdh-hidden");
                        elScroll.classList.add("cdh-hidden");
                        root.querySelector(".cdh-foot")?.classList.add("cdh-hidden");
                        adjustCollapsed();
                    }
                    node.setDirtyCanvas(true, true);
                };
                elToggle.addEventListener("click", () => setGalleryState(!state.galleryOn));

                const adjustExpanded = () => {
                    const headerH = root.querySelector(".cdh-header")?.offsetHeight || 160;
                    const footH = root.querySelector(".cdh-foot")?.offsetHeight || 50;
                    const desired = clamp(headerH + 520 + footH + 20, MIN_H, 2200);
                    if (node.size[1] < desired) node.size[1] = desired;
                    if (node.size[0] < MIN_W) node.size[0] = MIN_W;
                    node.setDirtyCanvas(true, true);
                };
                const adjustCollapsed = () => {
                    const headerH = root.querySelector(".cdh-header")?.offsetHeight || 180;
                    const desired = clamp(headerH + 12, MIN_H_COLLAPSED, 800);
                    node.size[1] = desired;
                    if (node.size[0] < MIN_W) node.size[0] = MIN_W;
                    node.setDirtyCanvas(true, true);
                };
                node.onResize = function (size) {
                    if (size[0] < MIN_W) size[0] = MIN_W;
                    if (state.galleryOn) { if (size[1] < MIN_H) size[1] = MIN_H; }
                    else { if (size[1] < MIN_H_COLLAPSED) size[1] = MIN_H_COLLAPSED; }
                    requestAnimationFrame(recalcCols);
                    return size;
                };
                const recalcCols = () => {
                    const w = elScroll.clientWidth || root.clientWidth || 900;
                    const colw = clamp(Math.floor(w / Math.ceil(w / 260)), 220, 360);
                    elGrid.style.setProperty("--colw", `${colw}px`);
                };
                new ResizeObserver(() => { recalcCols(); state.galleryOn ? adjustExpanded() : adjustCollapsed(); }).observe(elScroll);

                // ==================================================================
                // [CDH] Options loaders + labels CLIP  -----------------------------
                // ==================================================================
                const populateOptions = async () => {
                    try {
                        const opts = await getJSON("/localckptgallery/get_loader_options");
                        clipLabelMap = opts.clip_label_map || {};
                        const clipFiles = Array.isArray(opts.clip_files) ? opts.clip_files.slice() : [];
                        if (!clipFiles.includes("None")) clipFiles.unshift("None");

                        fillSelectEnsureKeep(elClipType, opts.clip_types || ["flux", "sd3"], state.clipType);
                        fillSelectEnsureKeep(elDevice, opts.clip_devices || ["default", "cpu"], state.clipDevice);
                        fillSelectEnsureKeep(elClip1, clipFiles, state.clip1 || "None");
                        fillSelectEnsureKeep(elClip2, clipFiles, state.clip2 || "None");
                        fillSelectEnsureKeep(elVAE, opts.vae_files || [], state.vae);
                        fillSelectEnsureKeep(elDType, opts.unet_dtypes || ["default"], state.dtype);

                        setIfExistsOrKeep(elClipType, state.clipType);
                        setIfExistsOrKeep(elDevice, state.clipDevice);
                        setIfExistsOrKeep(elClip1, state.clip1 || "None");
                        setIfExistsOrKeep(elClip2, state.clip2 || "None");
                        setIfExistsOrKeep(elVAE, state.vae);
                        setIfExistsOrKeep(elDType, state.dtype);

                        syncControls();
                        applyClipLabels();
                    } catch (e) {
                        console.error("get_loader_options failed:", e);
                    }
                };
                const applyClipLabels = () => {
                    const type = (state.clipType || "").toLowerCase();
                    const labels = clipLabelMap[type] || null;
                    const l1 = labels?.[0] || "CLIP 1";
                    const l2 = labels?.[1] || "CLIP 2";
                    if (elClip1Lbl) elClip1Lbl.textContent = l1;
                    if (elClip2Lbl) elClip2Lbl.textContent = l2;

                    const unused2 = /\(unused\)/i.test(l2);
                    if (unused2) {
                        if (![...elClip2.options].some(o => o.value === "None")) {
                            elClip2.prepend(new Option("None", "None"));
                        }
                        elClip2.value = "None";
                        elClip2.disabled = true;
                        state.clip2 = "None";
                    } else {
                        elClip2.disabled = false;
                    }
                    saveLocal(); pushSelection();
                };
                const syncControls = () => {
                    const setIf = (sel, val) => {
                        if (!sel) return;
                        const v = String(val ?? "");
                        if (!v) return;
                        const ok = [...sel.options].some(o => o.value === v);
                        if (!ok) sel.prepend(new Option(v, v));
                        sel.value = v;
                    };
                    setIf(elClipType, state.clipType);
                    setIf(elDevice, state.clipDevice);
                    setIf(elClip1, state.clip1 || "None");
                    setIf(elClip2, state.clip2 || "None");
                    setIf(elVAE, state.vae);
                    setIf(elDType, state.dtype);
                    elSelChip.textContent = state.selectedCkpt || "None";
                    elFavOnly.classList.toggle("on", !!state.favoritesOnly);
                    elFavOnly.classList.toggle("off", !state.favoritesOnly);
                    elFavOnly.textContent = `Favorites: ${state.favoritesOnly ? "ON" : "OFF"}`;
                };

                // Events selects
                elClipType.addEventListener("change", () => { state.clipType = elClipType.value; saveLocal(); applyClipLabels(); });
                elDevice.addEventListener("change", () => { state.clipDevice = elDevice.value; saveLocal(); pushSelection(); });
                elClip1.addEventListener("change", () => { state.clip1 = elClip1.value; saveLocal(); pushSelection(); });
                elClip2.addEventListener("change", () => { state.clip2 = elClip2.value; saveLocal(); pushSelection(); });
                elVAE.addEventListener("change", () => { state.vae = elVAE.value; saveLocal(); pushSelection(); });
                elDType.addEventListener("change", () => { state.dtype = elDType.value; saveLocal(); pushSelection(); });

                elFavOnly.addEventListener("click", () => {
                    state.favoritesOnly = !state.favoritesOnly;
                    saveLocal(); pushSelection(); syncControls(); resetAndReload();
                });

                // ==================================================================
                // [CDH] Galerie + favoris  -----------------------------------------
                // ==================================================================
                let loadingPage = false;
                let ioSentinel = null;
                const setStatus = (msg) => (elStatus.textContent = msg || "");
                const clearGrid = () => { elGrid.replaceChildren(); elEmpty.classList.add("cdh-hidden"); };

                const updateMetadata = async (ckptName, data) => {
                    try { await postJSON("/localckptgallery/update_metadata", { ckpt_name: ckptName, ...(data || {}) }); }
                    catch (e) { console.error("update_metadata failed:", e); }
                };
                const setFavorite = async (ckptName, fav) => {
                    try { await postJSON("/localckptgallery/set_favorite", { ckpt_name: ckptName, fav: !!fav }); }
                    catch (e) { console.error("set_favorite failed:", e); }
                };

                // ✅ Passe l'objet `itemRef` pour MAJ live du lien "Open"
                const syncWithCivitai = async (ckptName, card, itemRef) => {
                    const btn = card.querySelector(".cdh-sync");
                    if (!btn) return;
                    const prev = btn.textContent;
                    btn.textContent = "🔄"; btn.classList.add("loading");
                    try {
                        const res = await postJSON("/localckptgallery/sync_civitai", { ckpt_name: ckptName });
                        if (res?.status === "ok" && res.metadata) {
                            const { preview_url, preview_type, download_url } = res.metadata;

                            // maj media
                            const media = card.querySelector(".cdh-media");
                            if (preview_type === "video" && preview_url) {
                                const v = document.createElement("video");
                                v.className = "cdh-media cdh-vid"; v.controls = true; v.muted = true; v.playsInline = true; v.preload = "metadata"; v.src = preview_url;
                                media?.replaceWith(v);
                            } else {
                                const img = document.createElement("img");
                                img.className = "cdh-media"; img.loading = "lazy"; img.alt = ckptName; img.src = preview_url || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                                media?.replaceWith(img);
                            }

                            // maj du lien "Open" + état interne pour le handler de clic
                            const open = card.querySelector(".cdh-open");
                            if (open) {
                                itemRef.download_url = download_url || ""; // <— MAJ l'objet utilisé par le listener
                                if (itemRef.download_url) {
                                    open.href = itemRef.download_url;
                                    open.textContent = "Open ↗";
                                    open.target = "_blank";
                                    open.rel = "noopener noreferrer";
                                } else {
                                    open.href = "#";
                                    open.textContent = "—";
                                }
                            }
                        }
                    } catch (e) {
                        console.error("sync_civitai failed:", e);
                        btn.textContent = "❌";
                        setTimeout(() => { btn.textContent = prev; }, 1400);
                        return;
                    } finally {
                        btn.classList.remove("loading");
                        btn.textContent = prev;
                    }
                };

                const makeCard = (item) => {
                    const card = document.createElement("div");
                    card.className = "cdh-card";
                    card.dataset.ckpt = item.name;

                    // title
                    const name = document.createElement("div");
                    name.className = "cdh-name";
                    const displayName = (item.name || "").toString().split(/[\\/]/).pop();
                    name.textContent = displayName || item.name || "";
                    card.appendChild(name);

                    // media + top-left overlay tools
                    const mediaWrap = document.createElement("div");
                    mediaWrap.className = "cdh-media-wrap";

                    const tools = document.createElement("div");
                    tools.className = "cdh-corner-tools";

                    const syncBtn = document.createElement("div");
                    syncBtn.className = "cdh-card-btn cdh-sync";
                    syncBtn.title = "Sync with Civitai";
                    syncBtn.textContent = "☁️";
                    // ⬇️ passe `item` à la fonction pour MAJ live du lien
                    syncBtn.addEventListener("click", (e) => { e.stopPropagation(); syncWithCivitai(item.name, card, item); });
                    tools.appendChild(syncBtn);

                    const editBtn = document.createElement("div");
                    editBtn.className = "cdh-card-btn cdh-edit";
                    editBtn.title = "Edit download URL";
                    editBtn.textContent = "✏️";
                    editBtn.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        const cur = item.download_url || "";
                        const nv = prompt("Download URL:", cur);
                        if (nv == null) return;
                        await updateMetadata(item.name, { download_url: nv.trim() });
                        item.download_url = nv.trim();
                        const a = card.querySelector(".cdh-open");
                        if (a) {
                            if (item.download_url) { a.href = item.download_url; a.textContent = "Open ↗"; }
                            else { a.href = "#"; a.textContent = "—"; }
                        }
                    });
                    tools.appendChild(editBtn);

                    // media element
                    let mediaEl;
                    if (item.preview_type === "video" && item.preview_url) {
                        mediaEl = document.createElement("video");
                        mediaEl.className = "cdh-media cdh-vid"; mediaEl.controls = true; mediaEl.muted = true; mediaEl.playsInline = true; mediaEl.preload = "metadata"; mediaEl.src = item.preview_url;
                    } else {
                        mediaEl = document.createElement("img");
                        mediaEl.className = "cdh-media"; mediaEl.loading = "lazy"; mediaEl.alt = displayName || item.name; mediaEl.src = item.preview_url || "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
                    }
                    mediaWrap.appendChild(mediaEl);
                    mediaWrap.appendChild(tools);
                    card.appendChild(mediaWrap);

                    // bottom meta + star
                    const meta = document.createElement("div");
                    meta.className = "cdh-meta";

                    const left = document.createElement("div");
                    left.className = "cdh-left";

                    const star = document.createElement("span");
                    star.className = "cdh-star";
                    const refreshStar = () => {
                        if (item.is_favorite) { star.classList.add("on"); star.textContent = "★"; }
                        else { star.classList.remove("on"); star.textContent = "☆"; }
                    };
                    refreshStar();
                    star.title = "Toggle favorite";
                    star.addEventListener("click", async (e) => {
                        e.stopPropagation();
                        item.is_favorite = !item.is_favorite;
                        refreshStar();
                        await setFavorite(item.name, item.is_favorite);
                        if (state.favoritesOnly && !item.is_favorite) {
                            card.remove();
                            if (!elGrid.children.length) elEmpty.classList.remove("cdh-hidden");
                        }
                    });
                    left.appendChild(star);

                    const chip = document.createElement("span");
                    chip.className = "cdh-chip";
                    const prettyFolder = (raw) => {
                        if (!raw || raw === ".") return "Root";
                        const s = String(raw).replaceAll("\\", "/");
                        const noPrefix = s.replace(/^(\.\.\/)+/g, "").replace(/^\.\/?/g, "").replace(/^(?:diffusion_models\/)/i, "");
                        const parts = noPrefix.split("/").filter(Boolean);
                        return parts.length ? parts[parts.length - 1] : "Root";
                    };
                    chip.textContent = prettyFolder(item.folder);
                    left.appendChild(chip);
                    meta.appendChild(left);

                    const open = document.createElement("a");
                    open.className = "cdh-open";
                    open.href = item.download_url || "#"; open.target = "_blank"; open.rel = "noopener noreferrer";
                    open.textContent = item.download_url ? "Open ↗" : "—";
                    open.addEventListener("click", (e) => { if (!item.download_url) e.preventDefault(); e.stopPropagation(); });
                    meta.appendChild(open);

                    card.appendChild(meta);

                    const refreshSelectClass = () => card.classList.toggle("selected", state.selectedCkpt === item.name);
                    refreshSelectClass();
                    card.addEventListener("click", () => {
                        state.selectedCkpt = item.name;
                        saveLocal(); pushSelection();
                        elGrid.querySelectorAll(".cdh-card.selected").forEach(c => c.classList.remove("selected"));
                        card.classList.add("selected");
                        elSelChip.textContent = state.selectedCkpt || "None";
                    });

                    requestAnimationFrame(() => card.classList.add("show"));
                    return card;
                };

                const appendGrid = (items) => {
                    const sorted = (items || []).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
                    const seen = new Set([...elGrid.querySelectorAll(".cdh-card")].map(c => c.dataset.ckpt));
                    const nodes = [];
                    for (const it of sorted) {
                        if (seen.has(it.name)) continue;
                        nodes.push(makeCard(it));
                        seen.add(it.name);
                    }
                    if (nodes.length) elGrid.append(...nodes);
                    if (!elGrid.children.length) elEmpty.classList.remove("cdh-hidden");
                    else elEmpty.classList.add("cdh-hidden");
                };


                // ==================================================================
                // [CDH] Pagination + chargement  -----------------------------------
                // ==================================================================
                const loadPage = async (next = false) => {
                    if (!state.galleryOn) return;
                    if (loadingPage) return;
                    if (next && state.page >= state.totalPages) return;
                    loadingPage = true;
                    setStatus("Loading…");
                    try {
                        const page = next ? state.page + 1 : 1;
                        const favFlag = state.favoritesOnly ? "1" : "0";
                        const url = `/localckptgallery/get_checkpoints?folder=${encodeURIComponent(state.folder || "")}` +
                            `&page=${page}&per_page=${state.perPage}&selected_ckpt=${encodeURIComponent(state.selectedCkpt || "")}` +
                            `&favorites_only=${favFlag}`;
                        const data = await getJSON(url);

                        if (page === 1) {
                            const want = state.folder || "";
                            elFolder.replaceChildren(new Option("All Folders", ""));
                            (data.folders || []).forEach(f => {
                                elFolder.appendChild(new Option(f === "." ? "Root" : f.replaceAll("\\", "/"), f));
                            });
                            const ok = [...elFolder.options].some(o => o.value === want);
                            if (!ok && want) elFolder.prepend(new Option(want, want));
                            elFolder.value = want || "";
                        }

                        state.totalPages = data.total_pages || 1;
                        state.page = data.current_page || page;

                        if (!next) clearGrid();
                        appendGrid(data.checkpoints || []);

                        setStatus(
                            state.page < state.totalPages
                                ? `Page ${state.page}/${state.totalPages} • more available`
                                : `Page ${state.page}/${state.totalPages} • end`
                        );
                    } catch (e) {
                        console.error("get_checkpoints failed:", e);
                        setStatus(`Error: ${e.message}`);
                        if (!next) { clearGrid(); elEmpty.classList.remove("cdh-hidden"); }
                    } finally {
                        loadingPage = false;
                    }
                };
                const setupSentinel = () => {
                    if (ioSentinel) try { ioSentinel.disconnect(); } catch { }
                    ioSentinel = new IntersectionObserver((entries) => {
                        for (const e of entries) {
                            if (e.isIntersecting && !loadingPage && state.page < state.totalPages && state.galleryOn) {
                                loadPage(true);
                            }
                        }
                    }, { root: elScroll, rootMargin: "900px" });
                    ioSentinel.observe(elSentinel);
                };

                elFolder.addEventListener("change", () => {
                    state.folder = elFolder.value || "";
                    saveLocal(); pushSelection();
                    resetAndReload();
                });
                const resetAndReload = () => {
                    state.page = 1; state.totalPages = 1;
                    clearGrid(); loadPage(false);
                };

                // ==================================================================
                // [CDH] Init  ------------------------------------------------------
                // ==================================================================
                (async () => {
                    loadLocal();

                    try {
                        const s = await getJSON(`/localckptgallery/get_ui_state?node_id=${node.id}&gallery_id=${encodeURIComponent(gallery_id)}`);
                        if (s) {
                            if (typeof s.gallery_on === "boolean") state.galleryOn = s.gallery_on;
                            if ("folder" in s) state.folder = s.folder ?? state.folder;
                            if ("selected_ckpt" in s) state.selectedCkpt = s.selected_ckpt ?? state.selectedCkpt;
                            if ("weight_dtype" in s) state.dtype = s.weight_dtype ?? state.dtype;
                            if (s.clip) {
                                state.clipType = s.clip.type ?? state.clipType;
                                state.clipDevice = s.clip.device ?? state.clipDevice;
                                state.clip1 = s.clip.clip_name_1 ?? state.clip1;
                                state.clip2 = s.clip.clip_name_2 ?? state.clip2;
                            }
                            if (s.vae?.vae_name) state.vae = s.vae.vae_name;
                            if ("favorites_only" in s) state.favoritesOnly = !!s.favorites_only;
                            if ("active_preset" in s) state.activePreset = s.active_preset || state.activePreset; // NEW
                        }
                    } catch { }

                    saveLocal();
                    await populateOptions();
                    syncControls();
                    updateActivePresetUI();        // NEW: affiche le nom du preset actif dans l’UI
                    setGalleryState(state.galleryOn);
                    pushSelection();

                    await loadPage(false);
                    setupSentinel();

                    requestAnimationFrame(() => {
                        const w = elScroll.clientWidth || root.clientWidth || 900;
                        elGrid.style.setProperty("--colw", `${clamp(Math.floor(w / Math.ceil(w / 260)), 220, 360)}px`);
                    });
                    await loadPresets();
                })();

                return r;
            };
        },
    });

})();
