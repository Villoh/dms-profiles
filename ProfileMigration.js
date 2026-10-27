.pragma library

// Brings a profile saved under an older DMS settings format to the running one.
// DMS 1.6 writes settings version 18, DMS 2.0 version 42. DMS migrates
// settings.json only when the file itself carries an old version, and a profile
// is written into a file that is already current, so the old keys would be
// dropped without notice.
//
// Only the profile goes through DMS' own migrateToVersion, never a whole
// settings file with an old version: the step to 27 doubles
// controlCenterColumns on every run.
//
// `dmsStore` comes from the running shell (ProfilesDaemon.settingsStore()):
//   migrate(obj, version)  SettingsStore.js migrateToVersion
//   migratedGlobals        BarWidgetDefaults.js MIGRATED_GLOBALS
//   known(key)             true if SettingsSpec.js has the key

// Settings format of DMS 1.6, the oldest the plugin runs on
var baseVersion = 18;

// Keys that only exist from settings version 23 on
var newFormatKeys = ["radiusStrength", "animationDuration", "popoutAnimationDuration", "dockConfigs"];

function clone(v) {
    return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// Profiles from before the version was stored are 1.6 profiles, unless they
// already hold keys of the new format (saved under 2.0 by an older plugin)
function profileVersion(dms, current) {
    if (!dms)
        return current;
    if (typeof dms.configVersion === "number")
        return dms.configVersion;
    const s = dms.settings || {};
    for (const k of newFormatKeys) {
        if (s[k] !== undefined)
            return current;
    }
    return baseVersion;
}

function needsMigration(dms, current) {
    return !!dms && profileVersion(dms, current) < current;
}

// A bar widget option as the running bars have it, e.g. showWorkspaceIndex on
// the workspaceSwitcher instance
function liveWidgetOption(liveBars, widgetId, key) {
    for (const bar of (liveBars || [])) {
        for (const list of ["leftWidgets", "centerWidgets", "rightWidgets"]) {
            for (const w of (bar && bar[list]) || []) {
                if (w && typeof w === "object" && w.id === widgetId && w[key] !== undefined)
                    return clone(w[key]);
            }
        }
    }
    return undefined;
}

// Returns {dms, notes} with dms in the running format, or null when nothing is
// to do. `liveBars` are the current barConfigs (already migrated by DMS).
function migrate(dms, current, dmsStore, liveBars) {
    const from = profileVersion(dms, current);
    if (!dms || !dmsStore || from >= current)
        return null;
    const notes = [];
    const s = clone(dms.settings || {});
    const bars = dms.bars || {};
    const ids = Object.keys(bars);
    // Bars go in as barConfigs, in the saved order. `enabled` is only lent for
    // the migration (it picks the frame bar from the enabled ones).
    s.barConfigs = ids.map((id, i) => Object.assign({
            "id": id
        }, clone(bars[id]), {
            "enabled": i === 0 || bars[id]._profileActive !== false
        }));
    s.configVersion = from;

    // Bar widget options that used to be global (workspace index, battery
    // percent ...) and are not part of the profile. The migration copies them
    // onto each widget instance; without a value the instance would fall back
    // to the default, while the running bars already hold the user's value.
    const globals = dmsStore.migratedGlobals || {};
    for (const widgetId in globals) {
        const map = globals[widgetId];
        for (const key in map) {
            if (s[map[key]] !== undefined)
                continue;
            const v = liveWidgetOption(liveBars, widgetId, key);
            if (v !== undefined)
                s[map[key]] = v;
        }
    }

    const dockOptions = [];
    for (const k in s) {
        if (/^dock[A-Z]/.test(k) && k !== "dockConfigs")
            dockOptions.push(k[4].toLowerCase() + k.slice(5));
    }
    const frameOpacity = Number(s.frameOpacity);
    const frameOn = s.frameEnabled === true && Number.isFinite(frameOpacity);

    const m = dmsStore.migrate(s, current) || s;

    // Frame opacity: DMS 2.0 draws the frame with the transparency of the
    // first enabled bar that is not an island. The step to 28 only takes
    // frameOpacity over when that bar follows the interface style, and the step
    // to 20 has already set followInterfaceStyle=false for every bar whose
    // transparency differs from popupTransparency. The value would be lost.
    const barList = Array.isArray(m.barConfigs) ? m.barConfigs : [];
    if (frameOn) {
        const frameBar = barList.find(b => b && b.enabled !== false && b.island !== true);
        const surface = Number.isFinite(Number(m.popupTransparency)) ? Number(m.popupTransparency) : 1.0;
        const shown = frameBar && frameBar.followInterfaceStyle !== false ? surface : (frameBar ? frameBar.transparency : undefined);
        if (frameBar && shown !== frameOpacity) {
            notes.push("frame opacity " + frameOpacity + " as transparency of bar " + frameBar.id + " (was " + frameBar.transparency + ")");
            frameBar.followInterfaceStyle = false;
            frameBar.transparency = frameOpacity;
        }
    }

    // The step to 24 builds a whole dock from the dock* keys and fills the
    // rest with defaults, `enabled` included. Keep only what the profile had.
    if (Array.isArray(m.dockConfigs) && from < 24) {
        if (dockOptions.length > 0 && dockOptions.indexOf("transparency") >= 0)
            dockOptions.push("followInterfaceStyle");
        if (dockOptions.indexOf("iconSize") >= 0)
            dockOptions.push("itemSpacing");
        const docks = m.dockConfigs.map(c => {
            const o = {
                "id": c.id
            };
            for (const k of dockOptions) {
                if (c[k] !== undefined)
                    o[k] = c[k];
            }
            return o;
        }).filter(o => Object.keys(o).length > 1);
        if (docks.length > 0)
            m.dockConfigs = docks;
        else
            delete m.dockConfigs;
    }

    const outBars = {};
    for (const b of barList) {
        if (!b || b.id === undefined)
            continue;
        const o = clone(b);
        delete o.id;
        delete o.enabled;
        outBars[b.id] = o;
    }

    const settings = {};
    const dropped = [];
    for (const k in m) {
        if (k === "barConfigs" || k === "configVersion")
            continue;
        if (typeof dmsStore.known === "function" && !dmsStore.known(k)) {
            dropped.push(k);
            continue;
        }
        settings[k] = m[k];
    }
    if (dropped.length > 0)
        notes.push("dropped " + dropped.join(", "));

    const out = Object.assign({}, dms, {
        "configVersion": current,
        "settings": settings,
        "bars": outBars
    });
    return {
        "dms": out,
        "from": from,
        "notes": notes
    };
}
