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
    dom.liveStatusBadge = document.getElementById("live-status-badge");
    dom.controllerConnectionText = document.getElementById("controller-connection-text");
    dom.recorderState = document.getElementById("recorder-state");
    dom.recorderPreview = document.getElementById("recorder-preview");
    dom.recorderStart = document.getElementById("recorder-start");
    dom.recorderStop = document.getElementById("recorder-stop");
    dom.logEntries = document.getElementById("log-entries");
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
    setInterval(updateLoader, 85);
    setInterval(displayOtherSessions, 2000);
    setInterval(pollMacroStatus, 1000);

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
