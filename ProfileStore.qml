// Profiles on disk: ~/.config/DankMaterialShell/profiles/<slug>/
//   profile.json    name, created, updated, wallpaper file name, dms snapshot, extras
//   wallpaper.<ext> copy of the wallpaper, so a profile does not depend on the
//                   original file staying where it was
//   .start/         the profile as it was when it became active, for reset
// profiles/state.json holds the active slug and the manual order.
//
// File operations run through `sh` (mkdir, cp, cmp, mv, rm). JSON is written
// base64 encoded through the command line; Qt.btoa encodes UTF-8.

pragma ComponentBehavior: Bound

import QtCore
import QtQuick
import Quickshell
import Quickshell.Io
import qs.Common

Item {
    id: store

    readonly property string root: Paths.strip(StandardPaths.writableLocation(StandardPaths.ConfigLocation)) + "/DankMaterialShell/profiles"

    property var profiles: []
    property string activeSlug: ""
    property var order: []
    property bool loaded: false

    signal changed

    function quote(s) {
        return "'" + String(s).replace(/'/g, "'\\''") + "'";
    }

    function dir(slug) {
        return store.root + "/" + slug;
    }

    function slugify(name) {
        return String(name).normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/ß/g, "ss").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    }

    // Stable JSON with sorted keys, for comparing snapshots
    function stable(v) {
        if (Array.isArray(v))
            return "[" + v.map(x => store.stable(x)).join(",") + "]";
        if (v && typeof v === "object")
            return "{" + Object.keys(v).sort().map(k => JSON.stringify(k) + ":" + store.stable(v[k])).join(",") + "}";
        return JSON.stringify(v === undefined ? null : v);
    }

    property int _seq: 0
    function sh(script, callback, timeoutMs) {
        store._seq++;
        Proc.runCommand("dmsProfiles.store." + store._seq, ["sh", "-c", script], (out, code) => {
            if (callback)
                callback(out, code);
        }, 0, timeoutMs || 30000);
    }

    function writeJson(path, obj, callback) {
        const text = JSON.stringify(obj, null, 2) + "\n";
        store.sh("printf %s " + store.quote(Qt.btoa(text)) + " | base64 -d > " + store.quote(path) + ".tmp && mv " + store.quote(path) + ".tmp " + store.quote(path), callback);
    }

    // ------------------------------------------------------------------ reading
    function refresh(callback) {
        const script = "mkdir -p " + store.quote(store.root) + "; " + "cat " + store.quote(store.root + "/state.json") + " 2>/dev/null; " + "for d in " + store.quote(store.root) + "/*/; do [ -f \"$d/profile.json\" ] || continue; " + "printf '\\n@@@%s\\n' \"$(basename \"$d\")\"; cat \"$d/profile.json\"; " + "if cmp -s \"$d/profile.json\" \"$d/.start/profile.json\" 2>/dev/null; then echo '@@@same'; fi; done";
        store.sh(script, (out, code) => {
            const parts = String(out).split("\n@@@");
            let state = {};
            try {
                state = JSON.parse(parts[0].trim() || "{}");
            } catch (e) {}
            const list = [];
            for (let i = 1; i < parts.length; i++) {
                const nl = parts[i].indexOf("\n");
                const slug = parts[i].substring(0, nl);
                let body = parts[i].substring(nl + 1);
                const same = body.trim().endsWith("@@@same");
                if (same)
                    body = body.substring(0, body.lastIndexOf("@@@same"));
                let p;
                try {
                    p = JSON.parse(body);
                } catch (e) {
                    continue;
                }
                const wall = p.wallpaper ? store.dir(slug) + "/" + p.wallpaper : "";
                list.push({
                    "slug": slug,
                    "name": p.name || slug,
                    "wallpaper": wall,
                    "thumb": wall,
                    "created": p.created || "",
                    "updated": p.updated || "",
                    "active": slug === state.active,
                    "resettable": !same
                });
            }
            list.sort((a, b) => a.created < b.created ? -1 : (a.created > b.created ? 1 : 0));
            const saved = Array.isArray(state.order) ? state.order : [];
            const rank = s => {
                const r = saved.indexOf(s);
                return r < 0 ? saved.length : r;
            };
            list.sort((a, b) => rank(a.slug) - rank(b.slug));
            // an active slug whose folder is gone (deleted profile) is cleared,
            // so nothing keeps saving into a profile that no longer exists
            const active = state.active || "";
            store.activeSlug = list.some(p => p.slug === active) ? active : "";
            if (active && store.activeSlug !== active)
                store.writeJson(store.root + "/state.json", {
                    "active": "",
                    "order": list.map(p => p.slug)
                }, null);
            store.order = saved;
            store.profiles = list;
            store.loaded = true;
            store.changed();
            if (callback)
                callback(list);
        });
    }

    FileView {
        id: reader
        blockLoading: true
        printErrors: false
    }

    function load(slug) {
        reader.path = store.dir(slug) + "/profile.json";
        reader.reload();
        reader.waitForJob();
        try {
            return JSON.parse(reader.text());
        } catch (e) {
            return null;
        }
    }

    function find(slug) {
        return store.profiles.find(p => p.slug === slug) || null;
    }

    // ------------------------------------------------------------------ writing
    function writeState(callback) {
        store.writeJson(store.root + "/state.json", {
            "active": store.activeSlug,
            "order": store.profiles.map(p => p.slug)
        }, callback);
    }

    function setActive(slug, callback) {
        store.activeSlug = slug;
        store.writeState(() => store.refresh(callback));
    }

    // Saves a snapshot into a profile. Copies the wallpaper only when it differs.
    function save(slug, name, snapshot, extras, callback) {
        const d = store.dir(slug);
        const old = store.load(slug) || {};
        const wall = snapshot && snapshot.session ? (snapshot.session.wallpaperPath || "") : "";
        const dot = wall.lastIndexOf(".");
        const ext = dot > wall.lastIndexOf("/") ? wall.substring(dot) : ".png";
        const wallName = wall && !wall.startsWith("#") ? "wallpaper" + ext : (old.wallpaper || "");
        const now = Qt.formatDateTime(new Date(), "yyyy-MM-dd'T'HH:mm:ss");
        const profile = Object.assign({}, old, {
            "name": name,
            "created": old.created || now,
            "updated": now,
            "wallpaper": wallName,
            "dms": snapshot,
            "extras": extras === undefined ? (old.extras || null) : extras
        });
        let script = "mkdir -p " + store.quote(d);
        if (wall && !wall.startsWith("#")) {
            const target = d + "/" + wallName;
            script += " && { cmp -s " + store.quote(wall) + " " + store.quote(target) + " || { cp -f " + store.quote(wall) + " " + store.quote(target) + " && for f in " + store.quote(d) + "/wallpaper.*; do [ \"$f\" = " + store.quote(target) + " ] || rm -f \"$f\"; done; }; }";
        }
        store.sh(script, () => store.writeJson(d + "/profile.json", profile, () => store.refresh(callback)));
    }

    function writeStart(slug, callback) {
        const d = store.dir(slug);
        store.sh("rm -rf " + store.quote(d + "/.start") + " && mkdir -p " + store.quote(d + "/.start") + " && cp -p " + store.quote(d) + "/profile.json " + store.quote(d) + "/wallpaper.* " + store.quote(d + "/.start/") + " 2>/dev/null; true", () => store.refresh(callback));
    }

    function restoreStart(slug, callback) {
        const d = store.dir(slug);
        store.sh("[ -f " + store.quote(d + "/.start/profile.json") + " ] && rm -f " + store.quote(d) + "/wallpaper.* && cp -p " + store.quote(d + "/.start") + "/* " + store.quote(d + "/"), (out, code) => store.refresh(() => callback && callback(code === 0)));
    }

    function rename(slug, newName, callback) {
        const name = String(newName).trim();
        const target = store.slugify(name);
        if (!name || !target) {
            callback && callback("empty");
            return;
        }
        if (target !== slug && store.find(target)) {
            callback && callback("exists");
            return;
        }
        const move = target === slug ? "true" : "mv " + store.quote(store.dir(slug)) + " " + store.quote(store.dir(target));
        store.sh(move, (out, code) => {
            if (code !== 0) {
                callback && callback("failed");
                return;
            }
            const p = store.load(target) || {};
            p.name = name;
            store.writeJson(store.dir(target) + "/profile.json", p, () => {
                const start = store.dir(target) + "/.start/profile.json";
                store.sh("[ -f " + store.quote(start) + " ]", (o, c) => {
                    // state first, then read back: a refresh would take the old
                    // slug from state.json and write it again
                    const finish = () => {
                        if (store.activeSlug === slug)
                            store.activeSlug = target;
                        const order = store.profiles.map(p => p.slug === slug ? target : p.slug);
                        store.writeJson(store.root + "/state.json", {
                            "active": store.activeSlug,
                            "order": order
                        }, () => store.refresh(() => callback && callback("")));
                    };
                    if (c !== 0) {
                        finish();
                        return;
                    }
                    reader.path = start;
                    reader.reload();
                    reader.waitForJob();
                    let s = {};
                    try {
                        s = JSON.parse(reader.text());
                    } catch (e) {}
                    s.name = name;
                    store.writeJson(start, s, finish);
                });
            });
        });
    }

    function remove(slug, callback) {
        if (!slug || slug.indexOf("/") >= 0 || slug.startsWith(".")) {
            callback && callback(false);
            return;
        }
        store.sh("rm -rf -- " + store.quote(store.dir(slug)), (out, code) => {
            if (store.activeSlug === slug)
                store.activeSlug = "";
            const order = store.profiles.map(p => p.slug).filter(s => s !== slug);
            store.writeJson(store.root + "/state.json", {
                "active": store.activeSlug,
                "order": order
            }, () => store.refresh(() => callback && callback(code === 0)));
        });
    }

    // where: "left" | "right" | 1-based position
    function move(slug, where, callback) {
        const slugs = store.profiles.map(p => p.slug);
        const i = slugs.indexOf(slug);
        if (i < 0) {
            callback && callback(false);
            return;
        }
        let j = i;
        if (where === "left" || where === "up")
            j = Math.max(0, i - 1);
        else if (where === "right" || where === "down")
            j = Math.min(slugs.length - 1, i + 1);
        else if (!isNaN(parseInt(where)))
            j = Math.max(0, Math.min(slugs.length - 1, parseInt(where) - 1));
        slugs.splice(j, 0, slugs.splice(i, 1)[0]);
        store.writeJson(store.root + "/state.json", {
            "active": store.activeSlug,
            "order": slugs
        }, () => store.refresh(() => callback && callback(true)));
    }
}
