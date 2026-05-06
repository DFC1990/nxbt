function createProController() {
    let dom = window.NXBTApp.dom;
    dom.controllerSelection.classList.add('hidden');
    dom.loader.classList.remove('hidden');
    window.NXBTApp.socket.emit('web_create_pro_controller');
}

function shutdownController() {
    let state = window.NXBTApp.state.state;
    let index = window.NXBTApp.state.nxbtControllerIndex;
    if (state && state[index]) {
        window.NXBTApp.socket.emit('shutdown', index);
    }
}

function recreateProController() {
    window.NXBTApp.socket.emit('web_create_pro_controller');
}

function restartController() {
    shutdownController();
    setTimeout(recreateProController, 2000);
}

function disableKeyHandlers() {
    document.onkeydown = null;
    document.onkeyup = null;
}

function enableKeyHandlers() {
    document.onkeydown = globalKeydownHandler;
    document.onkeyup = globalKeyupHandler;
}

function globalKeydownHandler(evt) {
    if (window.NXBTApp.state.inputDevice !== window.NXBTApp.enums.InputDevice.KEYBOARD) {
        return;
    }

    evt = evt || window.event;
    if ([32, 37, 38, 39, 40].indexOf(evt.keyCode) > -1) {
        evt.preventDefault();
    }

    if (Object.prototype.hasOwnProperty.call(window.NXBTApp.constants.KEYMAP, evt.keyCode)) {
        let control = window.NXBTApp.constants.KEYMAP[evt.keyCode];
        if (window.NXBTApp.constants.LEFT_STICK.indexOf(control) > -1) {
            window.NXBTApp.state.inputPacket.L_STICK[control] = true;
        } else if (window.NXBTApp.constants.RIGHT_STICK.indexOf(control) > -1) {
            window.NXBTApp.state.inputPacket.R_STICK[control] = true;
        } else if (control === "LS_PRESS") {
            window.NXBTApp.state.inputPacket.L_STICK.PRESSED = true;
        } else if (control === "RS_PRESS") {
            window.NXBTApp.state.inputPacket.R_STICK.PRESSED = true;
        } else {
            window.NXBTApp.state.inputPacket[control] = true;
        }
    }
}

function globalKeyupHandler(evt) {
    if (window.NXBTApp.state.inputDevice !== window.NXBTApp.enums.InputDevice.KEYBOARD) {
        return;
    }

    evt = evt || window.event;
    if (Object.prototype.hasOwnProperty.call(window.NXBTApp.constants.KEYMAP, evt.keyCode)) {
        let control = window.NXBTApp.constants.KEYMAP[evt.keyCode];
        if (window.NXBTApp.constants.LEFT_STICK.indexOf(control) > -1) {
            window.NXBTApp.state.inputPacket.L_STICK[control] = false;
        } else if (window.NXBTApp.constants.RIGHT_STICK.indexOf(control) > -1) {
            window.NXBTApp.state.inputPacket.R_STICK[control] = false;
        } else if (control === "LS_PRESS") {
            window.NXBTApp.state.inputPacket.L_STICK.PRESSED = false;
        } else if (control === "RS_PRESS") {
            window.NXBTApp.state.inputPacket.R_STICK.PRESSED = false;
        } else {
            window.NXBTApp.state.inputPacket[control] = false;
        }
    }
}

function changeInput(evt) {
    let inputType = evt.target.value;
    if (inputType === window.NXBTApp.enums.InputDevice.KEYBOARD) {
        window.NXBTApp.state.inputDevice = window.NXBTApp.enums.InputDevice.KEYBOARD;
        enableKeyHandlers();
        window.NXBTApp.dom.controllerMap.classList.add('hidden');
        window.NXBTApp.dom.keyboardMap.classList.remove('hidden');
        window.NXBTApp.state.controllerIndex = false;
    } else {
        window.NXBTApp.state.inputDevice = window.NXBTApp.enums.InputDevice.GAMEPAD;
        disableKeyHandlers();
        window.NXBTApp.dom.keyboardMap.classList.add('hidden');
        window.NXBTApp.dom.controllerMap.classList.remove('hidden');
        let selectedGamepad = evt.target.children[evt.target.selectedIndex];
        window.NXBTApp.state.controllerIndex = selectedGamepad.getAttribute('index');
    }
}

function changeFrequency(evt) {
    let value = evt.target.value;
    if (value === 'RAF') {
        window.NXBTApp.state.useRAF = true;
        return;
    }
    let parsed = Number(value);
    if (!isNaN(parsed)) {
        window.NXBTApp.state.useRAF = false;
        window.NXBTApp.state.frequency = (1 / parsed) * 1000;
    }
}

function updateGamepadInput() {
    let gp = navigator.getGamepads()[window.NXBTApp.state.controllerIndex];
    if (!gp) {
        return;
    }

    let packet = window.NXBTApp.state.inputPacket;
    packet.L_STICK.X_VALUE = gp.axes[0] * 100;
    packet.L_STICK.Y_VALUE = gp.axes[1] * -100;
    packet.L_STICK.PRESSED = gp.buttons[10].pressed;
    packet.R_STICK.X_VALUE = gp.axes[2] * 100;
    packet.R_STICK.Y_VALUE = gp.axes[3] * -100;
    packet.R_STICK.PRESSED = gp.buttons[11].pressed;
    packet.DPAD_UP = gp.buttons[12].pressed;
    packet.DPAD_DOWN = gp.buttons[13].pressed;
    packet.DPAD_LEFT = gp.buttons[14].pressed;
    packet.DPAD_RIGHT = gp.buttons[15].pressed;
    packet.B = gp.buttons[0].pressed;
    packet.A = gp.buttons[1].pressed;
    packet.Y = gp.buttons[2].pressed;
    packet.X = gp.buttons[3].pressed;
    packet.L = gp.buttons[4].pressed;
    packet.R = gp.buttons[5].pressed;
    packet.ZL = gp.buttons[6].pressed;
    packet.ZR = gp.buttons[7].pressed;
    packet.PLUS = gp.buttons[8].pressed;
    packet.MINUS = gp.buttons[9].pressed;
    packet.HOME = gp.buttons[16] ? gp.buttons[16].pressed : false;
    packet.CAPTURE = gp.buttons[17] ? gp.buttons[17].pressed : false;
}

function updateGamepadDisplay() {
    let now = performance.now();
    let flashState = window.NXBTApp.state.macroFlash || {};
    let controls = Object.keys(window.NXBTApp.state.inputPacket);
    for (let i = 0; i < controls.length; i++) {
        let controlState = window.NXBTApp.state.inputPacket[controls[i]];
        let control = window.NXBTApp.displays.proController[controls[i]];
        let flash = flashState[controls[i]];
        if (flash && flash.until <= now) {
            delete flashState[controls[i]];
            flash = null;
        }
        if (!control) {
            continue;
        }

        if (control.STICK) {
            let xValue = controlState.X_VALUE;
            let yValue = controlState.Y_VALUE;
            let pressed = controlState.PRESSED;
            if (flash) {
                xValue = flash.x || xValue;
                yValue = flash.y || yValue;
                pressed = true;
            }
            let xRatio = (xValue + 100) / 200;
            let yRatio = (yValue + 100) / 200;
            let xPos = control.MIN_X + (xRatio * control.DIFF_X);
            let yPos = control.MAX_Y - (yRatio * control.DIFF_Y);
            control.ELEMENT.style.left = xPos + "%";
            control.ELEMENT.style.top = yPos + "%";
            control.ELEMENT.classList.toggle('active', Math.abs(xValue) > 5 || Math.abs(yValue) > 5 || pressed);
            control.ELEMENT.classList.toggle('macro-flash', !!flash);
        } else {
            let visible = !!controlState || !!flash;
            control.classList.toggle('hidden', !visible);
            control.classList.toggle('active', visible);
            control.classList.toggle('macro-flash', !!flash);
        }
    }
}

function flashMacroButtons(buttons) {
    if (!buttons || buttons.length < 1) {
        return;
    }

    let until = performance.now() + 250;
    let flashState = window.NXBTApp.state.macroFlash;
    for (let i = 0; i < buttons.length; i++) {
        let token = buttons[i];
        if (token === "L_STICK_PRESS") {
            flashState.L_STICK = { until: until, x: 0, y: 0 };
            continue;
        }
        if (token === "R_STICK_PRESS") {
            flashState.R_STICK = { until: until, x: 0, y: 0 };
            continue;
        }
        if (token.indexOf("L_STICK@") === 0 || token.indexOf("R_STICK@") === 0) {
            let parts = token.split("@");
            let axis = parts[1] || "+000+000";
            flashState[parts[0]] = {
                until: until,
                x: Number(axis.slice(0, 4)),
                y: Number(axis.slice(4, 8))
            };
            continue;
        }
        flashState[token] = { until: until };
    }
}

function displayOtherSessions() {
    let state = window.NXBTApp.state.state || {};
    let controllerIndices = Object.keys(state);
    if (controllerIndices.length < 1 || (controllerIndices.length === 1 && Number(controllerIndices[0]) === window.NXBTApp.state.nxbtControllerIndex)) {
        window.NXBTApp.dom.controllerSessions.classList.add('hidden');
        return;
    }

    window.NXBTApp.dom.controllerSessions.classList.remove('hidden');
    window.NXBTApp.dom.controllerSessionsContainer.innerHTML = "";
    for (let i = 0; i < controllerIndices.length; i++) {
        let sessionIndex = controllerIndices[i];
        if (Number(sessionIndex) === window.NXBTApp.state.nxbtControllerIndex) {
            continue;
        }

        let session = document.createElement('div');
        session.classList.add('controller-session');
        let title = document.createElement('h1');
        title.innerHTML = "Session #" + sessionIndex;
        let button = document.createElement('button');
        button.innerHTML = "END";
        button.onclick = function() {
            window.NXBTApp.socket.emit('shutdown', Number(sessionIndex));
        };
        session.appendChild(title);
        session.appendChild(button);
        window.NXBTApp.dom.controllerSessionsContainer.appendChild(session);
    }
}

function updateLoader() {
    let loaderBlocks = window.NXBTApp.dom.loaderBlocks.children;
    if (!window.NXBTApp.state.highlightedBlock) {
        window.NXBTApp.state.highlightedBlock = loaderBlocks[0];
    }
    window.NXBTApp.state.highlightedBlock.classList.remove('loader-block-highlight');
    window.NXBTApp.state.highlightedBlock = loaderBlocks[window.NXBTApp.constants.LOADER_ANIMATION_FRAMES[window.NXBTApp.state.loaderFrame]];
    window.NXBTApp.state.highlightedBlock.classList.add('loader-block-highlight');
    window.NXBTApp.state.loaderFrame += 1;
    if (window.NXBTApp.state.loaderFrame >= window.NXBTApp.constants.LOADER_ANIMATION_FRAMES.length) {
        window.NXBTApp.state.loaderFrame = 0;
    }
}

function updateStatusIndicator() {
    let index = window.NXBTApp.state.nxbtControllerIndex;
    let state = window.NXBTApp.state.state;
    if (state && state[index]) {
        let controllerState = state[index].state;
        if (controllerState === window.NXBTApp.enums.ControllerState.CONNECTED) {
            changeStatusIndicatorState('indicator-green', 'CONNECTED');
        } else if (controllerState === window.NXBTApp.enums.ControllerState.CRASHED) {
            changeStatusIndicatorState('indicator-red', 'CRASHED');
        } else {
            changeStatusIndicatorState('indicator-yellow', controllerState.toUpperCase());
        }
    } else {
        changeStatusIndicatorState('indicator-red', 'NO INPUT');
    }
}

function changeStatusIndicatorState(className, text) {
    window.NXBTApp.dom.statusIndicatorLight.className = '';
    window.NXBTApp.dom.statusIndicatorLight.classList.add(className);
    window.NXBTApp.dom.statusIndicatorText.innerHTML = text;
}

function checkForLoad() {
    let state = window.NXBTApp.state.state;
    let index = window.NXBTApp.state.nxbtControllerIndex;
    if (state && state[index]) {
        let controllerState = state[index].state;
        window.NXBTApp.dom.loaderText.innerHTML = controllerState;
        if (controllerState === window.NXBTApp.enums.ControllerState.CONNECTED) {
            setTimeout(function() {
                clearInterval(window.NXBTApp.state.checkForLoadInterval);
                window.NXBTApp.dom.loader.classList.add('hidden');
                window.NXBTApp.dom.controllerConfig.classList.remove('hidden');
                window.NXBTApp.dom.statusIndicator.classList.remove('hidden');
                setInterval(updateStatusIndicator, 1000);
                eventLoop();
                refreshLiveStatusPanel();
            }, 1000);
        }
    }
}

function eventLoop() {
    let packet = window.NXBTApp.state.inputPacket;
    if (window.NXBTApp.state.inputDevice === window.NXBTApp.enums.InputDevice.KEYBOARD) {
        packet.L_STICK.X_VALUE = (packet.L_STICK.LS_LEFT ? -100 : 0) + (packet.L_STICK.LS_RIGHT ? 100 : 0);
        packet.L_STICK.Y_VALUE = (packet.L_STICK.LS_UP ? 100 : 0) + (packet.L_STICK.LS_DOWN ? -100 : 0);
        packet.R_STICK.X_VALUE = (packet.R_STICK.RS_LEFT ? -100 : 0) + (packet.R_STICK.RS_RIGHT ? 100 : 0);
        packet.R_STICK.Y_VALUE = (packet.R_STICK.RS_UP ? 100 : 0) + (packet.R_STICK.RS_DOWN ? -100 : 0);
    } else if (window.NXBTApp.state.inputDevice === window.NXBTApp.enums.InputDevice.GAMEPAD) {
        updateGamepadInput();
    }

    captureRecorderEvent(packet);

    if (JSON.stringify(packet) !== JSON.stringify(window.NXBTApp.state.inputPacketOld)) {
        window.NXBTApp.socket.emit('input', JSON.stringify([window.NXBTApp.state.nxbtControllerIndex, packet]));
        window.NXBTApp.state.inputPacketOld = JSON.parse(JSON.stringify(packet));
        window.NXBTApp.dom.controllerCard.classList.add('controller-card-pulse');
        setTimeout(function() {
            window.NXBTApp.dom.controllerCard.classList.remove('controller-card-pulse');
        }, 120);
    }

    updateGamepadDisplay();
    refreshLiveStatusPanel();

    if (window.NXBTApp.state.useRAF) {
        requestAnimationFrame(eventLoop);
    } else {
        if (!window.NXBTApp.state.timeOld) {
            window.NXBTApp.state.timeOld = performance.now();
        }
        let timeNew = performance.now();
        let delta = timeNew - window.NXBTApp.state.timeOld;
        let diff = delta - window.NXBTApp.state.frequency;
        setTimeout(eventLoop, diff > 0 ? window.NXBTApp.state.frequency - diff : window.NXBTApp.state.frequency);
        window.NXBTApp.state.timeOld = timeNew;
    }
}

function initializeSocket() {
    window.NXBTApp.socket = io();
    window.NXBTApp.socket.emit('state');
    setInterval(function() {
        window.NXBTApp.socket.emit('state');
    }, 1000);

    window.NXBTApp.socket.on('state', function(state) {
        window.NXBTApp.state.state = state;
    });

    window.NXBTApp.socket.on('connect', function() {
        window.NXBTApp.state.connected = true;
        appendLog('Socket verbunden', 'success');
    });

    window.NXBTApp.socket.on('disconnect', function() {
        window.NXBTApp.state.connected = false;
        appendLog('Socket getrennt', 'warning');
        refreshLiveStatusPanel();
    });

    window.NXBTApp.socket.on('create_pro_controller', function(index) {
        window.NXBTApp.state.nxbtControllerIndex = index;
        window.NXBTApp.state.checkForLoadInterval = setInterval(checkForLoad, 1000);
    });

    window.NXBTApp.socket.on('error', function(errorMessage) {
        displayError(errorMessage);
    });
}

function initializeInputDevices() {
    document.onkeydown = globalKeydownHandler;
    document.onkeyup = globalKeyupHandler;

    // Disable key-to-controller mapping whenever any text input, textarea, or
    // select is focused — covers macro-name, macro-search, and future fields
    // without requiring onfocus/onblur on every element in the HTML.
    document.addEventListener('focusin', function(evt) {
        let tag = evt.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            disableKeyHandlers();
        }
    });
    document.addEventListener('focusout', function(evt) {
        let tag = evt.target.tagName.toLowerCase();
        if (tag === 'input' || tag === 'textarea' || tag === 'select') {
            enableKeyHandlers();
        }
    });

    window.addEventListener('gamepadconnected', function(evt) {
        let input = document.createElement('option');
        input.innerHTML = evt.gamepad.id;
        input.setAttribute('value', 'gamepad');
        input.setAttribute('index', evt.gamepad.index);
        input.id = evt.gamepad.id;
        window.NXBTApp.dom.inputDevice.appendChild(input);
    });

    window.addEventListener('gamepaddisconnected', function(evt) {
        window.NXBTApp.state.inputDevice = window.NXBTApp.enums.InputDevice.KEYBOARD;
        window.NXBTApp.dom.controllerMap.classList.add('hidden');
        window.NXBTApp.dom.keyboardMap.classList.remove('hidden');
        window.NXBTApp.state.controllerIndex = false;
        let gamepadInput = document.getElementById(evt.gamepad.id);
        if (gamepadInput) {
            gamepadInput.remove();
        }
    });
}
