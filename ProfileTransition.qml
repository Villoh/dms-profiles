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
// Two-phase mode (a wallpaper is given to cover()): the animation does not wait
// for the new profile. It runs from the old frame onto the new wallpaper right
// away and ends opaque on it ("wallpaper"). The profile is applied meanwhile;
// uncover() then fades the whole overlay out, so bars, frame, windows and
// widgets appear over the same wallpaper. Only the capture freezes the screen.
//
// The overlay takes no input. A safety timer reveals after 12 s at the latest
// in case applying hangs or fails, so the screen never stays frozen.
//
// state: idle -> capturing -> covered -> revealing -> idle
// two-phase: idle -> capturing -> covered -> revealing -> wallpaper -> uncovering -> idle

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
    // The animation runs on the scene graph render thread (UniformAnimator,
    // OpacityAnimator in each overlay). A NumberAnimation on the GUI thread
    // stalled whenever DMS rebuilt the shell underneath, which in two-phase
    // mode is exactly while the animation runs (blocks of 0.1 to 0.5 s).
    property bool animRunning: false
    property bool animDone: false
    property int animDuration: 1200
    property int animEasing: Easing.InOutCubic
    property real animStartedAt: 0
    // the fade-out is already queued behind the running animation
    property bool fadeScheduled: false
    signal runAnimation
    signal runUncover(int delay)
    signal stopAnimations
    property int kindIndex: 0
    property real seed: 0
    property bool preview: false
    property int readyCount: 0
    // two-phase switch
    property string newWallpaper: ""
    readonly property bool twoPhase: newWallpaper !== ""
    property bool uncoverWanted: false
    readonly property int uncoverDuration: 380
    // The shell fades in during the last part of the animation already (the
    // old frame is nearly gone by then); must stay below uncoverDuration so
    // the fade ends after the animation. Tried a plain fade after the end
    // instead (19.09.2026): the overlap looked better.
    readonly property int uncoverOverlap: Math.min(300, Math.round(root.animDuration * 0.25))

    function cover(isPreview, wallpaper) {
        if (root.type === "none" && !isPreview)
            return "off";
        if (root.state !== "idle")
            return root.state;
        root.preview = isPreview === true;
        root.newWallpaper = (!root.preview && wallpaper) ? wallpaper : "";
        root.uncoverWanted = false;
        root.animRunning = false;
        root.animDone = false;
        root.stopAnimations();
        root.readyCount = 0;
        root.state = "capturing";
        captureTimeout.restart();
        safetyReveal.restart();
        return "started";
    }

    function pickKind(typeOverride) {
        const wanted = root.types.indexOf(typeOverride || "") >= 0 ? typeOverride : root.type;
        const chosen = root.types.indexOf(wanted) >= 0 ? wanted : root.randomPool[Math.floor(Math.random() * root.randomPool.length)];
        root.kindIndex = Math.max(0, root.types.indexOf(chosen));
        root.seed = Math.random();
        root.animDuration = root.duration;
        root.animEasing = root.linearTypes.indexOf(chosen) >= 0 ? Easing.Linear : Easing.InOutCubic;
        return chosen;
    }

    function startAnimation() {
        root.animRunning = true;
        root.animDone = false;
        root.fadeScheduled = false;
        root.animStartedAt = Date.now();
        root.runAnimation();
    }

    // from the overlays' animators (one per screen; the first one counts)
    function animationFinished() {
        if (!root.animRunning)
            return;
        root.animRunning = false;
        root.animDone = true;
        if (!root.twoPhase) {
            root.finish();
            return;
        }
        if (root.fadeScheduled) {
            root.state = "uncovering";
            return;
        }
        root.state = "wallpaper";
        if (root.uncoverWanted)
            root.uncover();
    }

    function uncoverFinished() {
        if (root.state === "uncovering" || root.fadeScheduled)
            root.finish();
    }

    // two-phase: its first frame IS the frozen frame, so the animation starts as
    // soon as both pictures are there; only the rebuild underneath waits for the
    // compositor to show the overlay (showDelay)
    function beginAnimation() {
        if (!root.twoPhase || root.animRunning || root.animDone)
            return;
        root.pickKind("");
        root.startAnimation();
    }

    function reveal(typeOverride) {
        if (root.state === "idle" || root.state === "revealing")
            return root.state;
        if (root.twoPhase && (root.animRunning || root.animDone)) {
            root.state = root.animRunning ? "revealing" : "wallpaper";
            if (root.animDone && root.uncoverWanted)
                root.uncover();
            return "running";
        }
        if (root.state === "capturing") {
            // no frame yet, nothing to animate
            root.finish();
            return "idle";
        }
        const chosen = root.pickKind(typeOverride);
        root.state = "revealing";
        root.startAnimation();
        return "revealing: " + chosen;
    }

    // two-phase: the profile is ready, fade the overlay out once the animation is done
    function uncover() {
        if (!root.twoPhase)
            return root.reveal("");
        if (root.state === "wallpaper") {
            root.state = "uncovering";
            root.runUncover(0);
            return "uncovering";
        }
        if (root.state === "revealing") {
            root.uncoverWanted = true;
            // Queue the fade on the render thread right behind the animation:
            // started from animationFinished() it came 0.18 s late, because the
            // GUI thread was still busy with the rebuild (measured 19.09.2026)
            if (root.animRunning && !root.fadeScheduled) {
                root.fadeScheduled = true;
                root.runUncover(Math.max(0, root.animDuration - root.uncoverOverlap - (Date.now() - root.animStartedAt)));
            }
            return "after animation";
        }
        if (root.state === "covered" || root.state === "capturing") {
            // animation not started yet (should not happen): plain reveal
            root.newWallpaper = "";
            return root.reveal("");
        }
        return root.state;
    }

    function finish() {
        root.fadeScheduled = false;
        safetyReveal.stop();
        captureTimeout.stop();
        root.state = "idle";
        root.animRunning = false;
        root.animDone = false;
        root.stopAnimations();
        root.preview = false;
        root.newWallpaper = "";
        root.uncoverWanted = false;
    }

    function outputReady() {
        root.readyCount++;
        if (root.state === "capturing" && root.readyCount >= Math.max(1, Quickshell.screens.length)) {
            captureTimeout.stop();
            root.state = "covered";
        }
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
            } else if (root.state === "wallpaper" || root.state === "revealing") {
                console.warn("Profiles: profile not ready after 12 s, uncovering");
                root.uncoverWanted = true;
                if (root.state === "wallpaper")
                    root.uncover();
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
                        // ppm: uncompressed, much faster than png. grim takes about
                        // 0.08 s, `dms screenshot` about 0.2 s; dms stays the fallback.
                        capture.command = ["sh", "-c", "if command -v grim >/dev/null; then exec grim -o \"$1\" -t ppm \"$2/$3\"; fi; exec dms screenshot output -o \"$1\" --no-clipboard --no-notify -f ppm -d \"$2\" --filename \"$3\"", "capture", overlay.outputName, overlay.captureDir, overlay.captureName];
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
                        overlay.maybeReady();
                    }
                }
            }

            // two-phase: the new wallpaper, cropped like DMS ("Fill"), as texture
            readonly property bool wallReady: !root.twoPhase || wall.status === Image.Ready || wall.status === Image.Error
            onWallReadyChanged: overlay.maybeReady()
            function maybeReady() {
                if (overlay.loaded && overlay.wallReady && root.state === "capturing" && !showDelay.running) {
                    root.beginAnimation();
                    showDelay.restart();
                }
            }

            // Screen size, not the window size: the window only gets its size
            // when it maps, and a changed sourceSize loads the image a second
            // time (cost 0.25 s of frozen screen, measured 19.09.2026)
            readonly property int screenW: overlay.modelData?.width ?? 1920
            readonly property int screenH: overlay.modelData?.height ?? 1080

            Item {
                id: wallBox
                width: overlay.screenW
                height: overlay.screenH
                // stays "visible" so the texture renders it; hideSource keeps it off screen
                clip: true

                Image {
                    id: wall
                    anchors.fill: parent
                    source: root.twoPhase ? "file://" + root.newWallpaper : ""
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                    cache: false
                    smooth: true
                    sourceSize.width: overlay.screenW
                    sourceSize.height: overlay.screenH
                }
            }

            ShaderEffectSource {
                id: wallTexture
                sourceItem: wallBox
                hideSource: true
                live: true
                visible: false
                width: overlay.screenW
                height: overlay.screenH
            }

            // Wait two frames until niri really shows the frozen frame before
            // the profile may be rebuilt underneath.
            Timer {
                id: showDelay
                interval: 34
                onTriggered: root.outputReady()
            }

            ShaderEffect {
                id: fx
                anchors.fill: parent
                visible: overlay.loaded
                blending: true

                property var oldFrame: frame
                property var newFrame: wallTexture
                property real twoPhase: root.twoPhase ? 1 : 0
                // driven by the animators below, not bound
                property real progress: 0
                property real kind: root.kindIndex
                property real screenW: width
                property real screenH: height
                property real seed: root.seed
                property real glow: root.edgeGlow ? 1 : 0
                property real preview: root.preview ? 1 : 0
                property color edgeColor: Theme.primary

                fragmentShader: Qt.resolvedUrl("shaders/transition.frag.qsb")
            }

            UniformAnimator {
                id: fxAnim
                target: fx
                uniform: "progress"
                from: 0
                to: 1
                duration: root.animDuration
                easing.type: root.animEasing
                onFinished: root.animationFinished()
            }

            SequentialAnimation {
                id: fadeAnim
                PauseAnimation {
                    id: fadePause
                    duration: 0
                }
                OpacityAnimator {
                    target: fx
                    from: 1
                    to: 0
                    duration: root.uncoverDuration
                    easing.type: Easing.InOutQuad
                }
                onFinished: root.uncoverFinished()
            }

            Connections {
                target: root
                function onRunAnimation() {
                    fadeAnim.stop();
                    fx.opacity = 1;
                    fx.progress = 0;
                    fxAnim.restart();
                }
                function onRunUncover(delay) {
                    fadePause.duration = delay;
                    fadeAnim.restart();
                }
                function onStopAnimations() {
                    fxAnim.stop();
                    fadeAnim.stop();
                    fx.progress = 0;
                    fx.opacity = 1;
                }
            }
        }
    }
}
