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
    let dur = Math.max(0.1, parseFloat(document.getElementById('builder-duration').value) || 0.5);
    dur = Math.round(dur * 10) / 10;
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
    let dur = Math.max(0.1, parseFloat(document.getElementById('builder-duration').value) || 1.0);
    dur = Math.round(dur * 10) / 10;
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
    let count = Math.max(2, parseInt(document.getElementById('builder-loop-count').value) || 3);
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
        let labelHtml = step.comment
            ? '<div class="builder-step-label">' + _builderEsc(step.comment) + '</div>'
            : '';

        let contentHtml = '';
        if (step.type === 'button') {
            let badges = step.buttons.map(function(b) {
                return '<span class="builder-badge">' + _builderEsc(BUILDER_DISPLAY[b] || b) + '</span>';
            }).join(' ');
            contentHtml = badges + ' <span class="builder-step-dur">' + step.duration.toFixed(1) + 's</span>';
        } else if (step.type === 'wait') {
            contentHtml = '<span class="builder-icon">⏱</span>'
                + '<span class="builder-step-dur">' + step.duration.toFixed(1) + 's</span>'
                + '<span class="builder-muted"> warten</span>';
        } else if (step.type === 'loop_start') {
            contentHtml = '<span class="builder-icon">↺</span>'
                + '<strong>' + step.count + '&times;</strong>'
                + '<span class="builder-muted"> wiederholen</span>';
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
