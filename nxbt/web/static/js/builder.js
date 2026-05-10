/**********************************************/
/* NXBT – Makro-Baukasten                     */
/**********************************************/

var _builderSteps = [];
var _builderSelected = new Set();
var _builderNextId = 1;

var BUILDER_DISPLAY = {
    'A': 'A', 'B': 'B', 'X': 'X', 'Y': 'Y',
    'DPAD_UP': '↑', 'DPAD_DOWN': '↓', 'DPAD_LEFT': '←', 'DPAD_RIGHT': '→',
    'L': 'L', 'ZL': 'ZL', 'R': 'R', 'ZR': 'ZR',
    'PLUS': '+', 'MINUS': '−', 'HOME': '⌂', 'CAPTURE': '□',
    'L_STICK_PRESS': 'LS', 'R_STICK_PRESS': 'RS',
};

var BUILDER_BUTTONS = [
    'A', 'B', 'X', 'Y',
    'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT',
    'L', 'ZL', 'R', 'ZR',
    'PLUS', 'MINUS', 'HOME', 'CAPTURE',
    'L_STICK_PRESS', 'R_STICK_PRESS',
];

function _builderDuration(value) {
    let dur = parseFloat(value);
    if (isNaN(dur)) { dur = 0.5; }
    dur = Math.max(0.1, Math.min(60, dur));
    return Math.round(dur * 10) / 10;
}

function _builderLoopCount(value) {
    let count = parseInt(value, 10);
    if (isNaN(count)) { count = 2; }
    return Math.max(2, Math.min(9999, count));
}

function builderToggle(btn) {
    if (_builderSelected.has(btn)) {
        _builderSelected.delete(btn);
    } else {
        _builderSelected.add(btn);
    }
    let el = document.getElementById('bbtn-' + btn);
    if (el) {
        el.classList.toggle('builder-btn-active', _builderSelected.has(btn));
    }
}

function builderAddStep() {
    if (_builderSelected.size === 0) {
        setBannerStatus('Bitte zuerst mindestens einen Button auswaehlen', 'error');
        return;
    }
    let dur = _builderDuration(document.getElementById('builder-duration').value);
    let comment = (document.getElementById('builder-comment').value || '').trim();
    _builderSteps.push({
        id: _builderNextId++,
        type: 'button',
        buttons: Array.from(_builderSelected),
        duration: dur,
        comment: comment,
    });
    _builderSelected.clear();
    document.querySelectorAll('.builder-btn-active').forEach(function(e) {
        e.classList.remove('builder-btn-active');
    });
    document.getElementById('builder-comment').value = '';
    _builderRender();
}

function builderAddWait() {
    let dur = _builderDuration(document.getElementById('builder-duration').value || 1.0);
    let comment = (document.getElementById('builder-comment').value || '').trim();
    _builderSteps.push({
        id: _builderNextId++,
        type: 'wait',
        duration: dur,
        comment: comment,
    });
    document.getElementById('builder-comment').value = '';
    _builderRender();
}

function builderAddLoopStart() {
    let count = _builderLoopCount(document.getElementById('builder-loop-count').value || 3);
    let comment = (document.getElementById('builder-comment').value || '').trim();
    _builderSteps.push({
        id: _builderNextId++,
        type: 'loop_start',
        count: count,
        comment: comment,
    });
    document.getElementById('builder-comment').value = '';
    _builderRender();
}

function builderAddLoopEnd() {
    let openLoops = 0;
    for (let i = 0; i < _builderSteps.length; i++) {
        if (_builderSteps[i].type === 'loop_start') openLoops++;
        if (_builderSteps[i].type === 'loop_end') openLoops--;
    }
    if (openLoops <= 0) {
        setBannerStatus('Kein offener Loop vorhanden – zuerst Loop-Anfang hinzufuegen', 'error');
        return;
    }
    _builderSteps.push({ id: _builderNextId++, type: 'loop_end' });
    _builderRender();
}

function builderDelete(idx) {
    _builderSteps.splice(idx, 1);
    _builderRender();
}

function builderMove(idx, dir) {
    let nIdx = idx + dir;
    if (nIdx < 0 || nIdx >= _builderSteps.length) { return; }
    let tmp = _builderSteps[idx];
    _builderSteps[idx] = _builderSteps[nIdx];
    _builderSteps[nIdx] = tmp;
    _builderRender();
}

function builderEditLabel(idx, value) {
    if (!_builderSteps[idx]) { return; }
    _builderSteps[idx].comment = value.trim();
    _builderRender();
}

function builderEditDuration(idx, value) {
    let step = _builderSteps[idx];
    if (!step || (step.type !== 'button' && step.type !== 'wait')) { return; }
    step.duration = _builderDuration(value);
    _builderRender();
}

function builderNudgeDuration(idx, delta) {
    let step = _builderSteps[idx];
    if (!step || (step.type !== 'button' && step.type !== 'wait')) { return; }
    step.duration = _builderDuration((step.duration || 0.5) + delta);
    _builderRender();
}

function builderEditLoopCount(idx, value) {
    let step = _builderSteps[idx];
    if (!step || step.type !== 'loop_start') { return; }
    step.count = _builderLoopCount(value);
    _builderRender();
}

function builderNudgeLoopCount(idx, delta) {
    let step = _builderSteps[idx];
    if (!step || step.type !== 'loop_start') { return; }
    step.count = _builderLoopCount((step.count || 2) + delta);
    _builderRender();
}

function builderToggleStepButton(idx, button) {
    let step = _builderSteps[idx];
    if (!step || step.type !== 'button') { return; }
    if (!Array.isArray(step.buttons)) {
        step.buttons = [];
    }
    let pos = step.buttons.indexOf(button);
    if (pos >= 0) {
        if (step.buttons.length === 1) {
            setBannerStatus('Ein Knopfdruck braucht mindestens eine Taste', 'error');
            return;
        }
        step.buttons.splice(pos, 1);
    } else {
        step.buttons.push(button);
    }
    _builderRender();
}

function builderClear() {
    _builderSteps = [];
    _builderSelected.clear();
    document.querySelectorAll('.builder-btn-active').forEach(function(e) {
        e.classList.remove('builder-btn-active');
    });
    _builderRender();
}

function builderExportToEditor() {
    if (_builderSteps.length === 0) {
        setBannerStatus('Baukasten ist leer', 'error');
        return;
    }
    // Validate loop balance
    let openLoops = 0;
    for (let i = 0; i < _builderSteps.length; i++) {
        if (_builderSteps[i].type === 'loop_start') openLoops++;
        if (_builderSteps[i].type === 'loop_end') openLoops--;
    }
    if (openLoops !== 0) {
        setBannerStatus(openLoops > 0
            ? 'Loop nicht geschlossen – Loop-Ende fehlt'
            : 'Mehr Loop-Enden als Anfänge', 'error');
        return;
    }
    let text = _builderToText();
    let dom = window.NXBTApp && window.NXBTApp.dom;
    if (dom && dom.macroText) {
        dom.macroText.value = text;
    }
    setBannerStatus('Makro aus Baukasten uebernommen', 'success');
    appendLog('Baukasten → Makro-Editor: ' + _builderSteps.length + ' Schritte', 'success');
}

function _builderToText() {
    let lines = [];
    let depth = 0;
    for (let i = 0; i < _builderSteps.length; i++) {
        let step = _builderSteps[i];
        if (step.type === 'loop_end') {
            if (depth > 0) { depth--; }
            continue; // dedent only – no explicit line in NXBT syntax
        }
        let ind = '  '.repeat(depth);
        if (step.comment) {
            lines.push(ind + '# ' + step.comment);
        }
        if (step.type === 'button') {
            lines.push(ind + step.buttons.join(' ') + ' ' + step.duration.toFixed(1) + 's');
        } else if (step.type === 'wait') {
            lines.push(ind + step.duration.toFixed(1) + 's');
        } else if (step.type === 'loop_start') {
            lines.push(ind + 'LOOP ' + step.count);
            depth++;
        }
    }
    return lines.join('\n');
}

function builderImportFromEditor() {
    let dom = window.NXBTApp && window.NXBTApp.dom;
    let text = dom && dom.macroText ? dom.macroText.value : '';
    if (!text.trim()) {
        setBannerStatus('Makro-Editor ist leer', 'error');
        return;
    }

    let steps = [];
    let lines = text.split('\n');
    let pendingComment = '';
    let loopStack = [];
    let nextId = 1;

    for (let i = 0; i < lines.length; i++) {
        let raw = lines[i];
        let stripped = raw.trim();
        if (!stripped) continue;

        let expanded = raw.replace(/\t/g, '    ');
        let indent = expanded.length - expanded.trimStart().length;

        // Close open loops when indent decreases
        while (loopStack.length > 0 && indent <= loopStack[loopStack.length - 1].indent) {
            loopStack.pop();
            steps.push({ id: nextId++, type: 'loop_end' });
        }

        if (stripped.startsWith('#')) {
            pendingComment = stripped.slice(1).trim();
            continue;
        }

        let tokens = stripped.split(/\s+/);
        let comment = pendingComment;
        pendingComment = '';

        if (tokens[0].toUpperCase() === 'LOOP' && tokens.length === 2) {
            steps.push({ id: nextId++, type: 'loop_start', count: Math.max(2, parseInt(tokens[1]) || 2), comment: comment });
            loopStack.push({ indent: indent });
            continue;
        }

        if (tokens.length === 1 && /^\d+(\.\d+)?s$/i.test(tokens[0])) {
            steps.push({ id: nextId++, type: 'wait', duration: Math.round(parseFloat(tokens[0]) * 10) / 10, comment: comment });
            continue;
        }

        if (tokens.length >= 2 && /^\d+(\.\d+)?s$/i.test(tokens[tokens.length - 1])) {
            steps.push({
                id: nextId++,
                type: 'button',
                buttons: tokens.slice(0, -1),
                duration: Math.round(parseFloat(tokens[tokens.length - 1]) * 10) / 10,
                comment: comment,
            });
            continue;
        }
    }

    while (loopStack.length > 0) {
        loopStack.pop();
        steps.push({ id: nextId++, type: 'loop_end' });
    }

    if (steps.length === 0) {
        setBannerStatus('Keine gueltigen Schritte im Makro-Editor gefunden', 'error');
        return;
    }

    _builderSteps = steps;
    _builderNextId = nextId;
    _builderSelected.clear();
    document.querySelectorAll('.builder-btn-active').forEach(function(e) {
        e.classList.remove('builder-btn-active');
    });
    _builderRender();
    setBannerStatus('Makro importiert: ' + steps.filter(function(s) { return s.type !== 'loop_end'; }).length + ' Schritte geladen', 'success');
    appendLog('Makro-Editor → Baukasten: ' + steps.length + ' Schritte importiert', 'success');
}

function _builderDepthAt(upToIdx) {
    let d = 0;
    for (let i = 0; i < upToIdx; i++) {
        if (_builderSteps[i].type === 'loop_start') { d++; }
        if (_builderSteps[i].type === 'loop_end' && d > 0) { d--; }
    }
    return d;
}

function _builderEsc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function _builderAttr(s) {
    return _builderEsc(s).replace(/'/g, '&#39;');
}

function _builderEditableLabel(step, idx) {
    return '<input class="builder-step-label-input" type="text" value="' + _builderAttr(step.comment || '') + '"'
        + ' placeholder="Label"'
        + ' onfocus="disableKeyHandlers()" onblur="enableKeyHandlers(); builderEditLabel(' + idx + ', this.value)"'
        + ' onkeydown="if(event.key===\'Enter\'){this.blur();}">';
}

function _builderDurationEditor(step, idx) {
    return '<div class="builder-inline-editor">'
        + '<button class="bsb" onclick="builderNudgeDuration(' + idx + ',-0.1)" title="Dauer verringern">&minus;</button>'
        + '<input class="builder-step-number mono" type="number" min="0.1" max="60" step="0.1" value="' + step.duration.toFixed(1) + '"'
        + ' onfocus="disableKeyHandlers()" onblur="enableKeyHandlers(); builderEditDuration(' + idx + ', this.value)"'
        + ' onkeydown="if(event.key===\'Enter\'){this.blur();}">'
        + '<button class="bsb" onclick="builderNudgeDuration(' + idx + ',0.1)" title="Dauer erhoehen">+</button>'
        + '</div>';
}

function _builderLoopEditor(step, idx) {
    return '<div class="builder-inline-editor">'
        + '<button class="bsb" onclick="builderNudgeLoopCount(' + idx + ',-1)" title="Loop verringern">&minus;</button>'
        + '<input class="builder-step-number mono" type="number" min="2" max="9999" step="1" value="' + step.count + '"'
        + ' onfocus="disableKeyHandlers()" onblur="enableKeyHandlers(); builderEditLoopCount(' + idx + ', this.value)"'
        + ' onkeydown="if(event.key===\'Enter\'){this.blur();}">'
        + '<button class="bsb" onclick="builderNudgeLoopCount(' + idx + ',1)" title="Loop erhoehen">+</button>'
        + '</div>';
}

function _builderButtonEditor(step, idx) {
    return '<div class="builder-step-button-grid">'
        + BUILDER_BUTTONS.map(function(button) {
            let active = step.buttons.indexOf(button) >= 0;
            return '<button class="builder-step-chip' + (active ? ' active' : '') + '"'
                + ' onclick="builderToggleStepButton(' + idx + ',\'' + button + '\')"'
                + ' title="' + _builderAttr(button) + '">'
                + _builderEsc(BUILDER_DISPLAY[button] || button)
                + '</button>';
        }).join('')
        + '</div>';
}

function _builderRender() {
    let container = document.getElementById('builder-steps-list');
    let countEl   = document.getElementById('builder-step-count');
    if (!container) { return; }
    if (countEl) { countEl.textContent = _builderSteps.length; }

    if (_builderSteps.length === 0) {
        container.innerHTML = '<div class="builder-empty">Noch keine Schritte &mdash; Buttons ausw&auml;hlen und hinzuf&uuml;gen.</div>';
        return;
    }

    let html = '';
    let depth = 0;

    for (let i = 0; i < _builderSteps.length; i++) {
        let step = _builderSteps[i];
        let stepDepth = depth;

        if (step.type === 'loop_end' && depth > 0) {
            depth--;
            stepDepth = depth;
        }

        let typeClass = 'builder-step-' + step.type;
        let labelHtml = step.type === 'loop_end'
            ? ''
            : '<div class="builder-step-label-row">' + _builderEditableLabel(step, i) + '</div>';

        let contentHtml = '';
        if (step.type === 'button') {
            let badges = step.buttons.map(function(b) {
                return '<span class="builder-badge">' + _builderEsc(BUILDER_DISPLAY[b] || b) + '</span>';
            }).join(' ');
            contentHtml = '<div class="builder-step-summary">' + badges + ' <span class="builder-step-dur">' + step.duration.toFixed(1) + 's</span></div>'
                + _builderDurationEditor(step, i)
                + _builderButtonEditor(step, i);
        } else if (step.type === 'wait') {
            contentHtml = '<div class="builder-step-summary"><span class="builder-icon">⏱</span>'
                + '<span class="builder-step-dur">' + step.duration.toFixed(1) + 's</span>'
                + '<span class="builder-muted"> warten</span></div>'
                + _builderDurationEditor(step, i);
        } else if (step.type === 'loop_start') {
            contentHtml = '<div class="builder-step-summary"><span class="builder-icon">↺</span>'
                + '<strong>' + step.count + '&times;</strong>'
                + '<span class="builder-muted"> wiederholen</span></div>'
                + _builderLoopEditor(step, i);
        } else if (step.type === 'loop_end') {
            contentHtml = '<span class="builder-muted">&#x21A9; Loop Ende</span>';
        }

        let upBtn   = i > 0 ? '<button class="bsb" onclick="builderMove(' + i + ',-1)" title="Nach oben">&uarr;</button>' : '';
        let downBtn = i < _builderSteps.length - 1 ? '<button class="bsb" onclick="builderMove(' + i + ',1)" title="Nach unten">&darr;</button>' : '';
        let delBtn  = '<button class="bsb bsb-del" onclick="builderDelete(' + i + ')" title="L&ouml;schen">&times;</button>';

        html += '<div class="builder-step ' + typeClass + '" style="--step-depth:' + stepDepth + '">';
        html += '<div class="builder-step-bar"></div>';
        html += '<div class="builder-step-inner">';
        html += labelHtml;
        html += '<div class="builder-step-content">' + contentHtml + '</div>';
        html += '</div>';
        html += '<div class="builder-step-btns">' + upBtn + downBtn + delBtn + '</div>';
        html += '</div>';

        if (step.type === 'loop_start') { depth++; }
    }

    container.innerHTML = html;
}
