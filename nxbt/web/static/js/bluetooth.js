/**********************************************/
/* NXBT – Bluetooth & System Diagnostics      */
/**********************************************/

function _btStateLabel(text) {
    let el = document.getElementById('bt-check-state');
    if (el) {
        el.innerHTML = text;
    }
}

function _diagResult(html, variant) {
    let el = document.getElementById('diag-result');
    if (!el) {
        return;
    }
    el.className = 'diag-result';
    if (variant) {
        el.classList.add('diag-result-' + variant);
    }
    el.classList.remove('hidden');
    el.innerHTML = html;
}

function _diagRow(label, value, ok) {
    let cls = ok === true ? 'diag-ok' : (ok === false ? 'diag-err' : 'diag-neutral');
    return '<div class="diag-row"><span class="diag-label">' + label + '</span>'
        + '<span class="diag-value ' + cls + '">' + value + '</span></div>';
}

function runBluetoothCheck() {
    _btStateLabel('Pruefe...');
    _diagResult('<span class="diag-neutral">Wird abgerufen…</span>', '');

    fetch('/api/bluetooth/status')
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
            let rows = '';
            let overallOk = true;

            // hci0 exists
            rows += _diagRow('hci0 vorhanden', data.hci0_exists ? 'Ja' : 'Nein', data.hci0_exists);
            if (!data.hci0_exists) {
                overallOk = false;
            }

            // hci0 UP
            if (data.hci0_exists) {
                rows += _diagRow('hci0 Status', data.hci0_up ? 'UP RUNNING' : 'DOWN', data.hci0_up);
                if (!data.hci0_up) {
                    overallOk = false;
                }
            }

            // hci0 Adresse
            if (data.hci0_address) {
                rows += _diagRow('BD Adresse', data.hci0_address, null);
            }

            // rfkill
            if (data.rfkill_soft_blocked !== null && data.rfkill_soft_blocked !== undefined) {
                let softOk = !data.rfkill_soft_blocked;
                rows += _diagRow('rfkill soft blocked', data.rfkill_soft_blocked ? 'Ja (blockiert)' : 'Nein', softOk);
                if (!softOk) {
                    overallOk = false;
                }
            }
            if (data.rfkill_hard_blocked !== null && data.rfkill_hard_blocked !== undefined) {
                let hardOk = !data.rfkill_hard_blocked;
                rows += _diagRow('rfkill hard blocked', data.rfkill_hard_blocked ? 'Ja (blockiert)' : 'Nein', hardOk);
                if (!hardOk) {
                    overallOk = false;
                }
            }

            // bluetooth.service
            if (data.bluetooth_service) {
                let svcOk = data.bluetooth_service === 'active';
                rows += _diagRow('bluetooth.service', data.bluetooth_service, svcOk);
                if (!svcOk) {
                    overallOk = false;
                }
            }

            // Fehler
            if (data.error) {
                rows += _diagRow('Fehler', data.error, false);
                overallOk = false;
            }

            let variant = overallOk ? 'ok' : 'err';
            let summary = overallOk
                ? '<div class="diag-summary diag-ok">Bluetooth bereit</div>'
                : '<div class="diag-summary diag-err">Problem erkannt – Details unten</div>';

            _diagResult(summary + '<div class="diag-grid">' + rows + '</div>', variant);
            _btStateLabel(overallOk ? 'OK' : 'Problem');
            appendLog('Bluetooth-Check: ' + (overallOk ? 'OK' : 'Problem erkannt'), overallOk ? 'success' : 'warning');
        })
        .catch(function(err) {
            _diagResult('<span class="diag-err">Netzwerkfehler: ' + err + '</span>', 'err');
            _btStateLabel('Fehler');
            appendLog('Bluetooth-Check fehlgeschlagen: ' + err, 'error');
        });
}

function runSystemCheck() {
    _btStateLabel('Pruefe...');
    _diagResult('<span class="diag-neutral">Wird abgerufen…</span>', '');

    fetch('/api/system/info')
        .then(function(resp) { return resp.json(); })
        .then(function(data) {
            let rows = '';

            rows += _diagRow('Python', data.python_version || '–', null);
            rows += _diagRow('Plattform', data.platform || '–', null);
            rows += _diagRow('NXBT-Pfad', data.nxbt_path || '–', null);
            rows += _diagRow('Makro-Verzeichnis', data.macro_directory || '–', null);

            if (data.mem_total_mb !== null && data.mem_total_mb !== undefined) {
                let memOk = data.mem_available_mb > 64;
                rows += _diagRow('RAM gesamt', data.mem_total_mb + ' MB', null);
                rows += _diagRow('RAM verfuegbar', data.mem_available_mb + ' MB', memOk);
            }

            if (data.load_avg) {
                let load1 = parseFloat(data.load_avg[0]);
                let loadOk = load1 < 2.0;
                rows += _diagRow('Load Average (1/5/15 min)', data.load_avg.join(' / '), loadOk);
            }

            _diagResult('<div class="diag-grid">' + rows + '</div>', '');
            _btStateLabel('Systeminfo geladen');
            appendLog('Systeminfo abgerufen', 'info');
        })
        .catch(function(err) {
            _diagResult('<span class="diag-err">Netzwerkfehler: ' + err + '</span>', 'err');
            _btStateLabel('Fehler');
        });
}
