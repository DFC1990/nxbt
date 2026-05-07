/* NXBT Mobile UI - Vanilla JavaScript
   No frameworks, no imports. Runs on first script execution. */

const API = {
  macros: '/api/macros',
  macroRun: '/api/macros/run',
  macroStop: '/api/macros/stop',
  macroStatus: '/api/macros/status',
  wifiStatus: '/api/wifi/status',
  wifiNetworks: '/api/wifi/networks',
  wifiConnect: '/api/wifi/connect',
  hotspotStatus: '/api/wifi/hotspot/status',
  hotspotToggle: '/api/wifi/hotspot/toggle',
};

// State
let state = {
  macroRunning: false,
  macroName: null,
  hotspotActive: false,
  macros: [],
  networks: [],
  scanning: false,
};

// Refs
let refs = {};

// ============================================================================
// Init
// ============================================================================

document.addEventListener('DOMContentLoaded', function() {
  cacheElements();
  loadMacroList();
  loadWifiStatus();
  loadHotspotStatus();
  bindEvents();
  startPolling();
});

function cacheElements() {
  refs = {
    // Status
    statusIndicator: document.getElementById('m-status-indicator'),
    runningBanner: document.getElementById('m-running-banner'),
    runningName: document.getElementById('m-running-name'),
    stopBtn: document.getElementById('m-stop-btn'),
    // Macros
    macroList: document.getElementById('m-macro-list'),
    macroEmpty: document.getElementById('m-macro-empty'),
    // WiFi
    wifiSsid: document.getElementById('m-wifi-ssid'),
    wifiIp: document.getElementById('m-wifi-ip'),
    wifiSignal: document.getElementById('m-wifi-signal'),
    // Hotspot
    hotspotStatus: document.getElementById('m-hotspot-status'),
    hotspotToggleBtn: document.getElementById('m-hotspot-toggle-btn'),
    hotspotHint: document.getElementById('m-hotspot-hint'),
    // WiFi Connect
    scanBtn: document.getElementById('m-scan-btn'),
    scanLoading: document.getElementById('m-scan-loading'),
    networkList: document.getElementById('m-network-list'),
    connectForm: document.getElementById('m-connect-form'),
    ssidInput: document.getElementById('m-ssid-input'),
    pwInput: document.getElementById('m-pw-input'),
    connectError: document.getElementById('m-connect-error'),
  };
}

function bindEvents() {
  refs.stopBtn.addEventListener('click', stopMacro);
  refs.hotspotToggleBtn.addEventListener('click', toggleHotspot);
  refs.scanBtn.addEventListener('click', scanNetworks);
  refs.connectForm.addEventListener('submit', handleConnectSubmit);
}

function startPolling() {
  // Poll every 2 seconds
  setInterval(() => {
    updateMacroStatus();
    updateWifiStatus();
  }, 2000);
}

// ============================================================================
// Macro Functions
// ============================================================================

function loadMacroList() {
  fetch(API.macros)
    .then(r => r.json())
    .then(data => {
      state.macros = data || [];
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

  state.macros.forEach(macroName => {
    const card = document.createElement('div');
    card.className = 'macro-card';
    card.innerHTML = `
      <span class="macro-card-name">${escapeHtml(macroName)}</span>
      <button class="btn btn-primary" data-macro-name="${escapeHtml(macroName)}">▶</button>
    `;
    card.querySelector('.btn').addEventListener('click', () => runMacro(macroName));
    refs.macroList.appendChild(card);
  });
}

function runMacro(name) {
  fetch(API.macroRun, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: name, repeat: 1 }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok || data.running) {
        state.macroRunning = true;
        state.macroName = name;
        updateBanner();
      } else {
        alert('Fehler beim Starten des Makros: ' + (data.error || 'Unbekannter Fehler'));
      }
    })
    .catch(e => alert('Verbindungsfehler: ' + e.message));
}

function stopMacro() {
  fetch(API.macroStop, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      state.macroRunning = false;
      state.macroName = null;
      updateBanner();
    })
    .catch(e => alert('Fehler beim Stoppen: ' + e.message));
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
    })
    .catch(e => console.error('Status update failed:', e));
}

function updateBanner() {
  if (state.macroRunning) {
    refs.runningBanner.classList.remove('hidden');
    refs.runningName.textContent = state.macroName || 'Makro';
    refs.statusIndicator.className = 'status-dot running';
  } else {
    refs.runningBanner.classList.add('hidden');
    refs.statusIndicator.className = 'status-dot idle';
  }
}

// ============================================================================
// WiFi Functions
// ============================================================================

function loadWifiStatus() {
  updateWifiStatus();
}

function updateWifiStatus() {
  fetch(API.wifiStatus)
    .then(r => r.json())
    .then(data => {
      refs.wifiSsid.textContent = data.ssid && data.connected
        ? escapeHtml(data.ssid)
        : (data.connected ? '(Verbunden)' : 'Nicht verbunden');

      refs.wifiIp.textContent = data.ip || '---';

      if (data.signal !== null && data.signal !== undefined) {
        refs.wifiSignal.textContent = data.signal + ' dBm';
      } else {
        refs.wifiSignal.textContent = '---';
      }
    })
    .catch(e => console.error('WiFi status fetch failed:', e));
}

function loadHotspotStatus() {
  updateHotspotStatus();
}

function updateHotspotStatus() {
  fetch(API.hotspotStatus)
    .then(r => r.json())
    .then(data => {
      state.hotspotActive = data.active || false;
      refs.hotspotStatus.textContent = state.hotspotActive ? 'Aktiv' : 'Inaktiv';
      refs.hotspotToggleBtn.textContent = state.hotspotActive ? 'Hotspot ausschalten' : 'Hotspot einschalten';
    })
    .catch(e => console.error('Hotspot status fetch failed:', e));
}

function toggleHotspot() {
  refs.hotspotToggleBtn.disabled = true;
  fetch(API.hotspotToggle, { method: 'POST' })
    .then(r => r.json())
    .then(data => {
      updateHotspotStatus();
    })
    .catch(e => alert('Fehler: ' + e.message))
    .finally(() => {
      refs.hotspotToggleBtn.disabled = false;
    });
}

function scanNetworks() {
  // Show loading state
  refs.scanLoading.classList.remove('hidden');
  refs.networkList.classList.add('hidden');
  refs.scanBtn.disabled = true;
  state.scanning = true;

  // Poll for scan results
  let attempts = 0;
  const maxAttempts = 30; // ~30 seconds timeout

  function pollScan() {
    if (attempts >= maxAttempts) {
      refs.scanLoading.classList.add('hidden');
      refs.scanBtn.disabled = false;
      alert('Scan-Timeout. Bitte später erneut versuchen.');
      return;
    }

    fetch(API.wifiNetworks)
      .then(r => r.json())
      .then(data => {
        if (data.networks && data.networks.length > 0) {
          // Scan complete
          state.networks = data.networks;
          renderNetworkList();
          refs.scanLoading.classList.add('hidden');
          refs.networkList.classList.remove('hidden');
          refs.scanBtn.disabled = false;
          state.scanning = false;
        } else if (attempts < maxAttempts - 1) {
          // Still scanning, poll again
          attempts++;
          setTimeout(pollScan, 1000);
        }
      })
      .catch(e => {
        console.error('Scan failed:', e);
        attempts++;
        if (attempts < maxAttempts - 1) {
          setTimeout(pollScan, 1000);
        }
      });
  }

  // Start initial fetch
  fetch(API.wifiNetworks)
    .then(r => r.json())
    .then(data => {
      if (data.networks && data.networks.length > 0) {
        state.networks = data.networks;
        renderNetworkList();
        refs.scanLoading.classList.add('hidden');
        refs.networkList.classList.remove('hidden');
        refs.scanBtn.disabled = false;
        state.scanning = false;
      } else {
        attempts = 1;
        setTimeout(pollScan, 1000);
      }
    })
    .catch(e => {
      console.error('Initial scan fetch failed:', e);
      attempts = 1;
      setTimeout(pollScan, 1000);
    });
}

function renderNetworkList() {
  refs.networkList.innerHTML = '';

  if (!state.networks || state.networks.length === 0) {
    const item = document.createElement('div');
    item.className = 'network-item';
    item.textContent = 'Keine Netzwerke gefunden.';
    refs.networkList.appendChild(item);
    return;
  }

  state.networks.forEach(net => {
    const item = document.createElement('div');
    item.className = 'network-item';

    const strength = Math.min(100, Math.max(0, net.signal + 100)); // -100 to 0 dBm => 0-100%
    const bars = Math.ceil(strength / 25); // 1-4 bars

    let signalHtml = '';
    for (let i = 0; i < 4; i++) {
      signalHtml += `<div class="signal-bar" style="opacity: ${i < bars ? '1' : '0.3'}"></div>`;
    }

    const lock = net.secured ? '🔒' : '';

    item.innerHTML = `
      <div class="network-info">
        <div class="network-name">${escapeHtml(net.ssid)}</div>
        <div class="network-signal">
          ${net.signal} dBm
          <span class="signal-bars">${signalHtml}</span>
          ${lock}
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      refs.ssidInput.value = net.ssid;
      refs.pwInput.focus();
      refs.networkList.classList.add('hidden');
      refs.connectForm.classList.remove('hidden');
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

  refs.connectForm.querySelector('button[type="submit"]').disabled = true;
  refs.connectError.classList.add('hidden');

  fetch(API.wifiConnect, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ssid: ssid, password: password }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.ok) {
        // Success
        refs.connectForm.reset();
        refs.connectForm.classList.add('hidden');
        refs.networkList.classList.add('hidden');
        showConnectError('', false); // Clear error

        // Update status
        setTimeout(() => {
          updateWifiStatus();
          updateHotspotStatus();
        }, 2000);

        alert('Erfolgreich verbunden!');
      } else {
        showConnectError(data.error || 'Verbindung fehlgeschlagen');
      }
    })
    .catch(e => showConnectError('Fehler: ' + e.message))
    .finally(() => {
      refs.connectForm.querySelector('button[type="submit"]').disabled = false;
    });
}

function showConnectError(msg, show = true) {
  refs.connectError.textContent = msg;
  if (show) {
    refs.connectError.classList.remove('hidden');
  } else {
    refs.connectError.classList.add('hidden');
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
