import json
import logging
import os
import re
import shutil
import subprocess
import sys
import platform
from datetime import datetime, timezone
from threading import Event, Lock, RLock, Thread
import time
from socket import gethostname

from .cert import generate_cert
from ..nxbt import Nxbt, PRO_CONTROLLER
from .. import wifi as nxbt_wifi
from flask import Flask, jsonify, render_template, request, redirect
from flask_socketio import SocketIO, emit
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
import eventlet


app = Flask(__name__,
            static_url_path='',
            static_folder='static',)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    stream=sys.stderr,
)
log = logging.getLogger('nxbt.webapp')

nxbt = Nxbt()

# Configuring/retrieving secret key (stored in ~/.nxbt/secrets)
secrets_dir = os.path.expanduser('~/.nxbt')
os.makedirs(secrets_dir, mode=0o700, exist_ok=True)
secrets_path = os.path.join(secrets_dir, "secrets")

if not os.path.isfile(secrets_path):
    secret_key = os.urandom(24).hex()
    # Speichere mit restriktiven Permissions (nur Besitzer lesen)
    with open(secrets_path, "w") as fh:
        fh.write(secret_key)
    os.chmod(secrets_path, 0o600)  # rw-------
else:
    with open(secrets_path, "r") as fh:
        secret_key = fh.read().strip()
app.config['SECRET_KEY'] = secret_key

# Starting socket server with Flask app
sio = SocketIO(app, cookie=False)

# Rate limiting für kritische Endpoints
limiter = Limiter(
    app=app,
    key_func=get_remote_address,
    default_limits=["10000 per day", "500 per hour"],  # Status polling needs higher limits
    storage_uri="memory://"  # In-memory storage für Pi
)

user_info_lock = RLock()
USER_INFO = {}
# MACRO_DIRECTORY: aus Umgebungsvariable oder ~/.nxbt/macros
MACRO_DIRECTORY = os.environ.get(
    'NXBT_MACRO_DIR',
    os.path.expanduser('~/.nxbt/macros')
)
MACRO_MAX_SIZE = 100 * 1024
MACRO_FILENAME_RE = re.compile(r"^[A-Za-z0-9 _.\-]+$")
MACRO_DURATION_RE = re.compile(r"^(\d+(?:\.\d+)?)s$", re.IGNORECASE)
MACRO_STICK_RE = re.compile(r"^(L_STICK|R_STICK)@([+-]\d{3})([+-]\d{3})$", re.IGNORECASE)
MACRO_LOG_LIMIT = 200
MACRO_STATUS_LOCK = RLock()
MACRO_STATUS = {
    "running": False,
    "debug_mode": False,
    "paused": False,
    "pausing": False,
    "stopping": False,
    "stopped": False,
    "macro_name": None,
    "started_at": None,
    "current_line": None,
    "current_raw": None,
    "current_action": None,
    "current_button": None,
    "current_buttons": [],
    "current_duration": None,
    "current_wait": None,
    "current_remaining": None,
    "loop_stack": [],
    "steps_done": 0,
    "steps_total": 0,
    "repeat_current": 1,
    "repeat_total": 1,
    "elapsed_seconds": 0.0,
    "estimated_remaining": None,
    "last_error": None,
    "last_result": None,
    "controller_index": None,
}
MACRO_LOGS = []
MACRO_STOP_EVENT = Event()
MACRO_RESUME_EVENT = Event()
MACRO_THREAD = None
MACRO_DEBUG_CONTROL = {
    "step_once": False,
    "pause_requested": False,
}

# Throttle status Socket.IO emissions to ≤10 Hz during macro execution.
# On a Pi 3 the original 120 Hz was the single largest CPU consumer.
_STATUS_EMIT_INTERVAL = 0.10      # seconds between status emits (10 Hz max)
_CONTROLLER_CHECK_INTERVAL = 0.50  # seconds between cross-process state checks

# Macro list cache – invalidated on every save/delete to avoid repeated
# filesystem reads on every 1-second browser poll.
_MACRO_LIST_CACHE: dict = {"names": None}
_MACRO_LIST_LOCK = Lock()

BUTTON_TOKENS = {
    "Y", "X", "B", "A",
    "DPAD_UP", "DPAD_LEFT", "DPAD_RIGHT", "DPAD_DOWN",
    "L", "ZL", "R", "ZR",
    "JCL_SR", "JCL_SL", "JCR_SR", "JCR_SL",
    "PLUS", "MINUS", "HOME", "CAPTURE",
    "L_STICK_PRESS", "R_STICK_PRESS",
}


class MacroExecutionStopped(Exception):
    pass


@app.route('/')
def index():
    return render_template('index.html')


def _ensure_macro_directory():
    os.makedirs(MACRO_DIRECTORY, exist_ok=True)


def _get_cached_macro_list():
    with _MACRO_LIST_LOCK:
        if _MACRO_LIST_CACHE["names"] is not None:
            return list(_MACRO_LIST_CACHE["names"])
    _ensure_macro_directory()
    names = sorted(
        e for e in os.listdir(MACRO_DIRECTORY)
        if os.path.isfile(os.path.join(MACRO_DIRECTORY, e)) and e.lower().endswith('.txt')
    )
    with _MACRO_LIST_LOCK:
        _MACRO_LIST_CACHE["names"] = names
    return list(names)


def _invalidate_macro_list_cache():
    with _MACRO_LIST_LOCK:
        _MACRO_LIST_CACHE["names"] = None


def _utc_timestamp():
    return datetime.now(timezone.utc).isoformat()


def _time_label():
    return datetime.now().strftime("%H:%M:%S")


def _status_copy_unlocked():
    snapshot = dict(MACRO_STATUS)
    snapshot["current_buttons"] = list(MACRO_STATUS["current_buttons"])
    snapshot["loop_stack"] = [dict(loop_info) for loop_info in MACRO_STATUS["loop_stack"]]
    return snapshot


def _macro_status_snapshot():
    with MACRO_STATUS_LOCK:
        return _status_copy_unlocked()


def _macro_logs_snapshot():
    with MACRO_STATUS_LOCK:
        return [dict(entry) for entry in MACRO_LOGS]


def _emit_macro_status(event_name='macro_status'):
    snapshot = _macro_status_snapshot()
    sio.emit(event_name, snapshot)
    return snapshot


def _emit_macro_step(step):
    payload = {
        "status": _macro_status_snapshot(),
        "step": dict(step),
    }
    payload["step"]["buttons"] = list(step.get("buttons", []))
    payload["step"]["loop_stack"] = [dict(loop_info) for loop_info in step.get("loop_stack", [])]
    sio.emit('macro_step', payload)
    return payload


def _append_macro_log(message, level='info', line=None, action=None, result=None):
    entry = {
        "timestamp": _utc_timestamp(),
        "time_label": _time_label(),
        "line": line,
        "action": action,
        "result": result,
        "level": level,
        "message": message,
    }
    with MACRO_STATUS_LOCK:
        MACRO_LOGS.insert(0, entry)
        del MACRO_LOGS[MACRO_LOG_LIMIT:]
    sio.emit('macro_log', entry)
    return entry


def _clear_macro_logs():
    with MACRO_STATUS_LOCK:
        MACRO_LOGS.clear()


def _set_macro_status(**updates):
    with MACRO_STATUS_LOCK:
        for key, value in updates.items():
            if key == "current_buttons":
                MACRO_STATUS[key] = list(value)
            elif key == "loop_stack":
                MACRO_STATUS[key] = [dict(loop_info) for loop_info in value]
            else:
                MACRO_STATUS[key] = value
        return _status_copy_unlocked()


def _reset_macro_status(last_result=None, last_error=None, stopped=False):
    with MACRO_STATUS_LOCK:
        MACRO_STATUS["running"] = False
        MACRO_STATUS["debug_mode"] = False
        MACRO_STATUS["paused"] = False
        MACRO_STATUS["pausing"] = False
        MACRO_STATUS["stopping"] = False
        MACRO_STATUS["stopped"] = stopped
        MACRO_STATUS["macro_name"] = None
        MACRO_STATUS["started_at"] = None
        MACRO_STATUS["current_line"] = None
        MACRO_STATUS["current_raw"] = None
        MACRO_STATUS["current_action"] = None
        MACRO_STATUS["current_button"] = None
        MACRO_STATUS["current_buttons"] = []
        MACRO_STATUS["current_duration"] = None
        MACRO_STATUS["current_wait"] = None
        MACRO_STATUS["current_remaining"] = None
        MACRO_STATUS["loop_stack"] = []
        MACRO_STATUS["steps_done"] = 0
        MACRO_STATUS["steps_total"] = 0
        MACRO_STATUS["repeat_current"] = 1
        MACRO_STATUS["repeat_total"] = 1
        MACRO_STATUS["elapsed_seconds"] = 0.0
        MACRO_STATUS["estimated_remaining"] = None
        MACRO_STATUS["last_error"] = last_error
        MACRO_STATUS["last_result"] = last_result
        MACRO_STATUS["controller_index"] = None
        snapshot = _status_copy_unlocked()
    _emit_macro_status()
    return snapshot


def _initialize_macro_status(macro_name, controller_index, plan, debug_mode=False, repeat_total=1):
    started_at = _utc_timestamp()
    steps = plan["steps"]
    current_step = steps[0] if steps else None
    snapshot = _set_macro_status(
        running=True,
        debug_mode=debug_mode,
        paused=debug_mode,
        pausing=False,
        stopping=False,
        stopped=False,
        macro_name=macro_name,
        started_at=started_at,
        current_line=current_step["line"] if current_step else None,
        current_raw=current_step["raw"] if current_step else None,
        current_action=current_step["type"] if current_step else None,
        current_button=" ".join(current_step.get("buttons", [])) if current_step and current_step.get("buttons") else None,
        current_buttons=current_step.get("buttons", []) if current_step else [],
        current_duration=current_step["duration"] if current_step and current_step["type"] == "button" else None,
        current_wait=current_step["duration"] if current_step and current_step["type"] == "wait" else None,
        current_remaining=current_step["duration"] if current_step else None,
        loop_stack=current_step.get("loop_stack", []) if current_step else [],
        steps_done=0,
        steps_total=len(steps),
        repeat_current=1,
        repeat_total=repeat_total,
        elapsed_seconds=0.0,
        estimated_remaining=plan["total_duration"] * repeat_total,
        last_error=None,
        last_result="debug_ready" if debug_mode else None,
        controller_index=controller_index,
    )
    _emit_macro_status('macro_debug_ready' if debug_mode else 'macro_status')
    return snapshot


def _normalize_macro_name(name):
    if not isinstance(name, str):
        raise ValueError("Makroname muss ein String sein")

    normalized = name.strip()
    if not normalized:
        raise ValueError("Makroname darf nicht leer sein")

    if "/" in normalized or "\\" in normalized:
        raise ValueError("Ungultiger Makroname")

    if os.path.isabs(normalized):
        raise ValueError("Absolute Pfade sind nicht erlaubt")

    if not normalized.lower().endswith(".txt"):
        normalized += ".txt"

    if ".." in normalized:
        raise ValueError("Ungultiger Makroname")

    if not MACRO_FILENAME_RE.match(normalized):
        raise ValueError("Makroname enthalt ungultige Zeichen")

    return normalized


def _macro_file_path(name):
    _ensure_macro_directory()
    normalized = _normalize_macro_name(name)
    path = os.path.realpath(os.path.join(MACRO_DIRECTORY, normalized))
    macro_root = os.path.realpath(MACRO_DIRECTORY)
    if os.path.commonpath([path, macro_root]) != macro_root:
        raise ValueError("Ungultiger Makropfad")
    return normalized, path


def _read_macro_content(name):
    normalized, path = _macro_file_path(name)
    if not os.path.isfile(path):
        raise FileNotFoundError("Makro nicht gefunden")
    with open(path, "r", encoding="utf-8") as file_handle:
        content = file_handle.read()
    return normalized, content


def _resolve_controller_index(payload):
    if isinstance(payload, dict) and "controller_index" in payload:
        idx = payload["controller_index"]
        # JS sends `false` when no controller has been created yet — fall through to auto-detect
        if idx is not None and idx is not False:
            return int(idx)

    try:
        state_proxy = nxbt.state.copy()
    except (FileNotFoundError, ConnectionRefusedError, BrokenPipeError) as e:
        log.error(f"Manager state unavailable in _resolve_controller_index: {e}")
        raise ValueError("Controller-Status nicht verfugbar. Bitte neustarten.")

    for index in state_proxy.keys():
        try:
            if state_proxy[index]["state"] == "connected":
                return int(index)
        except KeyError:
            continue

    raise ValueError("Kein verbundener Controller verfugbar. Bitte zuerst einen Controller erstellen.")


def _controllers_snapshot():
    try:
        state_proxy = nxbt.state.copy()
    except (FileNotFoundError, ConnectionRefusedError, BrokenPipeError) as e:
        log.error(f"Manager state unavailable in _controllers_snapshot: {e}")
        return {}

    controllers = {}
    for controller in state_proxy.keys():
        try:
            controllers[int(controller)] = state_proxy[controller].copy()
        except Exception:
            continue
    return controllers


def _duration_from_token(token, line_number):
    match = MACRO_DURATION_RE.match(token.strip())
    if not match:
        raise ValueError(f"Ungueltige Dauer in Zeile {line_number}: {token}")
    duration = float(match.group(1))
    if duration <= 0:
        raise ValueError(f"Dauer muss groesser als 0 sein in Zeile {line_number}")
    return duration


def _normalize_token(token, line_number):
    normalized = token.strip().upper()
    if normalized in BUTTON_TOKENS:
        return normalized

    stick_match = MACRO_STICK_RE.match(normalized)
    if stick_match:
        return (
            f"{stick_match.group(1).upper()}@"
            f"{stick_match.group(2)}{stick_match.group(3)}"
        )

    raise ValueError(f"Unbekannter Makro-Befehl in Zeile {line_number}: {token}")


def _line_indent(line):
    expanded = line.expandtabs(4)
    return len(expanded) - len(expanded.lstrip(' '))


def _significant_entries(macro_text):
    entries = []
    for line_number, raw_line in enumerate(macro_text.splitlines(), start=1):
        entries.append({
            "line": line_number,
            "raw": raw_line,
            "indent": _line_indent(raw_line),
            "stripped": raw_line.strip(),
        })
    return entries


def _next_significant_entry(entries, start_index):
    index = start_index
    while index < len(entries):
        stripped = entries[index]["stripped"]
        if stripped and not stripped.startswith("#"):
            return index
        index += 1
    return None


def _find_block_end(entries, start_index, block_indent):
    index = start_index
    while index < len(entries):
        stripped = entries[index]["stripped"]
        if stripped and not stripped.startswith("#") and entries[index]["indent"] < block_indent:
            break
        index += 1
    return index


def _parse_step_line(entry, active_loops):
    stripped = entry["stripped"]
    line_number = entry["line"]
    tokens = stripped.split()
    if len(tokens) == 1:
        duration = _duration_from_token(tokens[0], line_number)
        return {
            "line": line_number,
            "raw": stripped,
            "type": "wait",
            "duration": duration,
            "buttons": [],
            "command": "wait",
            "loop_stack": [dict(loop_info) for loop_info in active_loops],
        }

    duration = _duration_from_token(tokens[-1], line_number)
    buttons = []
    for token in tokens[:-1]:
        buttons.append(_normalize_token(token, line_number))

    return {
        "line": line_number,
        "raw": stripped,
        "type": "button",
        "duration": duration,
        "buttons": buttons,
        "command": "buttons",
        "loop_stack": [dict(loop_info) for loop_info in active_loops],
    }


def _parse_block(entries, current_indent, active_loops):
    steps = []
    index = 0
    while index < len(entries):
        entry = entries[index]
        stripped = entry["stripped"]
        if not stripped or stripped.startswith("#"):
            index += 1
            continue

        indent = entry["indent"]
        if indent < current_indent:
            break
        if indent > current_indent:
            raise ValueError(f"Unerwartete Einrueckung in Zeile {entry['line']}")

        parts = stripped.split()
        if parts[0].upper() == "LOOP":
            if len(parts) != 2 or not parts[1].isdigit() or int(parts[1]) < 1:
                raise ValueError(f"Ungueltiger LOOP-Befehl in Zeile {entry['line']}")

            loop_total = int(parts[1])
            next_index = _next_significant_entry(entries, index + 1)
            if next_index is None:
                raise ValueError(f"LOOP ohne Inhalt in Zeile {entry['line']}")

            child_indent = entries[next_index]["indent"]
            if child_indent <= current_indent:
                raise ValueError(f"LOOP ohne eingerueckten Block in Zeile {entry['line']}")

            block_end = _find_block_end(entries, next_index, child_indent)
            body_entries = entries[next_index:block_end]
            for loop_current in range(1, loop_total + 1):
                loop_info = {
                    "loop_line": entry["line"],
                    "loop_total": loop_total,
                    "loop_current": loop_current,
                }
                steps.extend(_parse_block(body_entries, child_indent, active_loops + [loop_info]))
            index = block_end
            continue

        steps.append(_parse_step_line(entry, active_loops))
        index += 1

    return steps


def _parse_macro_plan(macro_text):
    entries = _significant_entries(macro_text)
    root_indent = 0
    first_significant = _next_significant_entry(entries, 0)
    if first_significant is not None:
        root_indent = entries[first_significant]["indent"]

    plan_steps = _parse_block(entries, root_indent, [])
    if not plan_steps:
        raise ValueError("Makro enthaelt keine ausfuehrbaren Schritte")

    total_duration = sum(step["duration"] for step in plan_steps)
    return {
        "steps": plan_steps,
        "total_duration": total_duration,
    }


def _packet_from_buttons(buttons):
    packet = nxbt.create_input_packet()
    for token in buttons:
        if token == "L_STICK_PRESS":
            packet["L_STICK"]["PRESSED"] = True
        elif token == "R_STICK_PRESS":
            packet["R_STICK"]["PRESSED"] = True
        elif token in BUTTON_TOKENS:
            packet[token] = True
        else:
            stick_match = MACRO_STICK_RE.match(token)
            if not stick_match:
                raise ValueError(f"Unbekannter Steuerbefehl: {token}")
            stick_name = stick_match.group(1).upper()
            packet[stick_name]["X_VALUE"] = int(stick_match.group(2))
            packet[stick_name]["Y_VALUE"] = int(stick_match.group(3))
    return packet


def _release_controller_input(controller_index):
    nxbt.set_controller_input(controller_index, nxbt.create_input_packet())


def _elapsed_seconds(started_monotonic):
    return round(time.monotonic() - started_monotonic, 3)


def _remaining_duration(plan, current_index, current_remaining):
    remaining = current_remaining
    for step in plan["steps"][current_index + 1:]:
        remaining += step["duration"]
    return round(remaining, 3)


def _update_runtime_status(plan, current_index, step, started_monotonic, current_remaining=None, steps_done=None):
    if current_remaining is None:
        current_remaining = step["duration"]
    if steps_done is None:
        steps_done = current_index

    snapshot = _set_macro_status(
        current_line=step["line"],
        current_raw=step["raw"],
        current_action=step["type"],
        current_button=" ".join(step.get("buttons", [])) if step.get("buttons") else None,
        current_buttons=step.get("buttons", []),
        current_duration=step["duration"] if step["type"] == "button" else None,
        current_wait=step["duration"] if step["type"] == "wait" else None,
        current_remaining=round(current_remaining, 3),
        loop_stack=step.get("loop_stack", []),
        steps_done=steps_done,
        steps_total=len(plan["steps"]),
        elapsed_seconds=_elapsed_seconds(started_monotonic),
        estimated_remaining=_remaining_duration(plan, current_index, current_remaining),
    )
    _emit_macro_status()
    return snapshot


def _check_controller_state(controller_index):
    try:
        state = nxbt.state.get(controller_index)
    except (FileNotFoundError, ConnectionRefusedError, BrokenPipeError) as e:
        log.error(f"Manager state unavailable in _check_controller_state: {e}")
        raise RuntimeError("Controller-Status nicht verfugbar. Bitte neustarten.")

    if state is None:
        try:
            known_indices = list(nxbt.state.keys())
        except (FileNotFoundError, ConnectionRefusedError, BrokenPipeError):
            known_indices = []
        log.error("Controller %s nicht im State gefunden. Bekannte Indices: %s",
                  controller_index, known_indices)
        raise RuntimeError("Controller ist nicht mehr verfuegbar")
    if state.get("state") == "crashed":
        errors = state.get("errors") or ""
        log.error(
            "Controller %s abgestuerzt. errors=%r full_state=%r",
            controller_index, errors, dict(state),
        )
        raise RuntimeError(errors or "Controller ist abgestuerzt")
    return state


def _pump_input(controller_index, packet, duration, status_callback=None):
    deadline = time.monotonic() + duration
    last_status_at = 0.0
    last_check_at = 0.0
    while True:
        if MACRO_STOP_EVENT.is_set():
            raise MacroExecutionStopped()
        now = time.monotonic()
        remaining = deadline - now
        if remaining <= 0:
            break
        # Throttle cross-process controller state check to 2 Hz.
        # The original 120 Hz caused heavy multiprocessing proxy overhead on Pi 3.
        if now - last_check_at >= _CONTROLLER_CHECK_INTERVAL:
            _check_controller_state(controller_index)
            last_check_at = now
        # Retry up to 3 times on transient controller-not-found errors
        # (race between crash detection and manager_state cleanup).
        for _attempt in range(3):
            try:
                nxbt.set_controller_input(controller_index, packet)
                break
            except ValueError:
                if _attempt == 2:
                    raise
                time.sleep(0.05)
        # Throttle Socket.IO status emissions to _STATUS_EMIT_INTERVAL (10 Hz).
        # Was previously 120 Hz – the biggest single CPU drain on Pi 3.
        if status_callback is not None and now - last_status_at >= _STATUS_EMIT_INTERVAL:
            status_callback(round(max(remaining, 0.0), 3))
            last_status_at = now
        time.sleep(min(1 / 120, remaining))


def _execute_step(controller_index, plan, current_index, step, started_monotonic):
    status_callback = lambda remaining: _update_runtime_status(
        plan,
        current_index,
        step,
        started_monotonic,
        current_remaining=remaining,
        steps_done=current_index,
    )

    if step["type"] == "button":
        packet = _packet_from_buttons(step["buttons"])
        _pump_input(controller_index, packet, step["duration"], status_callback)
        _release_controller_input(controller_index)
    else:
        neutral_packet = nxbt.create_input_packet()
        _pump_input(controller_index, neutral_packet, step["duration"], status_callback)


def _wait_for_debug_resume(plan, current_index, step, started_monotonic):
    while True:
        snapshot = _macro_status_snapshot()
        if MACRO_STOP_EVENT.is_set():
            raise MacroExecutionStopped()
        if not snapshot["paused"]:
            return
        _update_runtime_status(plan, current_index, step, started_monotonic, current_remaining=step["duration"], steps_done=current_index)
        MACRO_RESUME_EVENT.wait(0.1)
        MACRO_RESUME_EVENT.clear()


def _log_step_start(step):
    if step["type"] == "wait":
        _append_macro_log(
            f"Zeile {step['line']}: Warte {step['duration']:.1f}S",
            level='info',
            line=step["line"],
            action='wait',
            result='running',
        )
    else:
        loop_suffix = ""
        if step.get("loop_stack"):
            tail = step["loop_stack"][-1]
            loop_suffix = f" | Loop {tail['loop_current']}/{tail['loop_total']}"
        _append_macro_log(
            f"Zeile {step['line']}: Sende {' '.join(step['buttons'])} fuer {step['duration']:.1f}S{loop_suffix}",
            level='warning',
            line=step["line"],
            action='button',
            result='running',
        )


def _finalize_macro_stop(controller_index):
    try:
        _release_controller_input(controller_index)
    except Exception:
        pass
    _append_macro_log("Makro gestoppt", level='info', action='stop', result='stopped')
    _reset_macro_status(last_result='stopped', stopped=True)
    sio.emit('macro_stopped', _macro_status_snapshot())


def _finalize_macro_finish():
    _append_macro_log("Makro beendet", level='success', action='finish', result='finished')
    _reset_macro_status(last_result='finished', stopped=False)
    sio.emit('macro_finished', _macro_status_snapshot())


def _finalize_macro_error(controller_index, error_text):
    try:
        _release_controller_input(controller_index)
    except Exception as release_err:
        log.warning("_release_controller_input fehlgeschlagen nach Macro-Fehler: %s", release_err)
    log.error("Makro-Fehler (controller=%s): %s", controller_index, error_text)
    _append_macro_log(error_text, level='error', action='error', result='error')
    _reset_macro_status(last_result='error', last_error=error_text, stopped=False)
    sio.emit('macro_error', _macro_status_snapshot())


def _run_macro_plan_task(controller_index, plan, macro_name=None, debug_mode=False, repeat=1):
    global MACRO_THREAD

    started_monotonic = time.monotonic()
    try:
        _initialize_macro_status(macro_name, controller_index, plan, debug_mode=debug_mode, repeat_total=repeat)
        if debug_mode:
            _append_macro_log("Debug bereit", level='info', action='debug', result='ready')
        else:
            repeat_label = f" ({repeat}x)" if repeat > 1 else ""
            _append_macro_log(f"Makro gestartet{repeat_label}", level='warning', action='run', result='running')

        for repeat_index in range(repeat):
            if repeat > 1:
                _set_macro_status(repeat_current=repeat_index + 1)
                _append_macro_log(
                    f"Wiederholung {repeat_index + 1}/{repeat}",
                    level='info', action='run', result='running',
                )
                _emit_macro_status()

            previous_loop_signature = None
            for current_index, step in enumerate(plan["steps"]):
                # Check stop event BEFORE controller state so a user-requested stop
                # is never misreported as a controller crash.
                if MACRO_STOP_EVENT.is_set():
                    raise MacroExecutionStopped()
                _check_controller_state(controller_index)
                _update_runtime_status(plan, current_index, step, started_monotonic, current_remaining=step["duration"], steps_done=current_index)
                _emit_macro_step(step)

                if debug_mode:
                    _wait_for_debug_resume(plan, current_index, step, started_monotonic)

                if MACRO_STOP_EVENT.is_set():
                    raise MacroExecutionStopped()

                loop_signature = tuple(
                    (loop_info["loop_line"], loop_info["loop_current"], loop_info["loop_total"])
                    for loop_info in step.get("loop_stack", [])
                )
                if loop_signature and loop_signature != previous_loop_signature:
                    current_loop = step["loop_stack"][-1]
                    _append_macro_log(
                        f"Loop {current_loop['loop_current']}/{current_loop['loop_total']} gestartet",
                        level='info',
                        line=current_loop["loop_line"],
                        action='loop',
                        result='running',
                    )
                    previous_loop_signature = loop_signature

                _log_step_start(step)
                _execute_step(controller_index, plan, current_index, step, started_monotonic)
                _set_macro_status(steps_done=current_index + 1, elapsed_seconds=_elapsed_seconds(started_monotonic))
                _emit_macro_status()

                if debug_mode:
                    with MACRO_STATUS_LOCK:
                        if MACRO_DEBUG_CONTROL["step_once"] or MACRO_DEBUG_CONTROL["pause_requested"]:
                            MACRO_STATUS["paused"] = True
                            MACRO_STATUS["pausing"] = False
                            MACRO_DEBUG_CONTROL["step_once"] = False
                            MACRO_DEBUG_CONTROL["pause_requested"] = False
                    if _macro_status_snapshot()["paused"]:
                        _append_macro_log("Debug pausiert", level='info', action='debug', result='paused')
                        _emit_macro_status()

            # Release buttons at the end of each run to avoid stuck inputs between repeats
            _release_controller_input(controller_index)

        _finalize_macro_finish()
    except MacroExecutionStopped:
        _finalize_macro_stop(controller_index)
    except Exception as err:
        _finalize_macro_error(controller_index, str(err))
    finally:
        MACRO_STOP_EVENT.clear()
        MACRO_RESUME_EVENT.clear()
        with MACRO_STATUS_LOCK:
            MACRO_DEBUG_CONTROL["step_once"] = False
            MACRO_DEBUG_CONTROL["pause_requested"] = False
        MACRO_THREAD = None


def _start_macro_runner(content, payload, debug_mode=False):
    global MACRO_THREAD

    with MACRO_STATUS_LOCK:
        if MACRO_STATUS["running"]:
            raise ValueError("Es laeuft bereits ein Makro")

    controller_index = _resolve_controller_index(payload)

    # Pre-flight: verify the controller is actually connected before spawning a thread.
    # Without this, the crash is only discovered mid-execution and reported as a crash error.
    try:
        controller_preflight = nxbt.state.get(controller_index)
    except (FileNotFoundError, ConnectionRefusedError, BrokenPipeError) as e:
        log.error(f"Manager state unavailable in _start_macro_runner: {e}")
        raise ValueError("Controller-Status nicht verfugbar. Bitte neustarten.")

    if controller_preflight is None:
        raise ValueError("Controller nicht gefunden. Bitte 'Recreate Controller' klicken.")
    if controller_preflight.get("state") == "crashed":
        raise ValueError("Controller ist abgestuerzt. Bitte 'Recreate Controller' klicken.")
    if controller_preflight.get("state") not in ("connected",):
        raise ValueError(
            f"Controller nicht bereit (Status: {controller_preflight.get('state', '?')}). Bitte warten."
        )

    macro_name = payload.get("name") if isinstance(payload, dict) else None
    repeat = int(payload.get("repeat", 1)) if isinstance(payload, dict) else 1
    if repeat < 1:
        repeat = 1
    elif repeat > 9999:
        repeat = 9999
    plan = _parse_macro_plan(content)

    MACRO_STOP_EVENT.clear()
    MACRO_RESUME_EVENT.clear()
    with MACRO_STATUS_LOCK:
        MACRO_DEBUG_CONTROL["step_once"] = False
        MACRO_DEBUG_CONTROL["pause_requested"] = False
    _clear_macro_logs()

    macro_thread = Thread(
        target=_run_macro_plan_task,
        args=(controller_index, plan, macro_name, debug_mode, repeat),
        daemon=True,
    )
    MACRO_THREAD = macro_thread
    macro_thread.start()

    deadline = time.time() + 1.0
    while time.time() < deadline:
        snapshot = _macro_status_snapshot()
        if snapshot["running"]:
            return snapshot
        if snapshot["last_error"]:
            raise RuntimeError(snapshot["last_error"])
        time.sleep(0.01)

    raise RuntimeError("Makro konnte nicht gestartet werden")


def _request_macro_stop():
    with MACRO_STATUS_LOCK:
        if not MACRO_STATUS["running"]:
            raise ValueError("Es laeuft kein Makro")
        MACRO_STATUS["stopping"] = True
        MACRO_STATUS["paused"] = False
        MACRO_STATUS["pausing"] = False
    MACRO_STOP_EVENT.set()
    MACRO_RESUME_EVENT.set()
    _append_macro_log("Makro-Stopp angefordert", level='warning', action='stop', result='requested')
    _emit_macro_status()
    return _macro_status_snapshot()


def _request_debug_next():
    with MACRO_STATUS_LOCK:
        if not MACRO_STATUS["running"] or not MACRO_STATUS["debug_mode"]:
            raise ValueError("Kein aktiver Debug-Modus")
        MACRO_STATUS["paused"] = False
        MACRO_STATUS["pausing"] = False
        MACRO_DEBUG_CONTROL["step_once"] = True
        MACRO_DEBUG_CONTROL["pause_requested"] = False
    MACRO_RESUME_EVENT.set()
    _append_macro_log("Debug: naechster Schritt", level='info', action='debug', result='step')
    _emit_macro_status()
    return _macro_status_snapshot()


def _request_debug_continue():
    with MACRO_STATUS_LOCK:
        if not MACRO_STATUS["running"] or not MACRO_STATUS["debug_mode"]:
            raise ValueError("Kein aktiver Debug-Modus")
        MACRO_STATUS["paused"] = False
        MACRO_STATUS["pausing"] = False
        MACRO_DEBUG_CONTROL["step_once"] = False
        MACRO_DEBUG_CONTROL["pause_requested"] = False
    MACRO_RESUME_EVENT.set()
    _append_macro_log("Debug: weiterlaufen", level='warning', action='debug', result='continue')
    _emit_macro_status()
    return _macro_status_snapshot()


def _request_debug_pause():
    with MACRO_STATUS_LOCK:
        if not MACRO_STATUS["running"] or not MACRO_STATUS["debug_mode"]:
            raise ValueError("Kein aktiver Debug-Modus")
        if MACRO_STATUS["paused"]:
            return _status_copy_unlocked()
        MACRO_STATUS["pausing"] = True
        MACRO_DEBUG_CONTROL["pause_requested"] = True
        MACRO_DEBUG_CONTROL["step_once"] = False
    _append_macro_log("Debug: Pause angefordert", level='warning', action='debug', result='pause_requested')
    _emit_macro_status()
    return _macro_status_snapshot()


def _request_debug_abort():
    snapshot = _request_macro_stop()
    _append_macro_log("Debug abgebrochen", level='warning', action='debug', result='aborted')
    return snapshot


@app.route('/api/macros', methods=['GET'])
def list_macros():
    return jsonify({'macros': _get_cached_macro_list()})


@app.route('/api/macros/<name>', methods=['GET'])
def get_macro(name):
    try:
        normalized, content = _read_macro_content(name)
        return jsonify({'name': normalized, 'content': content})
    except FileNotFoundError:
        return jsonify({'error': 'Makro nicht gefunden'}), 404
    except ValueError as err:
        return jsonify({'error': str(err)}), 400


@app.route('/api/macros', methods=['POST'])
@limiter.limit("30 per minute")
def save_macro():
    payload = request.get_json(silent=True) or {}
    name = payload.get('name', '')
    content = payload.get('content', '')

    try:
        if not isinstance(content, str):
            raise ValueError('Makroinhalt muss ein String sein')
        if not content.strip():
            raise ValueError('Leere Makros koennen nicht gespeichert werden')

        content_size = len(content.encode('utf-8'))
        if content_size > MACRO_MAX_SIZE:
            raise ValueError('Makro ist groesser als 100 KB')

        normalized, path = _macro_file_path(name)
        with open(path, 'w', encoding='utf-8') as file_handle:
            file_handle.write(content)
        _invalidate_macro_list_cache()

        return jsonify({'name': normalized, 'message': 'Makro gespeichert'})
    except ValueError as err:
        return jsonify({'error': str(err)}), 400


@app.route('/api/macros/<name>', methods=['DELETE'])
@limiter.limit("20 per minute")
def delete_macro(name):
    try:
        normalized, path = _macro_file_path(name)
        if not os.path.isfile(path):
            return jsonify({'error': 'Makro nicht gefunden'}), 404
        os.remove(path)
        _invalidate_macro_list_cache()
        return jsonify({'name': normalized, 'message': 'Makro geloescht'})
    except ValueError as err:
        return jsonify({'error': str(err)}), 400


@app.route('/api/macros/run', methods=['POST'])
@limiter.limit("10 per minute")  # Max 10 macro runs per minute
def run_macro():
    payload = request.get_json(silent=True) or {}

    try:
        content = payload.get('content')
        if content is None and payload.get('name'):
            _, content = _read_macro_content(payload.get('name'))

        if not isinstance(content, str):
            raise ValueError('Makroinhalt fehlt')
        if not content.strip():
            raise ValueError('Leeres Makro kann nicht ausgefuehrt werden')

        content_size = len(content.encode('utf-8'))
        if content_size > MACRO_MAX_SIZE:
            raise ValueError('Makro ist groesser als 100 KB')

        status = _start_macro_runner(content, payload, debug_mode=False)

        return jsonify({
            'message': 'Makro gestartet',
            'running': status['running'],
            'stopping': status['stopping'],
            'debug_mode': status['debug_mode'],
            'macro_name': status['macro_name'],
            'started_at': status['started_at'],
            'controller_index': status['controller_index'],
            'steps_total': status['steps_total'],
        })
    except FileNotFoundError:
        return jsonify({'error': 'Makro nicht gefunden'}), 404
    except ValueError as err:
        return jsonify({'error': str(err)}), 400
    except Exception as err:
        return jsonify({'error': str(err)}), 500


@app.route('/api/macros/stop', methods=['POST'])
def stop_macro_route():
    try:
        snapshot = _request_macro_stop()
        return jsonify({
            'message': 'Makro wird gestoppt',
            'running': snapshot['running'],
            'stopping': snapshot['stopping'],
            'debug_mode': snapshot['debug_mode'],
            'macro_name': snapshot['macro_name'],
        })
    except ValueError as err:
        return jsonify({'error': str(err)}), 400


@app.route('/api/macros/status', methods=['GET'])
@limiter.limit("3000 per hour")  # High limit for 2s polling from mobile UI
def macro_status():
    return jsonify(_macro_status_snapshot())


@app.route('/api/macros/logs', methods=['GET'])
@limiter.limit("3000 per hour")  # High limit for polling
def macro_logs():
    return jsonify({'logs': _macro_logs_snapshot()})


@app.route('/api/controllers', methods=['GET'])
def list_controllers():
    return jsonify({'controllers': _controllers_snapshot()})


@app.route('/api/controllers', methods=['POST'])
@limiter.limit("10 per minute")
def create_controller_route():
    try:
        reconnect_addresses = nxbt.get_switch_addresses()
        index = nxbt.create_controller(PRO_CONTROLLER, reconnect_address=reconnect_addresses)
        return jsonify({
            'controller_index': index,
            'controllers': _controllers_snapshot(),
        })
    except Exception as err:
        return jsonify({'error': str(err)}), 500


@app.route('/api/controllers/<int:index>', methods=['DELETE'])
def delete_controller_route(index):
    try:
        nxbt.remove_controller(index)
        return jsonify({'controller_index': index, 'removed': True})
    except Exception as err:
        return jsonify({'error': str(err)}), 400


@app.route('/api/controllers/<int:index>/adopt', methods=['POST'])
def adopt_controller_route(index):
    controllers = _controllers_snapshot()
    if index not in controllers:
        return jsonify({'error': 'Controller-Session nicht gefunden'}), 404
    return jsonify({
        'controller_index': index,
        'controller': controllers[index],
    })


@sio.on('connect')
def on_connect():
    with user_info_lock:
        USER_INFO[request.sid] = {}
    emit('macro_status', _macro_status_snapshot())
    emit('macro_logs', {'logs': _macro_logs_snapshot()})


@sio.on('state')
def on_state():
    try:
        state = _controllers_snapshot()
        emit('state_update', state)
        emit('state', state)
    except (FileNotFoundError, ConnectionRefusedError, BrokenPipeError) as e:
        log.error(f"Failed to access controller state: {e}")
        emit('state_update', {})
        emit('state', {})


@sio.on('disconnect')
def on_disconnect():
    print("Disconnected")
    with user_info_lock:
        USER_INFO.pop(request.sid, None)


@sio.on('shutdown')
def on_shutdown(index):
    nxbt.remove_controller(index)


@sio.on('web_adopt_controller')
def on_adopt_controller(index):
    controllers = _controllers_snapshot()
    try:
        index = int(index)
    except (TypeError, ValueError):
        emit('error', 'Ungueltige Controller-Session')
        return

    if index not in controllers:
        emit('error', 'Controller-Session nicht gefunden')
        return

    with user_info_lock:
        USER_INFO.setdefault(request.sid, {})["controller_index"] = index
    emit('create_pro_controller', index)


@sio.on('web_create_pro_controller')
def on_create_controller():
    print("Create Controller")

    try:
        reconnect_addresses = nxbt.get_switch_addresses()
        index = nxbt.create_controller(PRO_CONTROLLER, reconnect_address=reconnect_addresses)

        with user_info_lock:
            USER_INFO[request.sid]["controller_index"] = index

        emit('create_pro_controller', index)
    except Exception as err:
        emit('error', str(err))


@sio.on('input')
def handle_input(message):
    message = json.loads(message)
    index = message[0]
    input_packet = message[1]
    try:
        nxbt.set_controller_input(index, input_packet)
    except Exception:
        # Controller briefly gone during crash/reconnect — drop the packet silently.
        pass


@sio.on('macro')
def handle_macro(message):
    try:
        message = json.loads(message)
        payload = {
            'controller_index': message[0],
            'content': message[1],
            'name': None,
        }
        _start_macro_runner(payload['content'], payload, debug_mode=False)
    except Exception as err:
        emit('error', str(err))


@sio.on('macro_stop')
def handle_macro_stop():
    try:
        _request_macro_stop()
    except Exception as err:
        emit('error', str(err))


@sio.on('macro_debug_start')
def handle_macro_debug_start(payload):
    try:
        payload = payload or {}
        content = payload.get('content')
        if content is None and payload.get('name'):
            _, content = _read_macro_content(payload.get('name'))
        if not isinstance(content, str) or not content.strip():
            raise ValueError('Makroinhalt fehlt')
        if len(content.encode('utf-8')) > MACRO_MAX_SIZE:
            raise ValueError('Makro ist groesser als 100 KB')
        _start_macro_runner(content, payload, debug_mode=True)
    except Exception as err:
        emit('error', str(err))


@sio.on('macro_debug_next')
def handle_macro_debug_next():
    try:
        _request_debug_next()
    except Exception as err:
        emit('error', str(err))


@sio.on('macro_debug_continue')
def handle_macro_debug_continue():
    try:
        _request_debug_continue()
    except Exception as err:
        emit('error', str(err))


@sio.on('macro_debug_pause')
def handle_macro_debug_pause():
    try:
        _request_debug_pause()
    except Exception as err:
        emit('error', str(err))


@sio.on('macro_debug_abort')
def handle_macro_debug_abort():
    try:
        _request_debug_abort()
    except Exception as err:
        emit('error', str(err))


def _run_cmd(args, timeout=3):
    try:
        proc = subprocess.run(
            args, capture_output=True, text=True, timeout=timeout
        )
        return proc.returncode, proc.stdout, proc.stderr
    except FileNotFoundError:
        return None, "", ""
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"
    except Exception as exc:
        return -1, "", str(exc)


@app.route('/api/bluetooth/status', methods=['GET'])
def bluetooth_status():
    result = {
        "hci0_exists": False,
        "hci0_up": False,
        "hci0_address": None,
        "rfkill_soft_blocked": None,
        "rfkill_hard_blocked": None,
        "bluetooth_service": None,
        "hciconfig_output": None,
        "error": None,
    }

    # hciconfig hci0
    code, out, err = _run_cmd(["hciconfig", "hci0"])
    if code is None:
        result["error"] = "hciconfig nicht gefunden"
    elif code == 0:
        result["hci0_exists"] = True
        result["hci0_up"] = "UP RUNNING" in out
        result["hciconfig_output"] = out.strip()
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("BD Address:"):
                result["hci0_address"] = line.split()[2]
                break
    else:
        result["hci0_exists"] = False
        result["error"] = err.strip() or "hci0 nicht gefunden"

    # rfkill list bluetooth
    code, out, _ = _run_cmd(["rfkill", "list", "bluetooth"])
    if code == 0:
        lower = out.lower()
        result["rfkill_soft_blocked"] = "soft blocked: yes" in lower
        result["rfkill_hard_blocked"] = "hard blocked: yes" in lower

    # systemctl is-active bluetooth
    code, out, _ = _run_cmd(["systemctl", "is-active", "bluetooth"])
    if code is not None:
        result["bluetooth_service"] = out.strip() or ("active" if code == 0 else "inactive")

    return jsonify(result)


@app.route('/api/system/info', methods=['GET'])
def system_info():
    result = {
        "python_version": sys.version.split()[0],
        "platform": platform.platform(),
        "nxbt_path": os.path.dirname(os.path.abspath(__file__)),
        "macro_directory": MACRO_DIRECTORY,
        "mem_total_mb": None,
        "mem_available_mb": None,
        "load_avg": None,
    }

    try:
        with open("/proc/meminfo", "r") as fh:
            mem = {}
            for line in fh:
                parts = line.split(":")
                if len(parts) == 2 and parts[0].strip() in ("MemTotal", "MemAvailable"):
                    mem[parts[0].strip()] = int(parts[1].strip().split()[0])
        result["mem_total_mb"] = round(mem.get("MemTotal", 0) / 1024)
        result["mem_available_mb"] = round(mem.get("MemAvailable", 0) / 1024)
    except Exception:
        pass

    try:
        with open("/proc/loadavg", "r") as fh:
            result["load_avg"] = fh.read().strip().split()[:3]
    except Exception:
        pass

    return jsonify(result)


@app.route('/mobile')
def mobile():
    """Mobile-friendly interface for macro control."""
    return render_template('mobile.html')


@app.route('/api/wifi/status', methods=['GET'])
@limiter.limit("3000 per hour")  # High limit for 2s polling
def wifi_status():
    """Get current WiFi connection status."""
    return jsonify(nxbt_wifi.get_wifi_status())


@app.route('/api/wifi/networks', methods=['GET'])
@limiter.limit("30 per hour")  # Scans are expensive; lower limit
def wifi_networks():
    """Scan and return available WiFi networks.

    This is slow (~5-8 seconds) because it triggers an actual scan.
    Mobile UI should show a spinner and poll this endpoint until scanning is done.
    """
    # Run scan in background thread to avoid blocking Flask greenlet
    def _scan_in_thread():
        networks = nxbt_wifi.scan_networks(timeout=8)
        return networks

    try:
        networks = eventlet.tpool.execute(_scan_in_thread)
        return jsonify({"networks": networks})
    except Exception as e:
        log.warning(f"WiFi scan failed: {e}")
        return jsonify({"networks": [], "error": str(e)}), 500


@app.route('/api/wifi/connect', methods=['POST'])
def wifi_connect():
    """Connect to a WiFi network.

    POST body: {"ssid": "NetworkName", "password": "password"}
    """
    payload = request.get_json(silent=True) or {}
    ssid = payload.get('ssid', '').strip()
    password = payload.get('password', '')

    if not ssid:
        return jsonify({"ok": False, "error": "SSID erforderlich"}), 400

    # Run connection in thread to avoid blocking
    def _connect_in_thread():
        return nxbt_wifi.connect_network(ssid, password, timeout=30)

    try:
        result = eventlet.tpool.execute(_connect_in_thread)
        status_code = 200 if result.get('ok') else 500
        return jsonify(result), status_code
    except Exception as e:
        log.warning(f"WiFi connect failed: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route('/api/wifi/hotspot/status', methods=['GET'])
def hotspot_status():
    """Get current hotspot status."""
    return jsonify(nxbt_wifi.ap_status())


@app.route('/api/wifi/hotspot/toggle', methods=['POST'])
def hotspot_toggle():
    """Toggle hotspot on/off."""
    status = nxbt_wifi.ap_status()

    if status.get('active'):
        result = nxbt_wifi.stop_ap()
    else:
        result = nxbt_wifi.start_ap()

    status_code = 200 if result.get('ok') else 500
    return jsonify(result), status_code


@app.route('/api/wifi/hotspot-only', methods=['POST'])
def hotspot_only():
    """Persist hotspot-only mode and keep NXBT reachable over its AP."""
    def _hotspot_only_in_thread():
        return nxbt_wifi.use_hotspot_only()

    try:
        result = eventlet.tpool.execute(_hotspot_only_in_thread)
        status_code = 200 if result.get('ok') else 500
        return jsonify(result), status_code
    except Exception as e:
        log.warning(f"Hotspot-only activation failed: {e}")
        return jsonify({"ok": False, "error": str(e)}), 500


# Captive portal redirects (Android/iOS/macOS/Windows WiFi detection)
@app.route('/generate_204')
@app.route('/gen_204')
@app.route('/connecttest.txt')
@app.route('/ncsi.txt')
@app.route('/redirect')
def captive_portal_android():
    """Captive portal detection endpoint."""
    return redirect('/mobile')


@app.route('/hotspot-detect.html')
@app.route('/library/test/success.html')
def captive_portal_apple():
    """Apple (iOS/macOS) captive portal detection endpoint."""
    return redirect('/mobile')


@app.errorhandler(404)
def captive_portal_fallback(e):
    """Redirect any unknown URL to /mobile for captive portal experience.

    This ensures that no matter what URL the user tries to visit,
    they get redirected to the mobile UI. This is especially useful
    when connected to the NXBT hotspot.
    """
    # Don't redirect static files or API calls
    if request.path.startswith('/static/') or request.path.startswith('/api/'):
        return e

    # Redirect everything else to /mobile
    return redirect('/mobile')


def start_web_app(ip='0.0.0.0', port=8000, usessl=False, cert_path=None):
    if usessl:
        if cert_path is None:
            cert_path = os.path.join(
                os.path.dirname(__file__), "cert.pem"
            )
            key_path = os.path.join(
                os.path.dirname(__file__), "key.pem"
            )
        else:
            cert_path = os.path.join(
                cert_path, "cert.pem"
            )
            key_path = os.path.join(
                cert_path, "key.pem"
            )
        if not os.path.isfile(cert_path) or not os.path.isfile(key_path):
            print(
                "\n"
                "-----------------------------------------\n"
                "---------------->WARNING<----------------\n"
                "The NXBT webapp is being run with self-\n"
                "signed SSL certificates for use on your\n"
                "local network.\n"
                "\n"
                "These certificates ARE NOT safe for\n"
                "production use. Please generate valid\n"
                "SSL certificates if you plan on using the\n"
                "NXBT webapp anywhere other than your own\n"
                "network.\n"
                "-----------------------------------------\n"
                "\n"
                "The above warning will only be shown once\n"
                "on certificate generation."
                "\n"
            )
            print("Generating certificates...")
            cert, key = generate_cert(gethostname())
            with open(cert_path, "wb") as file_handle:
                file_handle.write(cert)
            with open(key_path, "wb") as file_handle:
                file_handle.write(key)

        # Start AP auto-detection in background thread
        def _ap_autostart():
            from .. import wifi as _w
            _w.maybe_start_ap()
            _w.start_background_monitor()

        Thread(target=_ap_autostart, daemon=True).start()

        eventlet.wsgi.server(eventlet.wrap_ssl(eventlet.listen((ip, port)),
            certfile=cert_path, keyfile=key_path), app)
    else:
        # Start AP auto-detection in background thread
        def _ap_autostart():
            from .. import wifi as _w
            _w.maybe_start_ap()
            _w.start_background_monitor()

        Thread(target=_ap_autostart, daemon=True).start()

        eventlet.wsgi.server(eventlet.listen((ip, port)), app)


if __name__ == "__main__":
    start_web_app()
