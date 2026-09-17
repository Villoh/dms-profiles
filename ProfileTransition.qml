// Profiles: animated transition on profile switch.
//
// Wallpaper managers only cross-fade the wallpaper. A profile switch rebuilds
// everything: bar, frame, colors, widgets, wallpaper. Without a transition that
// visibly jumps piece by piece. So:
//
//   1. cover(): capture the WHOLE screen per output and show it on an overlay
//      surface above everything.
//   2. The profile is applied underneath.
//   3. reveal(): shaders/transition.frag removes the old frame, the new
//      profile underneath is live.
//
// The overlay takes no input. A safety timer reveals after 12 s at the latest
// in case applying hangs or fails, so the screen never stays frozen.
//
// state: idle -> capturing -> covered -> revealing -> idle

pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Common

Scope {
    id: root

    readonly property var _settings: SettingsData.pluginSettings
    function cfg(key, fallback) {
        return SettingsData.getPluginSetting("dmsProfiles", key, fallback);
    }

    // none | random | one of the types below
    readonly property string type: {
        root._settings;
        return cfg("transition", "random");
    }
    readonly property int duration: {
        root._settings;
        return Math.max(300, Math.min(4000, cfg("transitionMs", 1200)));
    }
    readonly property bool edgeGlow: {
        root._settings;
        return cfg("transitionGlow", true);
    }

    // order = kind number in shaders/transition.frag
    readonly property var types: ["fade", "wipe", "disc", "iris", "pixel", "stripes", "ember", "zoom", "slide", "doors", "blinds", "squares", "wave", "clock", "dots", "swirl", "ripple", "melt", "blur", "dissolve", "black", "shatter", "glitch", "crt", "glitchcode", "glitchvhs", "glitchsort", "glitchscan", "snow"]
    // pool for "random"; empty or invalid = all types
    readonly property var randomPool: {
        root._settings;
        const l = cfg("transitionPool", []);
        const valid = Array.isArray(l) ? l.filter(x => root.types.indexOf(x) >= 0) : [];
        return valid.length > 0 ? valid : root.types;
    }
    // types with their own timing: linear instead of easing in and out
    readonly property var linearTypes: ["melt", "glitch", "crt", "dissolve", "glitchcode", "glitchvhs", "glitchsort", "glitchscan", "snow"]

    property string state: "idle"
    property real progress: 0
    property int kindIndex: 0
    property real seed: 0
    property bool preview: false
    property int readyCount: 0

    function cover(isPreview) {
        if (root.type === "none" && !isPreview)
            return "off";
        if (root.state !== "idle")
            return root.state;
        root.preview = isPreview === true;
        root.progress = 0;
        root.readyCount = 0;
        root.state = "capturing";
        captureTimeout.restart();
        safetyReveal.restart();
        return "started";
    }

    function reveal(typeOverride) {
        if (root.state === "idle" || root.state === "revealing")
            return root.state;
        if (root.state === "capturing") {
            // no frame yet, nothing to animate
            root.finish();
            return "idle";
        }
        const wanted = root.types.indexOf(typeOverride || "") >= 0 ? typeOverride : root.type;
        const chosen = root.types.indexOf(wanted) >= 0 ? wanted : root.randomPool[Math.floor(Math.random() * root.randomPool.length)];
        root.kindIndex = Math.max(0, root.types.indexOf(chosen));
        root.seed = Math.random();
        root.state = "revealing";
        animation.duration = root.duration;
        animation.easing.type = root.linearTypes.indexOf(chosen) >= 0 ? Easing.Linear : Easing.InOutCubic;
        animation.restart();
        return "revealing: " + chosen;
    }

    function finish() {
        animation.stop();
        safetyReveal.stop();
        captureTimeout.stop();
        root.state = "idle";
        root.progress = 0;
        root.preview = false;
    }

    function outputReady() {
        root.readyCount++;
        if (root.state === "capturing" && root.readyCount >= Math.max(1, Quickshell.screens.length)) {
            captureTimeout.stop();
            root.state = "covered";
        }
    }

    NumberAnimation {
        id: animation
        target: root
        property: "progress"
        from: 0
        to: 1
        easing.type: Easing.InOutCubic
        onFinished: root.finish()
    }

    // capture did not complete: do not hang, continue without a transition
    Timer {
        id: captureTimeout
        interval: 2500
        onTriggered: {
            if (root.state === "capturing") {
                console.warn("Profiles: screen capture for the transition did not complete");
                root.finish();
            }
        }
    }

    Timer {
        id: safetyReveal
        interval: 12000
        onTriggered: {
            if (root.state === "covered") {
                console.warn("Profiles: transition still covered after 12 s, revealing");
                root.reveal();
            }
        }
    }

    Variants {
        model: Quickshell.screens

        delegate: PanelWindow {
            id: overlay

            required property var modelData

            screen: overlay.modelData
            // The capture runs as a separate process, not as ScreencopyView.
            // ScreencopyView inside the DMS process crashed Qt Wayland whenever
            // other windows mapped or unmapped while a capture source was set.
            property bool loaded: false
            readonly property string outputName: overlay.modelData?.name ?? "0"
            readonly property string captureDir: Quickshell.env("XDG_RUNTIME_DIR") || "/tmp"
            readonly property string captureName: "dms-profiles-transition-" + overlay.outputName + ".ppm"
            readonly property string captureFile: overlay.captureDir + "/" + overlay.captureName

            visible: overlay.loaded && root.state !== "idle"
            color: "transparent"

            WlrLayershell.namespace: "dms:profiles-transition"
            WlrLayershell.layer: WlrLayer.Overlay
            WlrLayershell.exclusionMode: ExclusionMode.Ignore
            WlrLayershell.keyboardFocus: WlrKeyboardFocus.None

            anchors {
                left: true
                right: true
                top: true
                bottom: true
            }

            mask: Region {
                item: Item {}
            }

            Connections {
                target: root
                function onStateChanged() {
                    if (root.state === "capturing") {
                        overlay.loaded = false;
                        frame.source = "";
                        // ppm: uncompressed, much faster than png
                        capture.command = ["dms", "screenshot", "output", "-o", overlay.outputName, "--no-clipboard", "--no-notify", "-f", "ppm", "-d", overlay.captureDir, "--filename", overlay.captureName];
                        capture.running = true;
                    } else if (root.state === "idle") {
                        overlay.loaded = false;
                        frame.source = "";
                    }
                }
            }

            Process {
                id: capture
                onExited: code => {
                    if (root.state !== "capturing")
                        return;
                    if (code !== 0) {
                        console.warn("Profiles: screenshot for the transition exited with", code);
                        return;
                    }
                    frame.source = "file://" + overlay.captureFile;
                }
            }

            Image {
                id: frame
                anchors.fill: parent
                visible: false
                asynchronous: true
                cache: false
                smooth: true
                onStatusChanged: {
                    if (status === Image.Ready && root.state === "capturing") {
                        overlay.loaded = true;
                        showDelay.restart();
                    }
                }
            }

            // Wait a few frames until niri really shows the frozen frame before
            // the profile may be rebuilt underneath.
            Timer {
                id: showDelay
                interval: 90
                onTriggered: root.outputReady()
            }

            ShaderEffect {
                anchors.fill: parent
                visible: overlay.loaded
                blending: true

                property var oldFrame: frame
                property real progress: root.progress
                property real kind: root.kindIndex
                property real screenW: width
                property real screenH: height
                property real seed: root.seed
                property real glow: root.edgeGlow ? 1 : 0
                property real preview: root.preview ? 1 : 0
                property color edgeColor: Theme.primary

                fragmentShader: Qt.resolvedUrl("shaders/transition.frag.qsb")
            }
        }
    }
}
