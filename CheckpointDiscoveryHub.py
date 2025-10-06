# Developed by Light-x02
# https://github.com/Light-x02/ComfyUI-checkpoint-Discovery-Hub

# ----- SECTION: Description -----
"""
🧬 Checkpoint Discovery Hub (Python) — favoris, 'None' pour CLIP(s), restauration robuste
- Galerie locale (tri A→Z, pagination, dossiers)
- 0/1/2 CLIP (ignorer 'None'; exiger ≥1)
- Labels CLIP dynamiques (map fournie par get_loader_options)
- VAE sélectionnable
- UNET dtype
- Device CLIP (default/cpu)
- Presets
- Sync Civitai (preview + download_url)
- État UI persistant (clé combinée et fallback)
- Favoris (fichier séparé), endpoints set/get, filtre favorites_only
"""

# ----- SECTION: Imports -----
import os
import re
import json
import hashlib
from urllib.parse import urlparse, quote_plus, unquote_plus

import folder_paths
import server
from aiohttp import web

import torch
import comfy

import aiohttp
import asyncio


# ----- SECTION: Paths & Constants -----
NODE_DIR = os.path.dirname(os.path.abspath(__file__))
CDH_METADATA_FILE   = os.path.join(NODE_DIR, "cdh_metadata.json")
CDH_UI_STATE_FILE   = os.path.join(NODE_DIR, "cdh_ui_state.json")
CDH_PRESETS_FILE    = os.path.join(NODE_DIR, "cdh_presets.json")
CDH_FAVORITES_FILE  = os.path.join(NODE_DIR, "cdh_favorites.json")

VIDEO_EXTENSIONS = ['.mp4', '.webm', '.mov', '.avi']
IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif']


# ----- SECTION: JSON Helpers & Hash -----
def _load_json(path, default):
    if not os.path.exists(path):
        return default
    try:
        with open(path, "r", encoding="utf-8") as f:
            s = f.read()
            if not s.strip():
                return default
            return json.loads(s)
    except Exception as e:
        print(f"[CDH] Error loading {path}: {e}")
        return default

def _save_json(data, path):
    try:
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"[CDH] Error saving {path}: {e}")

load_metadata   = lambda: _load_json(CDH_METADATA_FILE, {})
save_metadata   = lambda d: _save_json(d, CDH_METADATA_FILE)

load_ui_state   = lambda: _load_json(CDH_UI_STATE_FILE, {})
save_ui_state   = lambda d: _save_json(d, CDH_UI_STATE_FILE)

load_presets    = lambda: _load_json(CDH_PRESETS_FILE, {})
save_presets    = lambda d: _save_json(d, CDH_PRESETS_FILE)

load_favorites  = lambda: _load_json(CDH_FAVORITES_FILE, {})
save_favorites  = lambda d: _save_json(d, CDH_FAVORITES_FILE)

def calculate_sha256(filepath):
    if not os.path.exists(filepath):
        return None
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


# ----- SECTION: Local Preview Discovery -----
def get_ckpt_preview_asset_info(ckpt_name: str):
    ckpt_path = folder_paths.get_full_path("diffusion_models", ckpt_name)
    if ckpt_path is None:
        return None, "none"
    base, _ = os.path.splitext(ckpt_path)
    for ext in IMAGE_EXTENSIONS + VIDEO_EXTENSIONS:
        p = base + ext
        if os.path.exists(p):
            filename = os.path.basename(p)
            enc_ckpt = quote_plus(ckpt_name)
            enc_file = quote_plus(filename)
            url = f"/localckptgallery/preview?filename={enc_file}&ckpt_name={enc_ckpt}"
            t = "video" if ext.lower() in VIDEO_EXTENSIONS else "image"
            return url, t
    return None, "none"


# ----- SECTION: API — Presets -----
@server.PromptServer.instance.routes.get("/localckptgallery/get_presets")
async def cdh_get_presets(request):
    return web.json_response(load_presets())

@server.PromptServer.instance.routes.post("/localckptgallery/save_preset")
async def cdh_save_preset(request):
    try:
        data = await request.json()
        name = (data.get("name") or "").strip()
        preset = data.get("data")
        if not name or preset is None:
            return web.json_response({"status": "error", "message": "Missing name or data"}, status=400)
        presets = load_presets()
        presets[name] = preset
        save_presets(presets)
        return web.json_response({"status": "ok", "presets": presets})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/localckptgallery/delete_preset")
async def cdh_delete_preset(request):
    try:
        data = await request.json()
        name = (data.get("name") or "").strip()
        if not name:
            return web.json_response({"status": "error", "message": "Missing name"}, status=400)
        presets = load_presets()
        if name in presets:
            del presets[name]
            save_presets(presets)
        return web.json_response({"status": "ok", "presets": presets})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# ----- SECTION: API — UI State -----
@server.PromptServer.instance.routes.post("/localckptgallery/set_ui_state")
async def cdh_set_ui_state(request):
    try:
        data = await request.json()
        node_id    = str(data.get("node_id"))
        gallery_id = data.get("gallery_id")
        state      = data.get("state", {}) or {}
        if not gallery_id:
            return web.Response(status=400)

        states = load_ui_state()

        if node_id:
            k1 = f"{gallery_id}_{node_id}"
            states.setdefault(k1, {}).update(state)

        k2 = str(gallery_id)
        states.setdefault(k2, {}).update(state)

        save_ui_state(states)
        return web.json_response({"status": "ok"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.get("/localckptgallery/get_ui_state")
async def cdh_get_ui_state(request):
    try:
        node_id    = request.query.get("node_id")
        gallery_id = request.query.get("gallery_id")
        if not gallery_id:
            return web.json_response({"error": "gallery_id is required"}, status=400)

        states = load_ui_state()

        st = None
        if node_id:
            st = states.get(f"{gallery_id}_{node_id}")
        if not st:
            st = states.get(str(gallery_id))

        return web.json_response(st or {"gallery_on": True})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# ----- SECTION: API — Favorites -----
@server.PromptServer.instance.routes.get("/localckptgallery/get_favorites")
async def cdh_get_favorites(request):
    fav_map = load_favorites()
    names = [k for k, v in fav_map.items() if v]
    return web.json_response({"favorites": names})

@server.PromptServer.instance.routes.post("/localckptgallery/set_favorite")
async def cdh_set_favorite(request):
    try:
        data = await request.json()
        name = (data.get("ckpt_name") or "").strip()
        fav  = bool(data.get("fav", True))
        if not name:
            return web.json_response({"status": "error", "message": "Missing ckpt_name"}, status=400)
        fav_map = load_favorites()
        if fav:
            fav_map[name] = True
        else:
            if name in fav_map:
                del fav_map[name]
        save_favorites(fav_map)
        return web.json_response({"status": "ok", "is_favorite": fav})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# ----- SECTION: API — Metadata (update + Civitai sync) -----
@server.PromptServer.instance.routes.post("/localckptgallery/update_metadata")
async def cdh_update_metadata(request):
    try:
        data = await request.json()
        ckpt_name = data.get("ckpt_name")
        if not ckpt_name:
            return web.json_response({"status": "error", "message": "Missing ckpt_name"}, status=400)

        metadata = load_metadata()
        entry = metadata.get(ckpt_name, {})
        if "download_url" in data and data["download_url"] is not None:
            entry["download_url"] = str(data["download_url"]).strip()
        if "tags" in data and isinstance(data["tags"], list):
            entry["tags"] = [str(t).strip() for t in data["tags"] if str(t).strip()]
        metadata[ckpt_name] = entry
        save_metadata(metadata)
        return web.json_response({"status": "ok"})
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)

@server.PromptServer.instance.routes.post("/localckptgallery/sync_civitai")
async def cdh_sync_civitai(request):
    try:
        data = await request.json()
        ckpt_name = data.get("ckpt_name")
        if not ckpt_name:
            return web.json_response({"status": "error", "message": "Missing ckpt_name"}, status=400)

        ckpt_path = folder_paths.get_full_path("diffusion_models", ckpt_name)
        if not ckpt_path:
            return web.json_response({"status": "error", "message": "Checkpoint not found"}, status=404)

        metadata = load_metadata()
        entry = metadata.get(ckpt_name, {})

        model_hash = entry.get("hash")
        if not model_hash:
            print(f"[CDH] Calculating SHA256 for {ckpt_name}…")
            model_hash = calculate_sha256(ckpt_path)
            if not model_hash:
                return web.json_response({"status": "error", "message": "Failed to calculate hash"}, status=500)
            entry["hash"] = model_hash
            metadata[ckpt_name] = entry
            save_metadata(metadata)

        civitai_version_url = f"https://civitai.com/api/v1/model-versions/by-hash/{model_hash}"
        async with aiohttp.ClientSession() as sess:
            async with sess.get(civitai_version_url) as resp:
                if resp.status != 200:
                    return web.json_response({"status": "error", "message": f"Civitai version API returned {resp.status}"}, status=resp.status)
                ver = await resp.json()
                model_id = ver.get("modelId")
                if not model_id:
                    return web.json_response({"status": "error", "message": "No modelId in Civitai response"}, status=500)

            images = ver.get("images", []) or []
            preview_url = None
            preview_type = "none"
            if images:
                media = next((i for i in images if i.get("type") == "image"), images[0])
                src = media.get("url", "")
                is_video = (media.get("type") == "video")
                try:
                    if is_video:
                        if '/original=true/' in src:
                            tmp = src.replace('/original=true/', '/transcode=true,width=450,optimized=true/')
                            final = os.path.splitext(tmp)[0] + '.webm'
                        else:
                            u = urlparse(src)
                            parts = u.path.split('/')
                            fname = parts.pop()
                            base = os.path.splitext(fname)[0]
                            new_path = f"{'/'.join(parts)}/transcode=true,width=450,optimized=true/{base}.webm"
                            final = u._replace(path=new_path).geturl()
                        ext = ".webm"
                        preview_type = "video"
                    else:
                        if '/original=true/' in src:
                            final = src.replace('/original=true/', '/width=450/')
                        else:
                            if '/width=' in src:
                                final = re.sub(r"/width=\d+/", "/width=450/", src)
                            else:
                                u = urlparse(src)
                                final = src.replace(u.path, f"/width=450{u.path}")
                        path = urlparse(final).path
                        ext = os.path.splitext(path)[1] or ".jpg"
                        if ext.lower() not in IMAGE_EXTENSIONS:
                            ext = ".jpg"
                        preview_type = "image"
                except Exception as e:
                    print(f"[CDH] URL transform failed: {e}")
                    final = src
                    ext = ".jpg" if not is_video else ".mp4"

                preview_url = final

                ckpt_dir = os.path.dirname(ckpt_path)
                base = os.path.splitext(os.path.basename(ckpt_path))[0]
                save_path = os.path.join(ckpt_dir, base + ext)
                async with sess.get(preview_url) as dl:
                    if dl.status == 200:
                        with open(save_path, "wb") as f:
                            while True:
                                chunk = await dl.content.read(1 << 13)
                                if not chunk:
                                    break
                                f.write(chunk)
                        print(f"[CDH] Preview saved: {save_path}")
                    else:
                        print(f"[CDH] Preview download failed: {dl.status}")

            entry["download_url"] = f"https://civitai.com/models/{model_id}"
            metadata[ckpt_name] = entry
            save_metadata(metadata)

            local_url, local_type = get_ckpt_preview_asset_info(ckpt_name)
            return web.json_response({
                "status": "ok",
                "metadata": {
                    "preview_url": local_url,
                    "preview_type": local_type,
                    "download_url": entry.get("download_url", "")
                }
            })

    except Exception as e:
        import traceback
        print(f"[CDH] sync_civitai error:\n{traceback.format_exc()}")
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# ----- SECTION: API — Checkpoints Listing -----
@server.PromptServer.instance.routes.get("/localckptgallery/get_checkpoints")
async def cdh_get_checkpoints(request):
    try:
        folder_filter  = (request.query.get("folder") or "").strip()
        selected_ckpt  = (request.query.get("selected_ckpt") or "").strip()
        favorites_only = request.query.get("favorites_only", "0").strip() in ("1", "true", "yes")
        page = int(request.query.get("page", 1))
        per_page = int(request.query.get("per_page", 60))

        names = folder_paths.get_filename_list("diffusion_models")
        roots = folder_paths.get_folder_paths("diffusion_models")
        root = roots[0] if roots else "."

        metadata = load_metadata()
        fav_map  = load_favorites()
        all_folders = set()

        items = []
        for name in names:
            full = folder_paths.get_full_path("diffusion_models", name)
            if not full:
                continue
            rel = os.path.relpath(os.path.dirname(full), root)
            folder = "." if rel == "." else rel
            all_folders.add(folder)
            if folder_filter and folder_filter != folder:
                continue

            is_fav = bool(fav_map.get(name, False))
            if favorites_only and not is_fav:
                continue

            preview_url, preview_type = get_ckpt_preview_asset_info(name)
            entry = metadata.get(name, {})
            items.append({
                "name": name,
                "folder": folder,
                "preview_url": preview_url or "",
                "preview_type": preview_type,
                "download_url": entry.get("download_url", ""),
                "tags": entry.get("tags", []),
                "is_favorite": is_fav,
            })

        items.sort(key=lambda it: it["name"].lower())

        if selected_ckpt:
            pinned = [it for it in items if it["name"] == selected_ckpt]
            others = [it for it in items if it["name"] != selected_ckpt]
            items = pinned + others

        total = len(items)
        total_pages = (total + per_page - 1) // per_page
        start = (page - 1) * per_page
        page_items = items[start:start + per_page]

        folders_sorted = sorted(list(all_folders), key=lambda s: s.lower())

        return web.json_response({
            "checkpoints": page_items,
            "folders": folders_sorted,
            "total_pages": max(total_pages, 1),
            "current_page": page
        })
    except Exception as e:
        import traceback
        print(f"[CDH] get_checkpoints error:\n{traceback.format_exc()}")
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# ----- SECTION: API — Preview File -----
@server.PromptServer.instance.routes.get("/localckptgallery/preview")
async def cdh_preview(request):
    filename = request.query.get("filename")
    ckpt_name = request.query.get("ckpt_name")
    if not filename or not ckpt_name or ".." in filename or "/" in filename or "\\" in filename:
        return web.Response(status=403)
    try:
        ckpt_name = unquote_plus(ckpt_name)
        filename = unquote_plus(filename)
        ckpt_path = folder_paths.get_full_path("diffusion_models", ckpt_name)
        if not ckpt_path:
            return web.Response(status=404, text=f"Checkpoint '{ckpt_name}' not found.")
        path = os.path.join(os.path.dirname(ckpt_path), filename)
        if os.path.exists(path):
            return web.FileResponse(path)
        return web.Response(status=404, text=f"Preview '{filename}' not found.")
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# ----- SECTION: API — Loader Options -----
def _clip_label_map():
    return {
        "flux": ["clip-l", "t5xxl"],
        "sd3": ["clip-l", "clip-g"],
        "sdxl": ["clip-l", "clip-g"],
        "stable_diffusion": ["clip-l", "clip-g"],
        "wan": ["wan-clip", "(unused)"],
        "hidream": ["clip", "(optional)"],
        "hunyuan_image": ["clip", "t5 (optional)"],
        "qwen_image": ["clip", "(optional)"],
        "mochi": ["clip", "(optional)"],
        "ltxv": ["clip", "(optional)"],
        "pixart": ["clip", "(optional)"],
        "cosmos": ["clip", "(optional)"],
        "lumina2": ["clip", "(optional)"],
        "ace": ["clip", "(optional)"],
        "omnigen2": ["clip", "(optional)"],
        "stable_cascade": ["clip", "(optional)"],
        "stable_audio": ["clip", "(optional)"],
        "chroma": ["clip", "(optional)"],
        "hunyuan_video": ["clip", "(optional)"],
    }

@server.PromptServer.instance.routes.get("/localckptgallery/get_loader_options")
async def cdh_get_loader_options(request):
    try:
        clip_files = folder_paths.get_filename_list("text_encoders")
        clip_files = ["None"] + clip_files

        options = {
            "unet_dtypes": ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],
            "clip_devices": ["default", "cpu"],
            "clip_types": [
                "sdxl", "sd3", "flux",
                "stable_diffusion", "stable_cascade", "stable_audio",
                "mochi", "ltxv", "pixart",
                "cosmos", "lumina2", "wan", "hidream", "chroma", "ace", "omnigen2",
                "qwen_image", "hunyuan_image", "hunyuan_video",
            ],
            "clip_files": clip_files,
            "vae_files": VAELoader.vae_list(),
            "clip_label_map": _clip_label_map(),
        }
        return web.json_response(options)
    except Exception as e:
        return web.json_response({"status": "error", "message": str(e)}, status=500)


# ----- SECTION: Loaders (UNET / DualCLIP / VAE) -----
class UNETLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {"unet_name": (folder_paths.get_filename_list("diffusion_models"), ),
                             "weight_dtype": (["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],)}}
    RETURN_TYPES = ("MODEL",)
    FUNCTION = "load_unet"
    CATEGORY = "advanced/loaders"

    def load_unet(self, unet_name, weight_dtype):
        model_options = {}
        if weight_dtype == "fp8_e4m3fn":
            model_options["dtype"] = torch.float8_e4m3fn
        elif weight_dtype == "fp8_e4m3fn_fast":
            model_options["dtype"] = torch.float8_e4m3fn
            model_options["fp8_optimizations"] = True
        elif weight_dtype == "fp8_e5m2":
            model_options["dtype"] = torch.float8_e5m2

        unet_path = folder_paths.get_full_path_or_raise("diffusion_models", unet_name)
        model = comfy.sd.load_diffusion_model(unet_path, model_options=model_options)
        return (model,)

class DualCLIPLoader:
    @classmethod
    def INPUT_TYPES(s):
        return {"required": {"clip_name1": (folder_paths.get_filename_list("text_encoders"), ),
                             "clip_name2": (folder_paths.get_filename_list("text_encoders"), ),
                             "type": (["sdxl", "sd3", "flux", "hunyuan_video", "hidream", "hunyuan_image", "wan"], ),},
                "optional": {"device": (["default", "cpu"], {"advanced": True}),}}
    RETURN_TYPES = ("CLIP",)
    FUNCTION = "load_clip"
    CATEGORY = "advanced/loaders"

    DESCRIPTION = "[Dual/Single] sdxl: clip-l+clip-g • sd3: clip-l+clip-g/clip+t5 • flux: clip-l+t5 • wan: single-clip"

    def load_clip(self, clip_name1, clip_name2, type, device="default"):
        def _to_path(name):
            if not name:
                return None
            s = str(name).strip()
            if s.lower() == "none":
                return None
            return folder_paths.get_full_path_or_raise("text_encoders", s)

        p1 = _to_path(clip_name1)
        p2 = _to_path(clip_name2)
        ckpt_paths = [p for p in (p1, p2) if p]

        if len(ckpt_paths) == 0:
            raise RuntimeError("[CDH] At least one CLIP must be selected (or not 'None').")

        clip_type = getattr(comfy.sd.CLIPType, str(type or "").upper(), comfy.sd.CLIPType.STABLE_DIFFUSION)

        model_options = {}
        if device == "cpu":
            model_options["load_device"] = model_options["offload_device"] = torch.device("cpu")

        clip = comfy.sd.load_clip(
            ckpt_paths=ckpt_paths,
            embedding_directory=folder_paths.get_folder_paths("embeddings"),
            clip_type=clip_type,
            model_options=model_options,
        )
        return (clip,)

class VAELoader:
    @staticmethod
    def vae_list():
        vaes = folder_paths.get_filename_list("vae")
        approx_vaes = folder_paths.get_filename_list("vae_approx")
        sdxl_taesd_enc = sdxl_taesd_dec = False
        sd1_taesd_enc = sd1_taesd_dec = False
        sd3_taesd_enc = sd3_taesd_dec = False
        f1_taesd_enc = f1_taesd_dec = False

        for v in approx_vaes:
            if v.startswith("taesd_decoder."):
                sd1_taesd_dec = True
            elif v.startswith("taesd_encoder."):
                sd1_taesd_enc = True
            elif v.startswith("taesdxl_decoder."):
                sdxl_taesd_dec = True
            elif v.startswith("taesdxl_encoder."):
                sdxl_taesd_enc = True
            elif v.startswith("taesd3_decoder."):
                sd3_taesd_dec = True
            elif v.startswith("taesd3_encoder."):
                sd3_taesd_enc = True
            elif v.startswith("taef1_encoder."):
                f1_taesd_dec = True
            elif v.startswith("taef1_decoder."):
                f1_taesd_enc = True

        if sd1_taesd_dec and sd1_taesd_enc:
            vaes.append("taesd")
        if sdxl_taesd_dec and sdxl_taesd_enc:
            vaes.append("taesdxl")
        if sd3_taesd_dec and sd3_taesd_enc:
            vaes.append("taesd3")
        if f1_taesd_dec and f1_taesd_enc:
            vaes.append("taef1")
        vaes.append("pixel_space")
        return vaes

    @staticmethod
    def load_taesd(name):
        sd = {}
        approx_vaes = folder_paths.get_filename_list("vae_approx")

        encoder = next(filter(lambda a: a.startswith("{}_encoder.".format(name)), approx_vaes))
        decoder = next(filter(lambda a: a.startswith("{}_decoder.".format(name)), approx_vaes))

        enc = comfy.utils.load_torch_file(folder_paths.get_full_path_or_raise("vae_approx", encoder))
        for k in enc:
            sd["taesd_encoder.{}".format(k)] = enc[k]

        dec = comfy.utils.load_torch_file(folder_paths.get_full_path_or_raise("vae_approx", decoder))
        for k in dec:
            sd["taesd_decoder.{}".format(k)] = dec[k]

        if name == "taesd":
            sd["vae_scale"] = torch.tensor(0.18215)
            sd["vae_shift"] = torch.tensor(0.0)
        elif name == "taesdxl":
            sd["vae_scale"] = torch.tensor(0.13025)
            sd["vae_shift"] = torch.tensor(0.0)
        elif name == "taesd3":
            sd["vae_scale"] = torch.tensor(1.5305)
            sd["vae_shift"] = torch.tensor(0.0609)
        elif name == "taef1":
            sd["vae_scale"] = torch.tensor(0.3611)
            sd["vae_shift"] = torch.tensor(0.1159)
        return sd

    @classmethod
    def INPUT_TYPES(s):
        return {"required": {"vae_name": (s.vae_list(), )}}
    RETURN_TYPES = ("VAE",)
    FUNCTION = "load_vae"
    CATEGORY = "loaders"

    def load_vae(self, vae_name):
        if vae_name == "pixel_space":
            sd = {"pixel_space_vae": torch.tensor(1.0)}
        elif vae_name in ["taesd", "taesdxl", "taesd3", "taef1"]:
            sd = self.load_taesd(vae_name)
        else:
            vae_path = folder_paths.get_full_path_or_raise("vae", vae_name)
            sd = comfy.utils.load_torch_file(vae_path)
        vae = comfy.sd.VAE(sd=sd)
        vae.throw_exception_if_invalid()
        return (vae,)


# ----- SECTION: Node — CheckpointDiscoveryHub -----
def _normalize_clip_type(s: str) -> str:
    s = (s or "").strip().lower()
    if s in ("flux/sd3", "flux_sd3", "sd3/flux"):
        return "flux"
    return s

class CheckpointDiscoveryHub:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {},
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "selection_data": ("STRING", {"default": "{}", "multiline": True, "forceInput": True}),
            },
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE", "STRING")
    RETURN_NAMES = ("MODÈLE", "CLIP", "VAE", "model_name")
    FUNCTION = "load_assets"
    CATEGORY = "💡Lightx02/Checkpoint"

    @classmethod
    def IS_CHANGED(cls, selection_data, **kwargs):
        return selection_data

    def load_assets(self, unique_id=None, selection_data="{}", **kwargs):
        """
        selection_data JSON:
        {
          "ckpt": "...",
          "weight_dtype": "...",
          "clip": {"clip_name_1": "...|None", "clip_name_2": "...|None", "type": "...", "device": "..."},
          "vae":  {"vae_name": "..."}
        }
        """
        try:
            data = json.loads(selection_data) if selection_data else {}
        except Exception:
            data = {}

        ckpt = (data.get("ckpt") or "").strip()
        weight_dtype = (data.get("weight_dtype") or "default").strip()

        clip_cfg = data.get("clip") or {}
        clip1 = (clip_cfg.get("clip_name_1") or "").strip()
        clip2 = (clip_cfg.get("clip_name_2") or "").strip()
        clip_type = _normalize_clip_type(clip_cfg.get("type") or "sd3")
        clip_device = (clip_cfg.get("device") or "default").strip()

        vae_cfg = data.get("vae") or {}
        vae_name = (vae_cfg.get("vae_name") or "").strip()

        if not ckpt:
            raise RuntimeError("[CDH] No checkpoint selected.")

        def _is_none(s: str) -> bool:
            return (not s) or (str(s).strip().lower() == "none")
        if _is_none(clip1) and _is_none(clip2):
            raise RuntimeError("[CDH] Select at least one CLIP (set the other to 'None').")
        if not vae_name:
            raise RuntimeError("[CDH] No VAE selected.")

        unet_loader = UNETLoader()
        (model,) = unet_loader.load_unet(ckpt, weight_dtype)

        dual_clip_loader = DualCLIPLoader()
        c1 = "" if _is_none(clip1) else clip1
        c2 = "" if _is_none(clip2) else clip2
        (clip_obj,) = dual_clip_loader.load_clip(c1, c2, clip_type, device=clip_device)

        vae_loader = VAELoader()
        (vae_obj,) = vae_loader.load_vae(vae_name)

        return (model, clip_obj, vae_obj, ckpt)


# ----- SECTION: Registration -----
NODE_CLASS_MAPPINGS = {
    "CheckpointDiscoveryHub": CheckpointDiscoveryHub,
}
NODE_DISPLAY_NAME_MAPPINGS = {
    "CheckpointDiscoveryHub": "🧬 Checkpoint Discovery Hub",
}


