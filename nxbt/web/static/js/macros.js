/**********************************************/
/* NXBT Makro-Verwaltung */
/**********************************************/

function _macroControllerPayload() {
    return { controller_index: window.NXBTApp.state.nxbtControllerIndex };
}

function _applyMacroStatus(status) {
    if (!status) {
        return;
    }
    window.NXBTApp.macroStatus = status;
    renderMacroStatus();
    syncMacroControls();
    renderExecutionPanel(status);
}

// --- Status-Rendering ---

function renderMacroStatus() {
    let status = window.NXBTApp.macroStatus || {};
    let dom = window.NXBTApp.dom;
    if (!dom) {
        return;
    }

    let targets = document.querySelectorAll('[data-role="macro-run-state"]');
    let label = "Kein Makro aktiv";
    let bannerVariant = null;
    let bannerText = null;

    if (status.running && status.stopping) {
        label = "Makro wird gestoppt...";
        bannerText = "Makro wird gestoppt...";
        bannerVariant = "warning";
        renderControllerBadge("Makro wird gestoppt...", "warning");
    } else if (status.running && status.debug_mode && status.paused) {
        label = "Debug pausiert" + (status.macro_name ? ": " + status.macro_name : "");
        bannerText = "Debug-Modus pausiert";
        bannerVariant = "warning";
        renderControllerBadge("Debug pausiert", "warning");
    } else if (status.running && status.debug_mode) {
        label = "Debug läuft" + (status.macro_name ? ": " + status.macro_name : "");
        bannerText = "Debug-Modus aktiv";
        bannerVariant = "warning";
        renderControllerBadge("Debug läuft", "warning");
    } else if (status.running) {
        let repeatSuffix = (status.repeat_total > 1)
            ? " (" + status.repeat_current + "/" + status.repeat_total + ")"
            : "";
        label = "Makro läuft" + repeatSuffix + (status.macro_name ? ": " + status.macro_name : "");
        bannerText = "Makro läuft" + repeatSuffix + "...";
        bannerVariant = "warning";
        renderControllerBadge("Makro läuft" + repeatSuffix, "warning");
    } else if (status.last_result === "finished") {
        label = "Makro beendet";
        bannerText = "Makro beendet";
        bannerVariant = "success";
    } else if (status.last_result === "stopped") {
        label = "Makro gestoppt";
        bannerText = "Makro gestoppt";
        bannerVariant = "success";
    } else if (status.last_result === "error" && status.last_error) {
        label = "Fehler: " + status.last_error;
        bannerText = "Fehler: " + status.last_error;
        bannerVariant = "error";
    }

    for (let i = 0; i < targets.length; i++) {
        targets[i].innerHTML = label;
    }

    if (bannerText) {
        setBannerStatus(bannerText, bannerVariant);
    }
}

function syncMacroControls() {
    let status = window.NXBTApp.macroStatus || {};
    let dom = window.NXBTApp.dom;
    if (!dom) {
        return;
    }

    let running = !!status.running;
    let stopping = !!status.stopping;
    let debugMode = !!status.debug_mode;
    let paused = !!status.paused;

    if (dom.macroRun) {
        dom.macroRun.disabled = running;
    }
    if (dom.macroStop) {
        dom.macroStop.disabled = !running || stopping;
    }
    if (dom.debugStart) {
        dom.debugStart.disabled = running;
    }

    let debugActive = running && debugMode;
    if (dom.debugNext) {
        dom.debugNext.disabled = !debugActive || !paused;
    }
    if (dom.debugContinue) {
        dom.debugContinue.disabled = !debugActive || !paused;
    }
    if (dom.debugPause) {
        dom.debugPause.disabled = !debugActive || paused;
    }
    if (dom.debugAbort) {
        dom.debugAbort.disabled = !debugActive;
    }
}

// --- Makro-Liste ---

function refreshMacroList(selectedValue) {
    fetch('/api/macros')
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
            let list = window.NXBTApp.dom.macroList;
            if (!list) {
                return;
            }
            let current = selectedValue !== undefined ? selectedValue : list.value;
            let filter = (window.NXBTApp.dom.macroSearch && window.NXBTApp.dom.macroSearch.value.trim().toLowerCase()) || "";
            list.innerHTML = '<option value="">Gespeicherte Makros</option>';
            let macros = (data.macros || []).filter(function(name) {
                return !filter || name.toLowerCase().indexOf(filter) !== -1;
            });
            for (let i = 0; i < macros.length; i++) {
                let opt = document.createElement('option');
                opt.value = macros[i];
                opt.innerHTML = macros[i];
                if (macros[i] === current) {
                    opt.selected = true;
                }
                list.appendChild(opt);
            }
        })
        .catch(function(err) {
            appendLog("Makroliste konnte nicht geladen werden: " + err, "error");
        });
}

// --- Makro-Operationen ---

function saveMacro() {
    let dom = window.NXBTApp.dom;
    let name = dom.macroName.value.trim();
    let content = dom.macroText.value;

    if (!name) {
        setBannerStatus("Bitte einen Makro-Namen eingeben", "error");
        return;
    }
    if (!content.trim()) {
        setBannerStatus("Makro-Inhalt darf nicht leer sein", "error");
        return;
    }

    fetch('/api/macros', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name, content: content })
    })
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
            if (data.error) {
                setBannerStatus("Fehler: " + data.error, "error");
                appendLog("Speicherfehler: " + data.error, "error");
                return;
            }
            setBannerStatus("Gespeichert: " + data.name, "success");
            appendLog("Makro gespeichert: " + data.name, "success");
            dom.macroName.value = data.name;
            refreshMacroList(data.name);
        })
        .catch(function(err) {
            setBannerStatus("Netzwerkfehler beim Speichern", "error");
            appendLog("Speicherfehler: " + err, "error");
        });
}

function loadMacro() {
    let dom = window.NXBTApp.dom;
    let name = dom.macroList.value || dom.macroName.value.trim();

    if (!name) {
        setBannerStatus("Bitte ein Makro aus der Liste wählen oder einen Namen eingeben", "warning");
        return;
    }

    fetch('/api/macros/' + encodeURIComponent(name))
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
            if (data.error) {
                setBannerStatus("Fehler: " + data.error, "error");
                appendLog("Ladefehler: " + data.error, "error");
                return;
            }
            dom.macroText.value = data.content;
            dom.macroName.value = data.name;
            setBannerStatus("Geladen: " + data.name, "success");
            appendLog("Makro geladen: " + data.name, "info");
        })
        .catch(function(err) {
            setBannerStatus("Netzwerkfehler beim Laden", "error");
            appendLog("Ladefehler: " + err, "error");
        });
}

function deleteMacro() {
    let dom = window.NXBTApp.dom;
    let name = dom.macroList.value || dom.macroName.value.trim();

    if (!name) {
        setBannerStatus("Bitte ein Makro aus der Liste wählen", "warning");
        return;
    }

    fetch('/api/macros/' + encodeURIComponent(name), { method: 'DELETE' })
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
            if (data.error) {
                setBannerStatus("Fehler: " + data.error, "error");
                appendLog("Löschfehler: " + data.error, "error");
                return;
            }
            setBannerStatus("Gelöscht: " + data.name, "success");
            appendLog("Makro gelöscht: " + data.name, "warning");
            dom.macroName.value = "";
            refreshMacroList("");
        })
        .catch(function(err) {
            setBannerStatus("Netzwerkfehler beim Löschen", "error");
            appendLog("Löschfehler: " + err, "error");
        });
}

function runMacro() {
    let dom = window.NXBTApp.dom;
    let content = dom.macroText.value;
    let name = dom.macroName.value.trim() || dom.macroList.value || null;
    let repeatEl = document.getElementById('macro-repeat');
    let repeat = repeatEl ? Math.max(1, Math.min(9999, parseInt(repeatEl.value, 10) || 1)) : 1;

    if (!content.trim()) {
        setBannerStatus("Makro-Inhalt ist leer", "error");
        return;
    }

    let payload = Object.assign({ content: content, name: name, repeat: repeat }, _macroControllerPayload());

    fetch('/api/macros/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    })
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
            if (data.error) {
                setBannerStatus("Fehler: " + data.error, "error");
                appendLog("Startfehler: " + data.error, "error");
                return;
            }
            setBannerStatus("Makro gestartet", "warning");
            appendLog("Makro gestartet: " + (data.macro_name || "unbenannt"), "warning");
        })
        .catch(function(err) {
            setBannerStatus("Netzwerkfehler beim Starten", "error");
            appendLog("Startfehler: " + err, "error");
        });
}

function stopRunningMacro() {
    fetch('/api/macros/stop', { method: 'POST' })
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
            if (data.error) {
                setBannerStatus("Fehler: " + data.error, "error");
                appendLog("Stoppfehler: " + data.error, "error");
                return;
            }
            setBannerStatus("Makro wird gestoppt...", "warning");
            appendLog("Makro-Stopp angefordert", "warning");
        })
        .catch(function(err) {
            setBannerStatus("Netzwerkfehler beim Stoppen", "error");
            appendLog("Stoppfehler: " + err, "error");
        });
}

// --- Debug-Modus ---

function startMacroDebug() {
    let dom = window.NXBTApp.dom;
    let content = dom.macroText.value;
    let name = dom.macroName.value.trim() || dom.macroList.value || null;

    if (!content.trim()) {
        setBannerStatus("Makro-Inhalt ist leer", "error");
        return;
    }

    let payload = Object.assign({ content: content, name: name }, _macroControllerPayload());
    window.NXBTApp.socket.emit('macro_debug_start', payload);
    setBannerStatus("Debug-Modus gestartet", "warning");
    appendLog("Debug gestartet", "warning");
}

function debugNextMacroStep() {
    window.NXBTApp.socket.emit('macro_debug_next');
}

function debugContinueMacro() {
    window.NXBTApp.socket.emit('macro_debug_continue');
}

function debugPauseMacro() {
    window.NXBTApp.socket.emit('macro_debug_pause');
}

function debugAbortMacro() {
    window.NXBTApp.socket.emit('macro_debug_abort');
}

// --- Status-Polling ---

function pollMacroStatus() {
    fetch('/api/macros/status')
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
            _applyMacroStatus(data);
        })
        .catch(function() {
            // Stille Fehler beim Polling — kein Banner, um kein Rauschen zu erzeugen
        });
}

// --- Socket.IO-Handler ---

function initializeMacroSocketHandlers() {
    let socket = window.NXBTApp.socket;
    if (!socket) {
        return;
    }

    socket.on('macro_status', function(status) {
        _applyMacroStatus(status);
    });

    socket.on('macro_step', function(payload) {
        let step = payload && payload.step;
        if (step && step.buttons && step.buttons.length > 0) {
            flashMacroButtons(step.buttons);
        }
        if (payload && payload.status) {
            _applyMacroStatus(payload.status);
        }
    });

    socket.on('macro_log', function(entry) {
        appendStructuredLog(entry, true);
    });

    socket.on('macro_logs', function(data) {
        renderLogHistory(data && data.logs ? data.logs : []);
    });

    socket.on('macro_finished', function(status) {
        _applyMacroStatus(status);
        setBannerStatus("Makro beendet", "success");
        appendLog("Makro beendet", "success");
        updateConnectionSummary();
    });

    socket.on('macro_stopped', function(status) {
        _applyMacroStatus(status);
        setBannerStatus("Makro gestoppt", "success");
        appendLog("Makro gestoppt", "info");
        updateConnectionSummary();
    });

    socket.on('macro_error', function(status) {
        _applyMacroStatus(status);
        let err = (status && status.last_error) || "Unbekannter Fehler";
        displayError(err);
        updateConnectionSummary();
    });

    socket.on('macro_debug_ready', function(status) {
        _applyMacroStatus(status);
        setBannerStatus("Debug bereit – Schritt für Schritt fortfahren", "warning");
        appendLog("Debug bereit", "warning");
    });
}
