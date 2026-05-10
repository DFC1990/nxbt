/* NXBT Mobile Control - Full Featured App
   Macro Manager + Virtual Gamepad + WiFi Settings */

const API = {
  macros: '/api/macros',
  macroRun: '/api/macros/run',
  macroStop: '/api/macros/stop',
  macroStatus: '/api/macros/status',
  macroLogs: '/api/macros/logs',
  wifiStatus: '/api/wifi/status',
  wifiNetworks: '/api/wifi/networks',
  wifiConnect: '/api/wifi/connect',
  hotspotStatus: '/api/wifi/hotspot/status',
  hotspotToggle: '/api/wifi/hotspot/toggle',
  hotspotOnly: '/api/wifi/hotspot-only',
};

// State
let state = {
  macroRunning: false,
  macroName: null,
  macros: [],
  currentMacroContent: '',
  currentMacroName: '',
  gamepadActive: false,
  controllerState: { x: 0, y: 0 },
  logLines: [],
  lastLogIndex: 0,
  wifiConnecting: false,
  wifiConnectController: null,
};

// Current gamepad input state (for SocketIO button/stick events)
let currentInput = createEmptyPacket();

function createEmptyPacket() {
  return {
    Y: false, X: false, B: false, A: false,
    DPAD_UP: false, DPAD_LEFT: false, DPAD_RIGHT: false, DPAD_DOWN: false,
    L: false, ZL: false, R: false, ZR: false,
    PLUS: false, MINUS: false, HOME: false, CAPTURE: false,
    L_STICK: { X_VALUE: 0, Y_VALUE: 0, PRESSED: false },
    R_STICK: { X_VALUE: 0, Y_VALUE: 0, PRESSED: false },
  };
}

// Refs
let refs = {};

// SocketIO
let socket = null;
let controllerIndex = null;

// ============================================================================
// Init
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
  cacheElements();
  bindTabNavigation();
  bindMacroEditor();
  bindGamepad();
  bindWiFi();
  initSocket();
  loadMacroList();
  updateWiFiStatus();
  updateHotspotStatus();
  startPolling();
});

function cacheElements() {
  refs = {
    // Tabs
    tabButtons: Array.from(document.querySelectorAll('.tab-button')),
    tabContents: Array.from(document.querySelectorAll('.tab-content')),

    // Status
    statusIndicator: document.getElementById('m-status-indicator'),
    runningBanner: document.getElementById('m-running-banner'),
    runningName: document.getElementById('m-running-name'),
    stopBtn: document.getElementById('m-stop-btn'),
    execStatus: document.getElementById('m-exec-status'),
    execStep: document.getElementById('m-exec-step'),
    execProgress: document.getElementById('m-exec-progress'),
    progressFill: document.querySelector('.progress-fill'),

    // Macro Editor
    macroName: document.getElementById('m-macro-name'),
    macroContent: document.getElementById('m-macro-content'),
    newMacroBtn: document.getElementById('m-new-macro-btn'),
    saveMacroBtn: document.getElementById('m-save-macro-btn'),
    clearMacroBtn: document.getElementById('m-clear-macro-btn'),
    editorMessage: document.getElementById('m-editor-message'),

    // Macro List
    macroList: document.getElementById('m-macro-list'),
    macroEmpty: document.getElementById('m-macro-empty'),

    // Logs
    logViewer: document.getElementById('m-log-viewer'),
    clearLogsBtn: document.getElementById('m-clear-logs-btn'),

    // Macro repeat
    repeatCount: document.getElementById('m-repeat-count'),

    // Gamepad
    controllerStatus: document.getElementById('m-controller-status'),
    controllerType: document.getElementById('m-controller-type'),
    connectControllerBtn: document.getElementById('m-connect-controller-btn'),
    disconnectControllerBtn: document.getElementById('m-disconnect-controller-btn'),
    connectControllerArea: document.getElementById('m-connect-controller-area'),
    disconnectControllerArea: document.getElementById('m-disconnect-controller-area'),
    stickLeft: document.getElementById('m-stick-left'),
    stickRight: document.getElementById('m-stick-right'),
    stickLeftX: document.getElementById('m-stick-left-x'),
    stickLeftY: document.getElementById('m-stick-left-y'),
    stickRightX: document.getElementById('m-stick-right-x'),
    stickRightY: document.getElementById('m-stick-right-y'),

    // WiFi
    networkMode: document.getElementById('m-network-mode'),
    wifiSsid: document.getElementById('m-wifi-ssid'),
    wifiIp: document.getElementById('m-wifi-ip'),
    wifiSignal: document.getElementById('m-wifi-signal'),
    hotspotAddress: document.getElementById('m-hotspot-address'),
    hotspotStatus: document.getElementById('m-hotspot-status'),
    hotspotToggleBtn: document.getElementById('m-hotspot-toggle-btn'),
    hotspotOnlyBtn: document.getElementById('m-hotspot-only-btn'),
    networkMessage: document.getElementById('m-network-message'),
    scanBtn: document.getElementById('m-scan-btn'),
    scanLoading: document.getElementById('m-scan-loading'),
    networkList: document.getElementById('m-network-list'),
    connectForm: document.getElementById('m-connect-form'),
    connectStatus: document.getElementById('m-connect-status'),
    connectCancelBtn: document.getElementById('m-connect-cancel-btn'),
    connectRetryBtn: document.getElementById('m-connect-retry-btn'),
    ssidInput: document.getElementById('m-ssid-input'),
    pwInput: document.getElementById('m-pw-input'),
    connectError: document.getElementById('m-connect-error'),
  };
}

// ============================================================================
// Tab Navigation
// ============================================================================

function bindTabNavigation() {
  refs.tabButtons.forEach((btn, idx) => {
    btn.addEventListener('click', () => switchTab(idx));
  });
}

function switchTab(index) {
  refs.tabButtons.forEach((btn, i) => {
    btn.classList.toggle('active', i === index);
  });

  refs.tabContents.forEach((content, i) => {
    if (i === index) {
      content.classList.remove('hidden');
      content.classList.add('active');
    } else {
      content.classList.remove('active');
    }
  });
}

// ============================================================================
// Macro Editor & Management
// ============================================================================

function bindMacroEditor() {
  refs.newMacroBtn.addEventListener('click', newMacro);
  refs.saveMacroBtn.addEventListener('click', saveMacro);
  refs.clearMacroBtn.addEventListener('click', clearMacro);
  refs.clearLogsBtn.addEventListener('click', clearLogs);
}

function newMacro() {
  refs.macroName.value = '';
  refs.macroContent.value = '';
  refs.macroName.focus();
  showEditorMessage('Neues Makro erstellt', 'info');
}

function clearMacro() {
  refs.macroName.value = '';
  refs.macroContent.value = '';
  showEditorMessage('', '');
}

function saveMacro() {
  const name = refs.macroName.value.trim();
  const content = refs.macroContent.value.trim();

  if (!name) {
    showEditorMessage('Gib einen Namen für das Makro ein', 'error');
    refs.macroName.focus();
    return;
  }

  if (!content) {
    showEditorMessage('Gib Makro-Code ein', 'error');
    refs.macroContent.focus();
    return;
  }

  refs.saveMacroBtn.disabled = true;
  showEditorMessage('Speichern...', 'info');

  fetch(API.macros, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, content: content }),
  })
    .then(r => r.json())
    .then(data => {
      if (!data.error) {
        showEditorMessage('✓ Gespeichert!', 'success');
        loadMacroList();
        setTimeout(() => clearMacro(), 1000);
      } else {
        showEditorMessage('Fehler: ' + (data.error || 'Unbekannter Fehler'), 'error');
      }
    })
    .catch(e => showEditorMessage('Fehler: ' + e.message, 'error'))
    .finally(() => {
      refs.saveMacroBtn.disabled = false;
    });
}

function showEditorMessage(msg, type) {
  refs.editorMessage.textContent = msg;
  refs.editorMessage.className = 'message' + (type ? ' ' + type : '');
  if (msg) {
    refs.editorMessage.classList.remove('hidden');
  } else {
    refs.editorMessage.classList.add('hidden');
  }
}

function loadMacroList() {
  fetch(API.macros)
    .then(r => r.json())
    .then(data => {
      state.macros = (data && data.macros) ? data.macros : [];
      renderMacroList();
    })
    .catch(e => {
      console.error('Failed to load macros:', e);
      refs.macroEmpty.classList.remove('hidden');
    });
}

function renderMacroList() {
  refs.macroList.innerHTML = '';

  if (!state.macros || state.macros.length === 0) {
    refs.macroEmpty.classList.remove('hidden');
    return;
  }

  refs.macroEmpty.classList.add('hidden');

  state.macros.forEach(name => {
    const card = document.createElement('div');
    card.className = 'macro-card';

    const displayName = name.endsWith('.txt') ? name.slice(0, -4) : name;

    const nameEl = document.createElement('span');
    nameEl.className = 'macro-card-name';
    nameEl.textContent = displayName;
    nameEl.addEventListener('click', () => loadMacroForEdit(name));

    const actions = document.createElement('div');
    actions.className = 'macro-card-actions';

    const runBtn = document.createElement('button');
    runBtn.className = 'btn btn-primary btn-sm';
    runBtn.textContent = '▶';
    runBtn.addEventListener('click', () => runMacro(name));

    const editBtn = document.createElement('button');
    editBtn.className = 'btn btn-secondary btn-sm';
    editBtn.textContent = '✎';
    editBtn.addEventListener('click', () => loadMacroForEdit(name));

    const delBtn = document.createElement('button');
    delBtn.className = 'btn btn-danger btn-sm';
    delBtn.textContent = '✕';
    delBtn.addEventListener('click', () => deleteMacro(name));

    actions.appendChild(runBtn);
    actions.appendChild(editBtn);
    actions.appendChild(delBtn);

    card.appendChild(nameEl);
    card.appendChild(actions);
    refs.macroList.appendChild(card);
  });
}

function loadMacroForEdit(name) {
  fetch(`${API.macros}/${name}`)
    .then(r => r.json())
    .then(data => {
      if (data.content !== undefined) {
        refs.macroName.value = name.endsWith('.txt') ? name.slice(0, -4) : name;
        refs.macroContent.value = data.content;
        switchTab(0);  // Switch to macros tab
        refs.macroContent.focus();
      }
    })
    .catch(e => alert('Fehler beim Laden: ' + e.message));
}

function runMacro(name) {
  const repeat = Math.max(1, Math.min(9999, parseInt(refs.repeatCount?.value || '1', 10) || 1));
  fetch(API.macroRun, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, repeat: repeat }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok || data.running) {
        state.macroRunning = true;
        state.macroName = name;
        updateBanner();
      } else {
        alert('Fehler: ' + (data.error || 'Unbekannter Fehler'));
      }
    })
    .catch(e => alert('Verbindungsfehler: ' + e.message));
}

function stopMacro() {
  fetch(API.macroStop, { method: 'POST' })
    .then(r => r.json())
    .then(() => {
      state.macroRunning = false;
      state.macroName = null;
      updateBanner();
    })
    .catch(e => alert('Fehler beim Stoppen: ' + e.message));
}

function deleteMacro(name) {
  if (!confirm(`Makro "${name}" wirklich löschen?`)) return;

  fetch(`${API.macros}/${name}`, { method: 'DELETE' })
    .then(r => r.json())
    .then(data => {
      if (!data.error) {
        loadMacroList();
        const editName = refs.macroName.value.trim();
        const baseName = name.endsWith('.txt') ? name.slice(0, -4) : name;
        if (editName === baseName || editName === name) {
          clearMacro();
        }
      } else {
        alert('Fehler: ' + (data.error || 'Unbekannter Fehler'));
      }
    })
    .catch(e => alert('Fehler: ' + e.message));
}

function updateBanner() {
  if (state.macroRunning) {
    refs.runningBanner.classList.remove('hidden');
    refs.runningName.textContent = state.macroName || 'Makro';
    refs.statusIndicator.className = 'status-dot running';
    refs.stopBtn.addEventListener('click', stopMacro);
  } else {
    refs.runningBanner.classList.add('hidden');
    refs.statusIndicator.className = 'status-dot idle';
  }
}

function updateMacroStatus() {
  fetch(API.macroStatus)
    .then(r => r.json())
    .then(data => {
      const running = data.running || false;
      const name = data.macro_name;

      if (running !== state.macroRunning || name !== state.macroName) {
        state.macroRunning = running;
        state.macroName = name;
        updateBanner();
      }

      // Update status display
      if (running) {
        const line = data.current_line || '-';
        const step = data.steps_done || 0;
        const total = data.steps_total || 0;
        refs.execStatus.textContent = 'Läuft...';
        refs.execStep.textContent = `${step}/${total}`;

        if (total > 0) {
          refs.execProgress.classList.remove('hidden');
          const percent = (step / total) * 100;
          refs.progressFill.style.width = percent + '%';
        }
      } else {
        refs.execStatus.textContent = 'Bereit';
        refs.execStep.textContent = '-';
        refs.execProgress.classList.add('hidden');
      }

      // Update logs
      updateMacroLogs(data.logs || []);
    })
    .catch(e => console.error('Status update failed:', e));
}

function updateMacroLogs(logs) {
  if (!logs || logs.length === 0) return;

  const newLogs = logs.slice(state.lastLogIndex);
  state.lastLogIndex = logs.length;

  newLogs.forEach(log => {
    const entry = document.createElement('div');
    entry.className = 'log-entry log-' + (log.level || 'info');

    const time = new Date(log.timestamp).toLocaleTimeString();
    const message = log.message || JSON.stringify(log);

    entry.innerHTML = `<span class="log-time">${time}</span>${escapeHtml(message)}`;
    refs.logViewer.appendChild(entry);
  });

  // Auto-scroll to bottom
  refs.logViewer.scrollTop = refs.logViewer.scrollHeight;
}

function clearLogs() {
  refs.logViewer.innerHTML = '<p class="muted small">Logs gelöscht</p>';
  state.lastLogIndex = 0;
}

// ============================================================================
// Virtual Gamepad
// ============================================================================

function bindGamepad() {
  // D-Pad
  document.querySelectorAll('[data-button]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => buttonPressed(e.target.dataset.button));
    btn.addEventListener('mouseup', (e) => buttonReleased(e.target.dataset.button));
    btn.addEventListener('touchstart', (e) => buttonPressed(e.target.dataset.button));
    btn.addEventListener('touchend', (e) => buttonReleased(e.target.dataset.button));
  });

  // Virtual Sticks
  if (refs.stickLeft) {
    bindVirtualStick(refs.stickLeft, 'L_STICK', refs.stickLeftX, refs.stickLeftY);
  }
  if (refs.stickRight) {
    bindVirtualStick(refs.stickRight, 'R_STICK', refs.stickRightX, refs.stickRightY);
  }

  // Keyboard support
  document.addEventListener('keydown', handleKeyDown);
  document.addEventListener('keyup', handleKeyUp);
}

const keyMap = {
  'ArrowUp': 'DPAD_UP',
  'ArrowDown': 'DPAD_DOWN',
  'ArrowLeft': 'DPAD_LEFT',
  'ArrowRight': 'DPAD_RIGHT',
  'w': 'DPAD_UP',
  's': 'DPAD_DOWN',
  'a': 'DPAD_LEFT',
  'd': 'DPAD_RIGHT',
  'z': 'Y',
  'x': 'X',
  'c': 'A',
  'v': 'B',
};

function handleKeyDown(e) {
  const button = keyMap[e.key.toLowerCase()];
  if (button) {
    e.preventDefault();
    buttonPressed(button);
  }
}

function handleKeyUp(e) {
  const button = keyMap[e.key.toLowerCase()];
  if (button) {
    e.preventDefault();
    buttonReleased(button);
  }
}

function buttonPressed(button) {
  const btn = document.querySelector(`[data-button="${button}"]`);
  if (btn) btn.style.opacity = '0.7';

  if (!socket || controllerIndex === null) return;
  if (button === 'L_STICK_PRESS') {
    currentInput.L_STICK.PRESSED = true;
  } else if (button === 'R_STICK_PRESS') {
    currentInput.R_STICK.PRESSED = true;
  } else {
    currentInput[button] = true;
  }
  socket.emit('input', JSON.stringify([controllerIndex, currentInput]));
}

function buttonReleased(button) {
  const btn = document.querySelector(`[data-button="${button}"]`);
  if (btn) btn.style.opacity = '1';

  if (!socket || controllerIndex === null) return;
  if (button === 'L_STICK_PRESS') {
    currentInput.L_STICK.PRESSED = false;
  } else if (button === 'R_STICK_PRESS') {
    currentInput.R_STICK.PRESSED = false;
  } else {
    currentInput[button] = false;
  }
  socket.emit('input', JSON.stringify([controllerIndex, currentInput]));
}

function bindVirtualStick(element, stickName, xDisplay, yDisplay) {
  let isActive = false;
  let rect = element.getBoundingClientRect();

  function updateStick(e) {
    if (!isActive) return;

    const touch = e.touches ? e.touches[0] : e;
    const x = touch.clientX - rect.left - rect.width / 2;
    const y = touch.clientY - rect.top - rect.height / 2;
    const radius = rect.width / 2 - 20;

    let px = Math.round((x / radius) * 100);
    let py = Math.round((y / radius) * 100);

    // Clamp to circle
    const distance = Math.sqrt(px * px + py * py);
    if (distance > 100) {
      px = Math.round((px / distance) * 100);
      py = Math.round((py / distance) * 100);
    }

    // Clamp to ±100
    px = Math.max(-100, Math.min(100, px));
    py = Math.max(-100, Math.min(100, py));

    // Update display
    if (xDisplay) xDisplay.textContent = px;
    if (yDisplay) yDisplay.textContent = py;

    // Update knob position
    const angle = Math.atan2(py, px);
    const dist = Math.min(distance, radius);
    const dx = Math.cos(angle) * dist;
    const dy = Math.sin(angle) * dist;
    element.style.setProperty('--knob-x', dx + 'px');
    element.style.setProperty('--knob-y', dy + 'px');

    // Send stick input via SocketIO
    if (socket && controllerIndex !== null) {
      currentInput[stickName] = { X_VALUE: px, Y_VALUE: -py, PRESSED: currentInput[stickName].PRESSED };
      socket.emit('input', JSON.stringify([controllerIndex, currentInput]));
    }
  }

  element.addEventListener('mousedown', (e) => {
    isActive = true;
    rect = element.getBoundingClientRect();
    updateStick(e);
  });

  element.addEventListener('touchstart', (e) => {
    isActive = true;
    rect = element.getBoundingClientRect();
    updateStick(e);
  });

  document.addEventListener('mousemove', updateStick);
  document.addEventListener('touchmove', updateStick);

  document.addEventListener('mouseup', () => { isActive = false; });
  document.addEventListener('touchend', () => { isActive = false; });
}

// ============================================================================
// WiFi Management
// ============================================================================

function bindWiFi() {
  refs.hotspotToggleBtn.addEventListener('click', toggleHotspot);
  refs.hotspotOnlyBtn.addEventListener('click', useHotspotOnly);
  refs.scanBtn.addEventListener('click', scanNetworks);
  refs.connectForm.addEventListener('submit', handleConnectSubmit);
  refs.connectCancelBtn.addEventListener('click', cancelConnect);
  refs.connectRetryBtn.addEventListener('click', () => {
    refs.connectRetryBtn.classList.add('hidden');
    refs.connectError.classList.add('hidden');
  });
}

function updateWiFiStatus() {
  fetch(API.wifiStatus)
    .then(r => r.json())
    .then(data => {
      refs.networkMode.textContent = data.mode === 'hotspot_only'
        ? 'Hotspot-Betrieb'
        : 'WLAN-Betrieb';
      refs.wifiSsid.textContent = data.ssid && data.connected
        ? data.ssid
        : (data.connected ? '(Verbunden)' : 'Nicht verbunden');
      refs.wifiIp.textContent = data.ip || '---';
      refs.wifiSignal.textContent = data.signal !== null && data.signal !== undefined ? data.signal + ' dBm' : '---';
      refs.hotspotAddress.textContent = data.hotspot_active
        ? `${data.hotspot_ssid || 'NXBT-CONTROL'} · ${data.hotspot_ip || '192.168.4.1'}:8000`
        : 'Inaktiv';
    })
    .catch(e => console.error('WiFi status fetch failed:', e));
}

function updateHotspotStatus() {
  fetch(API.hotspotStatus)
    .then(r => r.json())
    .then(data => {
      refs.hotspotStatus.textContent = data.active ? 'Aktiv' : 'Inaktiv';
      refs.hotspotToggleBtn.textContent = data.active ? 'Hotspot ausschalten' : 'Hotspot einschalten';
    })
    .catch(e => console.error('Hotspot status fetch failed:', e));
}

function toggleHotspot() {
  refs.hotspotToggleBtn.disabled = true;
  fetch(API.hotspotToggle, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      if (!data.ok && data.error) {
        showNetworkMessage(data.error, 'error');
      }
      updateHotspotStatus();
      updateWiFiStatus();
    })
    .catch(e => showNetworkMessage('Fehler: ' + e.message, 'error'))
    .finally(() => {
      refs.hotspotToggleBtn.disabled = false;
    });
}

function useHotspotOnly() {
  refs.hotspotOnlyBtn.disabled = true;
  showNetworkMessage('Hotspot-Betrieb wird aktiviert...', 'info');

  fetch(API.hotspotOnly, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        showNetworkMessage('Hotspot ist aktiv. NXBT bleibt lokal unter 192.168.4.1:8000 erreichbar.', 'success');
      } else {
        showNetworkMessage(data.error || 'Hotspot konnte nicht aktiviert werden', 'error');
      }
      updateHotspotStatus();
      updateWiFiStatus();
    })
    .catch(e => showNetworkMessage('Fehler: ' + e.message, 'error'))
    .finally(() => {
      refs.hotspotOnlyBtn.disabled = false;
    });
}

function scanNetworks() {
  refs.scanLoading.textContent = '';
  refs.scanLoading.innerHTML = '<p>Suche läuft...</p>';
  refs.scanLoading.classList.remove('hidden');
  refs.networkList.classList.add('hidden');
  refs.scanBtn.disabled = true;

  fetch(API.wifiNetworks)
    .then(r => r.json())
    .then(data => {
      if (data.networks && data.networks.length > 0) {
        renderNetworkList(data.networks);
        refs.scanLoading.classList.add('hidden');
        refs.networkList.classList.remove('hidden');
      } else {
        refs.scanLoading.textContent = 'Keine Netzwerke gefunden';
      }
    })
    .catch(e => {
      refs.scanLoading.textContent = 'Fehler beim Scan';
      console.error('Scan failed:', e);
    })
    .finally(() => {
      refs.scanBtn.disabled = false;
    });
}

function renderNetworkList(networks) {
  refs.networkList.innerHTML = '';

  networks.forEach(net => {
    const item = document.createElement('div');
    item.className = 'network-item';

    const strength = Math.min(100, Math.max(0, net.signal + 100));
    const bars = Math.ceil(strength / 25);

    let signalHtml = '';
    for (let i = 0; i < 4; i++) {
      signalHtml += `<div class="signal-bar" style="height: ${8 + i * 2}px; opacity: ${i < bars ? '1' : '0.3'}"></div>`;
    }

    const lock = net.secured ? 'gesichert' : 'offen';
    const saved = net.saved ? ' · gespeichert' : '';
    const active = net.active ? ' · aktiv' : '';

    item.innerHTML = `
      <div class="network-info">
        <div class="network-name">${escapeHtml(net.ssid)}</div>
        <div class="network-signal">${net.signal} dBm <span class="signal-bars">${signalHtml}</span> ${lock}${saved}${active}</div>
      </div>
    `;

    item.addEventListener('click', () => {
      refs.ssidInput.value = net.ssid;
      refs.pwInput.value = '';
      refs.networkList.classList.add('hidden');
      refs.connectForm.classList.remove('hidden');
      if (net.secured) {
        refs.pwInput.focus();
      }
    });

    refs.networkList.appendChild(item);
  });
}

function handleConnectSubmit(e) {
  e.preventDefault();

  const ssid = refs.ssidInput.value.trim();
  const password = refs.pwInput.value;

  if (!ssid) {
    showConnectError('SSID erforderlich');
    return;
  }

  state.wifiConnecting = true;
  state.wifiConnectController = new AbortController();
  const connectTimeout = setTimeout(() => {
    if (state.wifiConnecting) {
      state.wifiConnectController.abort();
    }
  }, 60000); // 60 second timeout for WiFi connection

  refs.connectForm.classList.add('hidden');
  refs.connectStatus.classList.remove('hidden');
  refs.connectError.classList.add('hidden');

  fetch(API.wifiConnect, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ssid: ssid, password: password }),
    signal: state.wifiConnectController.signal,
  })
    .then(r => r.json())
    .then(data => {
      if (!state.wifiConnecting) return; // Cancelled

      if (data.ok) {
        refs.connectForm.reset();
        refs.connectStatus.classList.add('hidden');
        refs.networkList.classList.add('hidden');
        refs.connectRetryBtn.classList.add('hidden');
        showConnectError('', false);

        setTimeout(() => {
          updateWiFiStatus();
          updateHotspotStatus();
        }, 2000);

        showNetworkMessage(`Mit ${data.ssid || ssid} verbunden. Gespeichert fuer den naechsten Start.`, 'success');
      } else {
        showConnectError(data.error || 'Verbindung fehlgeschlagen');
        refs.connectStatus.classList.add('hidden');
        refs.connectForm.classList.remove('hidden');
        refs.connectRetryBtn.classList.remove('hidden');
      }
    })
    .catch(e => {
      if (e.name === 'AbortError') {
        refs.connectStatus.classList.add('hidden');
        refs.connectForm.classList.remove('hidden');
        showConnectError('Verbindung abgebrochen');
        refs.connectRetryBtn.classList.remove('hidden');
      } else {
        showConnectError('Fehler: ' + e.message);
        refs.connectStatus.classList.add('hidden');
        refs.connectForm.classList.remove('hidden');
        refs.connectRetryBtn.classList.remove('hidden');
      }
    })
    .finally(() => {
      clearTimeout(connectTimeout);
      state.wifiConnecting = false;
    });
}

function cancelConnect() {
  if (state.wifiConnectController) {
    state.wifiConnectController.abort();
  }
}

function showConnectError(msg, show = true) {
  refs.connectError.textContent = msg;
  if (show) {
    refs.connectError.classList.remove('hidden');
  } else {
    refs.connectError.classList.add('hidden');
  }
}

function showNetworkMessage(msg, type) {
  refs.networkMessage.textContent = msg;
  refs.networkMessage.className = 'message' + (type ? ' ' + type : '');
  if (msg) {
    refs.networkMessage.classList.remove('hidden');
  } else {
    refs.networkMessage.classList.add('hidden');
  }
}

// ============================================================================
// Polling
// ============================================================================

function startPolling() {
  setInterval(() => {
    updateMacroStatus();
    updateWiFiStatus();
    updateHotspotStatus();
    if (controllerIndex !== null) {
      socket.emit('state');
    }
  }, 2000);
}

// ============================================================================
// Controller Connection (SocketIO)
// ============================================================================

function initSocket() {
  socket = io();

  socket.on('connect', function() {
    updateControllerUI('disconnected');
  });

  socket.on('disconnect', function() {
    updateControllerUI('disconnected');
    controllerIndex = null;
    currentInput = createEmptyPacket();
  });

  socket.on('create_pro_controller', function(index) {
    controllerIndex = index;
    updateControllerUI('connecting');
  });

  socket.on('state_update', function(stateData) {
    if (controllerIndex === null) return;
    const cs = stateData[controllerIndex];
    if (!cs) return;
    updateControllerUI(cs.state);
  });

  socket.on('error', function(msg) {
    updateControllerUI('error');
    const entry = document.createElement('div');
    entry.className = 'log-entry log-error';
    entry.textContent = 'ERROR: ' + msg;
    refs.logViewer.appendChild(entry);
    refs.logViewer.scrollTop = refs.logViewer.scrollHeight;
  });

  refs.connectControllerBtn.addEventListener('click', function() {
    refs.connectControllerBtn.disabled = true;
    refs.connectControllerBtn.textContent = '⏳ Verbinde...';
    socket.emit('web_create_pro_controller');
  });

  refs.disconnectControllerBtn.addEventListener('click', function() {
    if (controllerIndex !== null) {
      socket.emit('shutdown', controllerIndex);
      controllerIndex = null;
    }
    updateControllerUI('disconnected');
  });
}

function updateControllerUI(status) {
  const statusEl = refs.controllerStatus;
  const connectArea = refs.connectControllerArea;
  const disconnectArea = refs.disconnectControllerArea;
  const btn = refs.connectControllerBtn;

  switch (status) {
    case 'connecting':
      statusEl.textContent = '⏳ Verbindet...';
      statusEl.className = 'value muted';
      connectArea.classList.add('hidden');
      disconnectArea.classList.remove('hidden');
      break;
    case 'connected':
      statusEl.textContent = '✅ Verbunden';
      statusEl.className = 'value';
      connectArea.classList.add('hidden');
      disconnectArea.classList.remove('hidden');
      break;
    case 'crashed':
      statusEl.textContent = '❌ Fehler';
      statusEl.className = 'value';
      connectArea.classList.remove('hidden');
      disconnectArea.classList.add('hidden');
      btn.disabled = false;
      btn.textContent = '🎮 Erneut verbinden';
      break;
    default:
      statusEl.textContent = 'Getrennt';
      statusEl.className = 'value muted';
      connectArea.classList.remove('hidden');
      disconnectArea.classList.add('hidden');
      btn.disabled = false;
      btn.textContent = '🎮 Mit Switch verbinden';
  }
}

// ============================================================================
// Utilities
// ============================================================================

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
