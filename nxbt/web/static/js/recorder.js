const RECORDER_BUTTONS = [
    "Y", "X", "B", "A",
    "DPAD_UP", "DPAD_LEFT", "DPAD_RIGHT", "DPAD_DOWN",
    "L", "ZL", "R", "ZR",
    "PLUS", "MINUS", "HOME", "CAPTURE",
    "JCL_SR", "JCL_SL", "JCR_SR", "JCR_SL"
];

function resetRecorder() {
    let recorder = window.NXBTApp.recorder;
    recorder.active = false;
    recorder.startedAt = null;
    recorder.lastEventAt = null;
    recorder.events = [];
    recorder.preview = "";
    recorder.previousPacket = null;
    window.NXBTApp.dom.recorderPreview.value = "";
    updateRecorderSummary();
}

function startRecorder() {
    resetRecorder();
    let recorder = window.NXBTApp.recorder;
    recorder.active = true;
    recorder.startedAt = performance.now();
    recorder.lastEventAt = recorder.startedAt;
    recorder.previousPacket = JSON.parse(JSON.stringify(window.NXBTApp.state.inputPacket));
    setBannerStatus("Aufzeichnung gestartet", "warning");
    appendLog("Recorder gestartet", "warning");
    syncRecorderButtons();
    updateRecorderSummary();
}

function stopRecorder() {
    let recorder = window.NXBTApp.recorder;
    if (!recorder.active) {
        setBannerStatus("Recorder ist nicht aktiv", "warning");
        return;
    }

    recorder.active = false;
    recorder.preview = buildRecorderMacro(recorder.events);
    window.NXBTApp.dom.recorderPreview.value = recorder.preview;
    syncRecorderButtons();
    updateRecorderSummary();
    setBannerStatus("Aufzeichnung beendet", "success");
    appendLog("Recorder gestoppt", "info");
}

function adoptRecorderMacro(mode) {
    let preview = window.NXBTApp.dom.recorderPreview.value.trim();
    if (!preview) {
        setBannerStatus("Keine Aufzeichnung zum Uebernehmen", "warning");
        return;
    }

    if (mode === "append" && window.NXBTApp.dom.macroText.value.trim()) {
        window.NXBTApp.dom.macroText.value += "\n\n" + preview;
    } else {
        window.NXBTApp.dom.macroText.value = preview;
    }

    setBannerStatus("Recorder-Makro uebernommen", "success");
}

function roundRecorderTime(seconds) {
    if (seconds < 0.075) {
        return 0;
    }
    return Math.max(0.1, Math.round(seconds * 10) / 10);
}

function formatRecorderDuration(seconds) {
    return roundRecorderTime(seconds).toFixed(1) + "S";
}

function packetButtons(packet) {
    let pressed = [];
    for (let i = 0; i < RECORDER_BUTTONS.length; i++) {
        let button = RECORDER_BUTTONS[i];
        if (packet[button]) {
            pressed.push(button);
        }
    }
    if (packet.L_STICK.PRESSED) {
        pressed.push("L_STICK_PRESS");
    }
    if (packet.R_STICK.PRESSED) {
        pressed.push("R_STICK_PRESS");
    }
    return pressed;
}

function stickToMacro(name, stickState) {
    let x = Math.round(stickState.X_VALUE);
    let y = Math.round(stickState.Y_VALUE);
    if (Math.abs(x) < 25 && Math.abs(y) < 25) {
        return null;
    }

    let xFormatted = (x >= 0 ? "+" : "-") + String(Math.abs(x)).padStart(3, "0");
    let yFormatted = (y >= 0 ? "+" : "-") + String(Math.abs(y)).padStart(3, "0");
    return name + "@" + xFormatted + yFormatted;
}

function captureRecorderEvent(nextPacket) {
    let recorder = window.NXBTApp.recorder;
    if (!recorder.active) {
        return;
    }

    let previous = recorder.previousPacket || JSON.parse(JSON.stringify(nextPacket));
    let now = performance.now();
    let pressedButtons = [];
    let previousButtons = packetButtons(previous);
    let currentButtons = packetButtons(nextPacket);

    for (let i = 0; i < currentButtons.length; i++) {
        if (previousButtons.indexOf(currentButtons[i]) === -1) {
            pressedButtons.push(currentButtons[i]);
        }
    }

    let leftStickMacro = stickToMacro("L_STICK", nextPacket.L_STICK);
    let prevLeftStickMacro = stickToMacro("L_STICK", previous.L_STICK);
    if (leftStickMacro && leftStickMacro !== prevLeftStickMacro) {
        pressedButtons.push(leftStickMacro);
    }

    let rightStickMacro = stickToMacro("R_STICK", nextPacket.R_STICK);
    let prevRightStickMacro = stickToMacro("R_STICK", previous.R_STICK);
    if (rightStickMacro && rightStickMacro !== prevRightStickMacro) {
        pressedButtons.push(rightStickMacro);
    }

    if (pressedButtons.length < 1) {
        recorder.previousPacket = JSON.parse(JSON.stringify(nextPacket));
        return;
    }

    let delay = roundRecorderTime((now - recorder.lastEventAt) / 1000);
    if (delay > 0) {
        recorder.events.push({ type: "wait", duration: delay });
    }

    recorder.events.push({ type: "buttons", buttons: pressedButtons, duration: 0.1 });
    recorder.lastEventAt = now;
    recorder.previousPacket = JSON.parse(JSON.stringify(nextPacket));
    recorder.preview = buildRecorderMacro(recorder.events);
    window.NXBTApp.dom.recorderPreview.value = recorder.preview;
    updateRecorderSummary();
}

function buildRecorderMacro(events) {
    let lines = [];
    for (let i = 0; i < events.length; i++) {
        let event = events[i];
        if (event.type === "wait") {
            lines.push(formatRecorderDuration(event.duration));
        } else if (event.type === "buttons") {
            lines.push(event.buttons.join(" ") + " " + formatRecorderDuration(event.duration));
        }
    }
    return lines.join("\n\n");
}

function syncRecorderButtons() {
    let recorder = window.NXBTApp.recorder;
    window.NXBTApp.dom.recorderStart.disabled = recorder.active;
    window.NXBTApp.dom.recorderStop.disabled = !recorder.active;
}
