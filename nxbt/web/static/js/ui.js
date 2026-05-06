function appendLog(message, level) {
    appendStructuredLog({
        time_label: new Date().toLocaleTimeString(),
        level: level || "info",
        message: message
    }, true);
}

function appendStructuredLog(entry, prepend) {
    if (!window.NXBTApp || !window.NXBTApp.dom.logEntries) {
        return;
    }

    let logDiv = document.createElement("div");
    logDiv.classList.add("log-entry");
    logDiv.classList.add((entry.level || "info"));

    let stamp = document.createElement("span");
    stamp.classList.add("log-time");
    stamp.innerHTML = entry.time_label || new Date().toLocaleTimeString();

    let text = document.createElement("span");
    text.classList.add("log-message");
    text.innerHTML = entry.message || "";

    let row = document.createElement("div");
    row.classList.add("log-row");
    row.appendChild(stamp);
    row.appendChild(text);

    if (entry.line) {
        let meta = document.createElement("span");
        meta.classList.add("log-meta");
        meta.innerHTML = "Zeile " + entry.line + (entry.action ? " • " + entry.action : "");
        logDiv.appendChild(meta);
    }

    logDiv.appendChild(row);

    if (prepend === false) {
        window.NXBTApp.dom.logEntries.appendChild(logDiv);
    } else {
        window.NXBTApp.dom.logEntries.prepend(logDiv);
    }

    while (window.NXBTApp.dom.logEntries.children.length > 200) {
        window.NXBTApp.dom.logEntries.removeChild(window.NXBTApp.dom.logEntries.lastChild);
    }
}

function renderLogHistory(entries) {
    if (!window.NXBTApp || !window.NXBTApp.dom.logEntries) {
        return;
    }
    window.NXBTApp.dom.logEntries.innerHTML = "";
    let logs = entries || [];
    for (let i = logs.length - 1; i >= 0; i--) {
        appendStructuredLog(logs[i], false);
    }
}

function formatSeconds(value) {
    if (value === null || value === undefined || isNaN(value)) {
        return "0.0s";
    }
    return Number(value).toFixed(1) + "s";
}

function updateMacroFloatBar(status) {
    let bar = document.getElementById('macro-float-bar');
    if (!bar) { return; }

    let running = status && status.running && !status.stopping;
    if (!running) {
        bar.classList.add('hidden');
        return;
    }

    bar.classList.remove('hidden');

    let nameEl = document.getElementById('macro-float-name');
    let stepEl = document.getElementById('macro-float-step');
    let remEl  = document.getElementById('macro-float-remaining');

    if (nameEl) {
        let label = status.macro_name || 'Makro';
        if (status.repeat_total > 1) {
            label += '  ' + status.repeat_current + '/' + status.repeat_total + 'x';
        }
        nameEl.textContent = label;
    }
    if (stepEl) {
        stepEl.textContent = (status.steps_done || 0) + ' / ' + (status.steps_total || 0) + ' Schritte';
    }
    if (remEl) {
        remEl.textContent = formatSeconds(status.estimated_remaining);
    }
}

function setBannerStatus(message, variant) {
    let banner = window.NXBTApp.dom.macroStatus;
    if (!banner) {
        return;
    }

    banner.classList.remove("hidden", "macro-status-success", "macro-status-error", "macro-status-warning");
    if (variant === "error") {
        banner.classList.add("macro-status-error");
    } else if (variant === "warning") {
        banner.classList.add("macro-status-warning");
    } else {
        banner.classList.add("macro-status-success");
    }
    banner.innerHTML = message;
}

function displayError(errorText) {
    let errorContainer = document.createElement('div');
    errorContainer.classList.add('error');

    let errorHeader = document.createElement('h1');
    errorHeader.innerHTML = 'ERROR';

    let errorMessage = document.createElement('p');
    errorMessage.innerHTML = errorText;

    errorContainer.appendChild(errorHeader);
    errorContainer.appendChild(errorMessage);
    window.NXBTApp.dom.errorDisplay.appendChild(errorContainer);
    appendLog(errorText, "error");
    setBannerStatus(errorText, "error");

    setTimeout(function() {
        errorContainer.remove();
    }, 10000);
}

function renderControllerBadge(message, variant) {
    let badge = window.NXBTApp.dom.liveStatusBadge;
    if (!badge) {
        return;
    }

    badge.className = "status-pill";
    if (variant) {
        badge.classList.add("status-pill-" + variant);
    }
    badge.innerHTML = message;
}

function updateConnectionSummary() {
    let dom = window.NXBTApp.dom;
    let targets = document.querySelectorAll('[data-role="controller-connection"]');
    let macroStatus = window.NXBTApp.macroStatus || {};
    if (!window.NXBTApp.state.connected || !window.NXBTApp.state.state) {
        for (let i = 0; i < targets.length; i++) {
            targets[i].innerHTML = "Getrennt";
        }
        if (!macroStatus.running) {
            renderControllerBadge("Controller getrennt", "error");
        }
        return;
    }

    let current = window.NXBTApp.state.state[window.NXBTApp.state.nxbtControllerIndex];
    if (!current) {
        for (let i = 0; i < targets.length; i++) {
            targets[i].innerHTML = "Keine aktive Session";
        }
        if (!macroStatus.running) {
            renderControllerBadge("Keine aktive Session", "warning");
        }
        return;
    }

    let state = current.state || "unbekannt";
    for (let i = 0; i < targets.length; i++) {
        targets[i].innerHTML = state.toUpperCase();
    }
    if (macroStatus.running) {
        return;
    }

    if (state === "connected") {
        renderControllerBadge("Controller verbunden", "success");
    } else if (state === "crashed") {
        renderControllerBadge("Controllerfehler", "error");
    } else {
        renderControllerBadge("Controller aktiv", "warning");
    }
}

function updateRecorderSummary() {
    let recorder = window.NXBTApp.recorder;
    let targets = document.querySelectorAll('[data-role="recorder-state"]');
    if (!recorder.active) {
        for (let i = 0; i < targets.length; i++) {
            targets[i].innerHTML = "Recorder inaktiv";
        }
        return;
    }

    for (let i = 0; i < targets.length; i++) {
        targets[i].innerHTML = "Recorder aktiv: " + recorder.events.length + " Eingaben";
    }
}

function refreshLiveStatusPanel() {
    updateConnectionSummary();
    updateRecorderSummary();
}

function renderExecutionPanel(status) {
    if (!window.NXBTApp || !window.NXBTApp.dom.macroCurrentRaw) {
        return;
    }

    let lineText = status.current_line ? String(status.current_line) : "-";
    let actionText = "-";
    if (status.debug_mode && status.paused) {
        actionText = "Debug pausiert";
    } else if (status.pausing) {
        actionText = "Pause angefordert";
    } else if (status.current_action === "button") {
        actionText = "Button";
    } else if (status.current_action === "wait") {
        actionText = "Pause";
    }

    let loopText = "-";
    if (status.loop_stack && status.loop_stack.length > 0) {
        let currentLoop = status.loop_stack[status.loop_stack.length - 1];
        loopText = currentLoop.loop_current + " / " + currentLoop.loop_total;
    }

    let totalSteps = status.steps_total || 0;
    let doneSteps = status.steps_done || 0;
    let repeatTotal = status.repeat_total || 1;
    let repeatCurrent = status.repeat_current || 1;
    let progress = totalSteps > 0 ? Math.min(100, Math.round((doneSteps / totalSteps) * 100)) : 0;

    window.NXBTApp.dom.macroCurrentLine.innerHTML = lineText;
    window.NXBTApp.dom.macroCurrentAction.innerHTML = actionText;
    window.NXBTApp.dom.macroCurrentButton.innerHTML = status.current_button || (status.current_action === "wait" ? "Warte" : "-");
    window.NXBTApp.dom.macroCurrentLoop.innerHTML = loopText;
    window.NXBTApp.dom.macroCurrentRaw.innerHTML = status.current_raw || "Keine aktive Ausfuehrung";

    let stepLabel = doneSteps + " / " + totalSteps + " Schritte";
    if (repeatTotal > 1) {
        stepLabel += "  |  Wiederholung " + repeatCurrent + " / " + repeatTotal;
    }
    window.NXBTApp.dom.macroProgressText.innerHTML = stepLabel;
    window.NXBTApp.dom.macroElapsed.innerHTML = formatSeconds(status.elapsed_seconds);
    window.NXBTApp.dom.macroRemaining.innerHTML = formatSeconds(status.estimated_remaining);
    window.NXBTApp.dom.macroProgressBar.style.width = progress + "%";
}
