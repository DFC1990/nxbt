/**********************************************/
/* NXBT Webapp Bootstrap */
/**********************************************/

window.NXBTApp = {
    socket: null,
    enums: {
        ControllerState: {
            INITIALIZING: "initializing",
            CONNECTING: "connecting",
            RECONNECTING: "reconnecting",
            CONNECTED: "connected",
            CRASHED: "crashed"
        },
        InputDevice: {
            KEYBOARD: "keyboard",
            GAMEPAD: "gamepad"
        }
    },
    constants: {
        KEYMAP: {
            87: "LS_UP",
            65: "LS_LEFT",
            68: "LS_RIGHT",
            83: "LS_DOWN",
            84: "LS_PRESS",
            38: "RS_UP",
            37: "RS_LEFT",
            39: "RS_RIGHT",
            40: "RS_DOWN",
            89: "RS_PRESS",
            71: "DPAD_UP",
            86: "DPAD_LEFT",
            78: "DPAD_RIGHT",
            66: "DPAD_DOWN",
            219: "HOME",
            221: "CAPTURE",
            54: "PLUS",
            55: "MINUS",
            76: "A",
            75: "B",
            73: "X",
            74: "Y",
            49: "L",
            50: "ZL",
            56: "ZR",
            57: "R"
        },
        LEFT_STICK: ["LS_UP", "LS_LEFT", "LS_RIGHT", "LS_DOWN"],
        RIGHT_STICK: ["RS_UP", "RS_LEFT", "RS_RIGHT", "RS_DOWN"],
        LOADER_ANIMATION_FRAMES: [0, 1, 2, 3, 3, 2, 1, 0]
    },
    state: {
        nxbtControllerIndex: false,
        controllerIndex: false,
        connected: false,
        state: false,
        inputDevice: "keyboard",
        inputPacket: null,
        inputPacketOld: null,
        useRAF: true,
        frequency: (1 / 120) * 1000,
        timeOld: false,
        loaderFrame: 1,
        highlightedBlock: false,
        checkForLoadInterval: false,
        eventLoopRunning: false,
        statusIndicatorInterval: false,
        macroFlash: {}
    },
    macroStatus: {
        running: false,
        debug_mode: false,
        paused: false,
        pausing: false,
        stopping: false,
        stopped: false,
        macro_name: null,
        started_at: null,
        current_line: null,
        current_raw: null,
        current_action: null,
        current_button: null,
        current_buttons: [],
        current_duration: null,
        current_wait: null,
        current_remaining: null,
        loop_stack: [],
        steps_done: 0,
        steps_total: 0,
        elapsed_seconds: 0,
        estimated_remaining: null,
        last_error: null,
        last_result: null
    },
    recorder: {
        active: false,
        startedAt: null,
        lastEventAt: null,
        events: [],
        preview: "",
        previousPacket: null
    },
    dom: {},
    displays: {
        proController: {}
    }
};

function createInputPacket() {
    return {
        L_STICK: { PRESSED: false, X_VALUE: 0, Y_VALUE: 0, LS_UP: false, LS_LEFT: false, LS_RIGHT: false, LS_DOWN: false },
        R_STICK: { PRESSED: false, X_VALUE: 0, Y_VALUE: 0, RS_UP: false, RS_LEFT: false, RS_RIGHT: false, RS_DOWN: false },
        DPAD_UP: false,
        DPAD_LEFT: false,
        DPAD_RIGHT: false,
        DPAD_DOWN: false,
        L: false,
        ZL: false,
        R: false,
        ZR: false,
        JCL_SR: false,
        JCL_SL: false,
        JCR_SR: false,
        JCR_SL: false,
        PLUS: false,
        MINUS: false,
        HOME: false,
        CAPTURE: false,
        Y: false,
        X: false,
        B: false,
        A: false
    };
}

function cacheDom() {
    let dom = window.NXBTApp.dom;
    dom.controllerSelection = document.getElementById("controller-selection");
    dom.loader = document.getElementById("loader");
    dom.loaderText = document.getElementById("loader-text");
    dom.loaderBlocks = document.getElementById("loader-blocks");
    dom.controllerConfig = document.getElementById("controller-config");
    dom.controllerCard = document.getElementById("controller-card");
    dom.inputDevice = document.getElementById("input-device");
    dom.keyboardMap = document.getElementById("keyboard-map");
    dom.controllerMap = document.getElementById("controller-map");
    dom.macroName = document.getElementById("macro-name");
    dom.macroSearch = document.getElementById("macro-search");
    dom.macroList = document.getElementById("macro-list");
    dom.macroText = document.getElementById("macro-text");
    dom.macroStatus = document.getElementById("macro-status");
    dom.macroRun = document.getElementById("macro-run");
    dom.macroStop = document.getElementById("macro-stop");
    dom.debugPanel = document.getElementById("debug-panel");
    dom.debugStart = document.getElementById("debug-start");
    dom.debugNext = document.getElementById("debug-next");
    dom.debugContinue = document.getElementById("debug-continue");
    dom.debugPause = document.getElementById("debug-pause");
    dom.debugAbort = document.getElementById("debug-abort");
    dom.macroRunState = document.getElementById("macro-run-state");
    dom.macroCurrentLine = document.getElementById("macro-current-line");
    dom.macroCurrentAction = document.getElementById("macro-current-action");
    dom.macroCurrentButton = document.getElementById("macro-current-button");
    dom.macroCurrentLoop = document.getElementById("macro-current-loop");
    dom.macroCurrentRaw = document.getElementById("macro-current-raw");
    dom.macroProgressBar = document.getElementById("macro-progress-bar");
    dom.macroProgressText = document.getElementById("macro-progress-text");
    dom.macroElapsed = document.getElementById("macro-elapsed");
    dom.macroRemaining = document.getElementById("macro-remaining");
    dom.statusIndicator = document.getElementById("status-indicator");
    dom.statusIndicatorLight = document.getElementById("status-indicator-light");
    dom.statusIndicatorText = document.getElementById("status-indicator-text");
    dom.errorDisplay = document.getElementById("error-display");
    dom.controllerSessions = document.getElementById("controller-sessions");
    dom.controllerSessionsContainer = document.getElementById("controller-session-container");
    dom.macroFloatBar = document.getElementById("macro-float-bar");
    dom.liveStatusBadge = document.getElementById("live-status-badge");
    dom.controllerConnectionText = document.getElementById("controller-connection-text");
    dom.recorderState = document.getElementById("recorder-state");
    dom.recorderPreview = document.getElementById("recorder-preview");
    dom.recorderStart = document.getElementById("recorder-start");
    dom.recorderStop = document.getElementById("recorder-stop");
    dom.logEntries = document.getElementById("log-entries");
    dom.networkMode = document.getElementById("network-mode");
    dom.networkWifiSsid = document.getElementById("network-wifi-ssid");
    dom.networkWifiIp = document.getElementById("network-wifi-ip");
    dom.networkHotspotState = document.getElementById("network-hotspot-state");
    dom.networkHotspotIp = document.getElementById("network-hotspot-ip");
    dom.networkHotspotOnly = document.getElementById("network-hotspot-only");
    dom.networkScan = document.getElementById("network-scan");
    dom.networkMessage = document.getElementById("network-message");
    dom.networkList = document.getElementById("network-list");
    dom.networkConnectForm = document.getElementById("network-connect-form");
    dom.networkSsidInput = document.getElementById("network-ssid-input");
    dom.networkPasswordInput = document.getElementById("network-password-input");
}

function cacheDisplays() {
    window.NXBTApp.displays.proController = {
        L_STICK: { STICK: true, ELEMENT: document.getElementById("pc_ls"), MAX_X: 23, MIN_X: 15.5, DIFF_X: 7.5, MAX_Y: 29, MIN_Y: 18, DIFF_Y: 11 },
        R_STICK: { STICK: true, ELEMENT: document.getElementById("pc_rs"), MAX_X: 63.5, MIN_X: 56, DIFF_X: 7.5, MAX_Y: 50, MIN_Y: 38.125, DIFF_Y: 11.875 },
        DPAD_UP: document.getElementById("pc_du"),
        DPAD_LEFT: document.getElementById("pc_dl"),
        DPAD_RIGHT: document.getElementById("pc_dr"),
        DPAD_DOWN: document.getElementById("pc_dd"),
        L: document.getElementById("pc_l"),
        ZL: document.getElementById("pc_zl"),
        R: document.getElementById("pc_r"),
        ZR: document.getElementById("pc_zr"),
        PLUS: document.getElementById("pc_p"),
        MINUS: document.getElementById("pc_m"),
        HOME: document.getElementById("pc_h"),
        CAPTURE: document.getElementById("pc_c"),
        Y: document.getElementById("pc_y"),
        X: document.getElementById("pc_x"),
        B: document.getElementById("pc_b"),
        A: document.getElementById("pc_a")
    };
}

function initializeApp() {
    window.NXBTApp.state.inputPacket = createInputPacket();
    window.NXBTApp.state.inputPacketOld = createInputPacket();
    cacheDom();
    cacheDisplays();
    initializeSocket();
    initializeInputDevices();
    if (typeof initializeMacroSocketHandlers === "function") {
        initializeMacroSocketHandlers();
    }
    syncRecorderButtons();
    syncMacroControls();
    renderMacroStatus();
    refreshMacroList();
    pollMacroStatus();
    refreshNetworkStatus();
    setInterval(updateLoader, 85);
    setInterval(displayOtherSessions, 2000);
    setInterval(pollMacroStatus, 1000);
    setInterval(refreshNetworkStatus, 5000);

    window.NXBTApp.dom.macroList.addEventListener("change", function(evt) {
        if (evt.target.value) {
            window.NXBTApp.dom.macroName.value = evt.target.value;
        }
    });

    window.NXBTApp.dom.macroSearch.addEventListener("input", function() {
        refreshMacroList(window.NXBTApp.dom.macroList.value);
    });
}

window.onload = initializeApp;

function refreshNetworkStatus() {
    fetch("/api/wifi/status")
        .then((response) => response.json())
        .then((data) => {
            const dom = window.NXBTApp.dom;
            if (!dom.networkMode) return;
            dom.networkMode.textContent = data.mode === "hotspot_only" ? "Hotspot-Betrieb" : "WLAN-Betrieb";
            dom.networkWifiSsid.textContent = data.connected && data.ssid ? data.ssid : "Nicht verbunden";
            dom.networkWifiIp.textContent = data.ip || "-";
            dom.networkHotspotState.textContent = data.hotspot_active ? "Aktiv" : "Inaktiv";
            dom.networkHotspotIp.textContent = data.hotspot_active
                ? `${data.hotspot_ip || "192.168.4.1"}:8000`
                : "192.168.4.1:8000";
        })
        .catch((error) => showNetworkMessage(`Netzwerkstatus fehlgeschlagen: ${error.message}`, "error"));
}

function showNetworkMessage(message, type) {
    const element = window.NXBTApp.dom.networkMessage;
    if (!element) return;
    element.textContent = message;
    element.className = `network-message ${type || "info"}`;
    element.classList.toggle("hidden", !message);
}

function useHotspotOnlyDesktop() {
    const dom = window.NXBTApp.dom;
    dom.networkHotspotOnly.disabled = true;
    showNetworkMessage("Hotspot-Betrieb wird aktiviert...", "info");
    fetch("/api/wifi/hotspot-only", { method: "POST" })
        .then((response) => response.json())
        .then((data) => {
            if (data.ok) {
                showNetworkMessage("Hotspot ist aktiv. NXBT bleibt lokal unter 192.168.4.1:8000 erreichbar.", "success");
            } else {
                showNetworkMessage(data.error || "Hotspot konnte nicht aktiviert werden.", "error");
            }
            refreshNetworkStatus();
        })
        .catch((error) => showNetworkMessage(`Fehler: ${error.message}`, "error"))
        .finally(() => {
            dom.networkHotspotOnly.disabled = false;
        });
}

function scanNetworksDesktop() {
    const dom = window.NXBTApp.dom;
    dom.networkScan.disabled = true;
    dom.networkList.classList.remove("hidden");
    dom.networkList.innerHTML = '<div class="network-list-empty">Suche laeuft...</div>';
    fetch("/api/wifi/networks")
        .then((response) => response.json())
        .then((data) => renderNetworksDesktop(data.networks || []))
        .catch((error) => {
            dom.networkList.innerHTML = '<div class="network-list-empty">Scan fehlgeschlagen</div>';
            showNetworkMessage(`Scan fehlgeschlagen: ${error.message}`, "error");
        })
        .finally(() => {
            dom.networkScan.disabled = false;
        });
}

function renderNetworksDesktop(networks) {
    const dom = window.NXBTApp.dom;
    dom.networkList.innerHTML = "";
    if (!networks.length) {
        dom.networkList.innerHTML = '<div class="network-list-empty">Keine Netzwerke gefunden</div>';
        return;
    }

    networks.forEach((network) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "network-list-item";
        const meta = [
            `${network.signal || 0} dBm`,
            network.secured ? "gesichert" : "offen",
            network.saved ? "gespeichert" : "",
            network.active ? "aktiv" : ""
        ].filter(Boolean).join(" · ");
        button.innerHTML = `<span></span><small>${meta}</small>`;
        button.querySelector("span").textContent = network.ssid;
        button.addEventListener("click", () => {
            dom.networkSsidInput.value = network.ssid;
            dom.networkPasswordInput.value = "";
            dom.networkConnectForm.classList.remove("hidden");
            dom.networkList.classList.add("hidden");
            if (network.secured) {
                dom.networkPasswordInput.focus();
            }
        });
        dom.networkList.appendChild(button);
    });
}

function connectNetworkDesktop(event) {
    event.preventDefault();
    const dom = window.NXBTApp.dom;
    const ssid = dom.networkSsidInput.value.trim();
    if (!ssid) {
        showNetworkMessage("SSID erforderlich.", "error");
        return;
    }

    showNetworkMessage("Verbindung wird hergestellt. Im Hotspot kann die Seite kurz abbrechen.", "info");
    fetch("/api/wifi/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ssid, password: dom.networkPasswordInput.value })
    })
        .then((response) => response.json())
        .then((data) => {
            if (data.ok) {
                dom.networkConnectForm.classList.add("hidden");
                dom.networkConnectForm.reset();
                showNetworkMessage(`Mit ${data.ssid || ssid} verbunden und gespeichert.`, "success");
            } else {
                showNetworkMessage(data.error || "Verbindung fehlgeschlagen.", "error");
            }
            refreshNetworkStatus();
        })
        .catch((error) => showNetworkMessage(`Fehler: ${error.message}`, "error"));
}

function cancelNetworkConnectDesktop() {
    const dom = window.NXBTApp.dom;
    dom.networkConnectForm.classList.add("hidden");
    dom.networkConnectForm.reset();
}
