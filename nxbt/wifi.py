"""WiFi and access point management for nxbt on Raspberry Pi.

This module handles:
- Detection of network connectivity (uplink check)
- Auto-start/stop of WiFi AP when uplink is unavailable
- Scanning for available networks
- Connecting to external WiFi networks
- All via nmcli (NetworkManager, Bookworm) or hostapd (Bullseye fallback)

Pi B+ has only one WiFi radio, so AP and station cannot run simultaneously.
When connecting to external WLAN, AP is stopped first.
"""

import logging
import json
import os
import re
import subprocess
import threading
import time
from typing import Optional

log = logging.getLogger("nxbt.wifi")

# Access point config
AP_SSID = "NXBT-CONTROL"
AP_PASSWORD = "nxbt1234"
AP_IP = "192.168.4.1"
AP_BAND = "bg"      # 2.4 GHz (Pi B+ only has 2.4 GHz)
AP_CHANNEL = 6      # Fixed channel to avoid scan overhead
AP_BOOT_DELAY = 3   # Seconds to wait after boot before starting AP
MODE_HOTSPOT_ONLY = "hotspot_only"
MODE_WIFI_CLIENT = "wifi_client"
CONFIG_PATH = os.path.expanduser("~/.nxbt/network.json")

# Shared state (protected by _lock)
_lock = threading.Lock()
_hotspot_active = False
_backend = None     # "nmcli" or "hostapd" or None; set on first detection
_scan_cache = {"networks": [], "timestamp": 0, "scanning": False}
_scan_cache_ttl = 30  # Cache scan results for 30 seconds
_wifi_status_cache = {"result": None, "timestamp": 0}
_wifi_status_ttl = 5   # Cache wifi status for 5 seconds (avoids nmcli on every poll)


def _invalidate_caches():
    with _lock:
        _wifi_status_cache["result"] = None
        _wifi_status_cache["timestamp"] = 0
        _scan_cache["timestamp"] = 0


def _load_config() -> dict:
    try:
        with open(CONFIG_PATH, "r") as fh:
            config = json.load(fh)
    except FileNotFoundError:
        return {"mode": MODE_WIFI_CLIENT}
    except Exception as exc:
        log.warning(f"Failed to read network config: {exc}")
        return {"mode": MODE_WIFI_CLIENT}

    if config.get("mode") not in {MODE_HOTSPOT_ONLY, MODE_WIFI_CLIENT}:
        config["mode"] = MODE_WIFI_CLIENT
    return config


def _save_config(config: dict) -> None:
    os.makedirs(os.path.dirname(CONFIG_PATH), mode=0o700, exist_ok=True)
    tmp_path = CONFIG_PATH + ".tmp"
    with open(tmp_path, "w") as fh:
        json.dump(config, fh, indent=2, sort_keys=True)
        fh.write("\n")
    os.chmod(tmp_path, 0o600)
    os.replace(tmp_path, CONFIG_PATH)


def get_network_mode() -> str:
    return _load_config().get("mode", MODE_WIFI_CLIENT)


def set_network_mode(mode: str) -> None:
    if mode not in {MODE_HOTSPOT_ONLY, MODE_WIFI_CLIENT}:
        raise ValueError(f"Unknown network mode: {mode}")
    _save_config({"mode": mode})


def _split_nmcli_line(line: str) -> list:
    """Split nmcli -t output, honoring backslash-escaped separators."""
    fields = []
    current = []
    escaped = False
    for char in line:
        if escaped:
            current.append(char)
            escaped = False
        elif char == "\\":
            escaped = True
        elif char == ":":
            fields.append("".join(current))
            current = []
        else:
            current.append(char)
    if escaped:
        current.append("\\")
    fields.append("".join(current))
    return fields


def _run(args: list, timeout: int = 10) -> tuple:
    """Run a subprocess, return (returncode, stdout, stderr).

    Returns (None, '', '') if binary not found or on other errors.
    Returns (-1, '', 'timeout') on timeout.

    nmcli commands are prefixed with sudo if not running as root.
    """
    # nmcli needs elevated privileges; use sudo if not root
    if os.geteuid() != 0 and args and args[0] == "nmcli":
        args = ["sudo"] + args

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
        log.warning(f"subprocess error: {exc}")
        return -1, "", str(exc)


def detect_backend() -> Optional[str]:
    """Detect which WiFi backend is available.

    Returns 'nmcli' if NetworkManager is active, 'hostapd' if available, else None.
    Result is cached in _backend after first call.
    """
    global _backend

    with _lock:
        if _backend is not None:
            return _backend

        # Check for nmcli (NetworkManager, Bookworm)
        code, _, _ = _run(["which", "nmcli"], timeout=2)
        if code == 0:
            # Verify NM is running
            code, out, _ = _run(["systemctl", "is-active", "NetworkManager"], timeout=2)
            if code == 0:
                log.info("WiFi backend: nmcli (NetworkManager)")
                _backend = "nmcli"
                return _backend

        # Fallback: check for hostapd
        code, _, _ = _run(["which", "hostapd"], timeout=2)
        if code == 0:
            log.info("WiFi backend: hostapd (fallback)")
            _backend = "hostapd"
            return _backend

        log.warning("No WiFi backend available (nmcli or hostapd not found)")
        _backend = ""  # Mark as "checked but not found"
        return None


def has_uplink_connection() -> bool:
    """Check if wlan0 has an active uplink connection to an external AP.

    Strategy (fast, no subprocess unless needed):
    1. Check /sys/class/net/wlan0/operstate == 'up'
    2. Check /proc/net/wireless for wlan0 with link > 0
    3. Check /proc/net/route for default route on wlan0
    4. Fallback: nmcli check (only if needed)

    Returns False on error or if no uplink found (fail-safe: AP will start).
    """
    try:
        # Check if interface is up
        operstate_path = "/sys/class/net/wlan0/operstate"
        if not os.path.exists(operstate_path):
            return False

        with open(operstate_path) as f:
            operstate = f.read().strip()
        if operstate != "up":
            return False

        # Check wireless status
        try:
            with open("/proc/net/wireless") as f:
                for line in f:
                    if "wlan0" in line:
                        # Format: wlan0: 0000 0000 ...
                        # Column 3 (after colon) is link quality
                        parts = line.split()
                        if len(parts) > 3:
                            link = int(parts[2].rstrip(":"))
                            if link == 0:
                                return False
                        break
        except Exception:
            pass

        # Check for default route on wlan0
        try:
            with open("/proc/net/route") as f:
                for line in f:
                    parts = line.split()
                    if len(parts) > 1 and parts[0] == "wlan0":
                        # Destination field: 00000000 = default route
                        if parts[1] == "00000000":
                            return True
        except Exception:
            pass

        # No default route found via /proc — fall back to nmcli check
        code, out, _ = _run(
            ["nmcli", "-t", "-f", "DEVICE,STATE", "device", "status"],
            timeout=5
        )
        if code == 0 and "wlan0:connected" in out:
            return True

        return False

    except Exception as e:
        log.warning(f"Error checking uplink connection: {e}")
        return False


def maybe_start_ap() -> bool:
    """Called once at webapp startup.

    Waits AP_BOOT_DELAY seconds for network stack to settle, then starts AP
    if has_uplink_connection() is False.

    Returns True if AP was started, False otherwise.
    """
    time.sleep(AP_BOOT_DELAY)

    if get_network_mode() == MODE_HOTSPOT_ONLY:
        log.info("Hotspot-only mode enabled, starting AP")
        result = start_ap()
        return result.get("ok", False)

    if has_uplink_connection():
        log.info("Uplink connection available, AP not needed")
        return False

    log.info("No uplink connection detected, starting AP")
    result = start_ap()
    return result.get("ok", False)


def start_ap() -> dict:
    """Start the WiFi access point.

    Returns {"ok": True, "ip": ..., "ssid": ..., "backend": ...}
    or {"ok": False, "error": "..."}
    """
    backend = detect_backend()
    if backend is None:
        return {"ok": False, "error": "No WiFi backend available"}

    if backend == "nmcli":
        return _nmcli_start_ap()
    elif backend == "hostapd":
        return _hostapd_start_ap()
    else:
        return {"ok": False, "error": f"Unknown backend: {backend}"}


def stop_ap() -> dict:
    """Stop the WiFi access point.

    Returns {"ok": True} or {"ok": False, "error": "..."}
    """
    global _hotspot_active

    backend = detect_backend()
    if backend is None:
        return {"ok": False, "error": "No WiFi backend available"}

    if backend == "nmcli":
        result = _nmcli_stop_ap()
    elif backend == "hostapd":
        result = _hostapd_stop_ap()
    else:
        return {"ok": False, "error": f"Unknown backend: {backend}"}

    if result.get("ok"):
        with _lock:
            _hotspot_active = False

    return result


def use_hotspot_only() -> dict:
    """Persist and activate hotspot-only mode."""
    set_network_mode(MODE_HOTSPOT_ONLY)
    result = start_ap()
    _invalidate_caches()
    if not result.get("ok"):
        result["mode"] = MODE_HOTSPOT_ONLY
        return result
    return {
        "ok": True,
        "mode": MODE_HOTSPOT_ONLY,
        "ssid": AP_SSID,
        "ip": AP_IP,
        "password": AP_PASSWORD,
        "backend": result.get("backend"),
    }


def ap_status() -> dict:
    """Return current hotspot state without side-effects.

    Returns {"active": bool, "ssid": str|None, "ip": str|None, "backend": str|None}
    """
    backend = detect_backend()

    with _lock:
        return {
            "active": _hotspot_active,
            "ssid": AP_SSID if _hotspot_active else None,
            "ip": AP_IP if _hotspot_active else None,
            "backend": backend,
            "mode": get_network_mode(),
        }


def get_wifi_status() -> dict:
    """Return current WiFi connection info (cached for 5 seconds).

    Returns {"connected": bool, "ssid": str|None, "ip": str|None,
             "signal": int|None, "interface": str|None}
    """
    with _lock:
        age = time.time() - _wifi_status_cache["timestamp"]
        if age < _wifi_status_ttl and _wifi_status_cache["result"] is not None:
            return _wifi_status_cache["result"]

    try:
        backend = detect_backend()
        code, out, _ = _run(
            ["nmcli", "-t", "-f", "DEVICE,TYPE,STATE,CONNECTION", "device"],
            timeout=5
        )
        if code != 0:
            return {
                "mode": get_network_mode(),
                "connected": False,
                "ssid": None,
                "ip": None,
                "signal": None,
                "hotspot_active": ap_status().get("active", False),
                "hotspot_ssid": AP_SSID,
                "hotspot_ip": AP_IP,
                "backend": backend,
                "error": "nmcli failed",
            }

        # Parse output: lines like "wlan0:wifi:connected:MyNetwork"
        for line in out.strip().split("\n"):
            if not line.startswith("wlan0"):
                continue
            parts = _split_nmcli_line(line)
            if len(parts) >= 4 and parts[2] == "connected":
                ssid = parts[3] if parts[3] else None

                # Get IP and signal
                ip_addr = _get_ip_address()
                signal = _get_wifi_signal()
                hotspot_active = ssid == AP_SSID

                result = {
                    "mode": get_network_mode(),
                    "connected": not hotspot_active,
                    "ssid": None if hotspot_active else ssid,
                    "ip": ip_addr,
                    "signal": None if hotspot_active else signal,
                    "interface": "wlan0",
                    "hotspot_active": hotspot_active or ap_status().get("active", False),
                    "hotspot_ssid": AP_SSID,
                    "hotspot_ip": AP_IP,
                    "backend": backend,
                    "saved": bool(ssid and _nmcli_connection_exists(ssid)),
                }
                with _lock:
                    _wifi_status_cache["result"] = result
                    _wifi_status_cache["timestamp"] = time.time()
                return result

        result = {
            "mode": get_network_mode(),
            "connected": False,
            "ssid": None,
            "ip": None,
            "signal": None,
            "interface": "wlan0",
            "hotspot_active": ap_status().get("active", False),
            "hotspot_ssid": AP_SSID,
            "hotspot_ip": AP_IP,
            "backend": backend,
            "saved": False,
        }
        with _lock:
            _wifi_status_cache["result"] = result
            _wifi_status_cache["timestamp"] = time.time()
        return result

    except Exception as e:
        log.warning(f"Error getting WiFi status: {e}")
        return {
            "mode": get_network_mode(),
            "connected": False,
            "hotspot_active": ap_status().get("active", False),
            "hotspot_ssid": AP_SSID,
            "hotspot_ip": AP_IP,
            "backend": detect_backend(),
            "error": str(e),
        }


def scan_networks(timeout: int = 8) -> list:
    """Scan for available WiFi networks.

    Runs in background thread to avoid blocking Flask greenlets.

    Returns list of {"ssid": str, "signal": int, "secured": bool, "freq": str}
    Sorted descending by signal strength.
    """
    global _scan_cache

    now = time.time()
    with _lock:
        # Return cached results if fresh
        if _scan_cache["networks"] and (now - _scan_cache["timestamp"]) < _scan_cache_ttl:
            return _scan_cache["networks"]

        # Avoid multiple concurrent scans
        if _scan_cache["scanning"]:
            return []

        _scan_cache["scanning"] = True

    try:
        return _do_scan(timeout)
    finally:
        with _lock:
            _scan_cache["scanning"] = False


def _do_scan(timeout: int) -> list:
    """Execute the actual scan."""
    backend = detect_backend()
    if backend == "nmcli":
        return _nmcli_scan(timeout)
    elif backend == "hostapd":
        return _iw_scan(timeout)
    return []


def connect_network(ssid: str, password: str, timeout: int = 30) -> dict:
    """Connect to an external WiFi network.

    Stops the AP first (Pi B+ has only one radio).

    Returns {"ok": True, "ip": str} or {"ok": False, "error": str}
    If connection fails and AP was active, restarts the AP.
    """
    # Check if AP was active (need to restart if connect fails)
    ap_was_active = ap_status().get("active", False)

    # Stop AP first (single radio constraint)
    if ap_was_active:
        log.info(f"Stopping AP to connect to WiFi network '{ssid}'")
        stop_result = stop_ap()
        if not stop_result.get("ok"):
            return {"ok": False, "error": "Failed to stop AP"}

    # Attempt to connect
    backend = detect_backend()
    if backend == "nmcli":
        result = _nmcli_connect(ssid, password, timeout)
    else:
        result = {"ok": False, "error": "No WiFi backend for connection"}

    if result.get("ok"):
        set_network_mode(MODE_WIFI_CLIENT)
        _invalidate_caches()

    # If connection failed and AP was active, restart AP
    if not result.get("ok") and ap_was_active:
        log.warning(f"Connection to '{ssid}' failed, restarting AP")
        start_ap()
        _invalidate_caches()

    return result


# ============================================================================
# nmcli Backend Helpers
# ============================================================================

def _nmcli_start_ap() -> dict:
    """Start AP using nmcli."""
    global _hotspot_active

    try:
        # Remove any existing connection with our name
        _run(["nmcli", "connection", "delete", AP_SSID], timeout=5)
    except Exception:
        pass

    # Create new AP connection
    # nmcli con add type wifi ifname wlan0 con-name SSID ssid SSID mode ap
    code, out, err = _run([
        "nmcli", "connection", "add",
        "type", "wifi",
        "ifname", "wlan0",
        "con-name", AP_SSID,
        "ssid", AP_SSID,
        "mode", "ap",
    ], timeout=10)

    if code != 0:
        msg = err.strip() or out.strip() or "Unknown error"
        log.error(f"Failed to create AP connection: {msg}")
        return {"ok": False, "error": msg}

    # Set WiFi band and channel
    _run(["nmcli", "connection", "modify", AP_SSID,
          "wifi.band", AP_BAND,
          "wifi.channel", str(AP_CHANNEL)], timeout=5)

    # Set IPv4 config
    _run(["nmcli", "connection", "modify", AP_SSID,
          "ipv4.method", "shared",
          "ipv4.addresses", f"{AP_IP}/24"], timeout=5)

    # Set password (WiFi security)
    _run(["nmcli", "connection", "modify", AP_SSID,
          "wifi-sec.key-mgmt", "wpa-psk",
          "wifi-sec.psk", AP_PASSWORD], timeout=5)

    # Activate the connection
    code, out, err = _run(["nmcli", "connection", "up", AP_SSID], timeout=10)

    if code != 0:
        msg = err.strip() or out.strip() or "Failed to activate"
        log.error(f"Failed to activate AP: {msg}")
        return {"ok": False, "error": msg}

    with _lock:
        _hotspot_active = True

    log.info(f"AP started: {AP_SSID} on {AP_IP}")
    return {
        "ok": True,
        "ssid": AP_SSID,
        "ip": AP_IP,
        "password": AP_PASSWORD,
        "backend": "nmcli",
    }


def _nmcli_stop_ap() -> dict:
    """Stop AP using nmcli."""
    code, out, err = _run(["nmcli", "connection", "down", AP_SSID], timeout=5)

    if code != 0:
        msg = err.strip() or out.strip() or "Unknown error"
        log.warning(f"Failed to deactivate AP: {msg}")
        # Try to delete the connection anyway

    # Delete the connection
    code, _, _ = _run(["nmcli", "connection", "delete", AP_SSID], timeout=5)

    log.info("AP stopped")
    return {"ok": True}


def _nmcli_connection_exists(name: str) -> bool:
    code, out, _ = _run(
        ["nmcli", "-t", "-f", "NAME", "connection", "show"],
        timeout=5
    )
    if code != 0:
        return False
    return name in {_split_nmcli_line(line)[0] for line in out.splitlines() if line}


def _nmcli_saved_connections() -> set:
    code, out, _ = _run(
        ["nmcli", "-t", "-f", "NAME,TYPE", "connection", "show"],
        timeout=5
    )
    if code != 0:
        return set()
    saved = set()
    for line in out.splitlines():
        parts = _split_nmcli_line(line)
        if len(parts) >= 2 and parts[1] == "802-11-wireless":
            saved.add(parts[0])
    return saved


def _nmcli_scan(timeout: int) -> list:
    """Scan for networks using nmcli."""
    code, out, _ = _run([
        "nmcli", "-t", "--escape", "yes", "-f",
        "SSID,SIGNAL,SECURITY,FREQ,IN-USE",
        "device", "wifi", "list",
        "--rescan", "yes"
    ], timeout=timeout)

    if code != 0:
        log.warning("nmcli scan failed")
        return []

    saved_connections = _nmcli_saved_connections()
    networks_by_ssid = {}
    for line in out.strip().split("\n"):
        if not line:
            continue
        parts = _split_nmcli_line(line)
        if len(parts) >= 4:
            ssid = parts[0].strip()
            try:
                signal = int(parts[1].strip())
            except ValueError:
                signal = 0
            security = parts[2].strip()
            freq = parts[3].strip() if len(parts) > 3 else ""
            active = len(parts) > 4 and parts[4].strip() == "*"

            if ssid:  # Skip hidden networks
                existing = networks_by_ssid.get(ssid)
                if existing and existing.get("signal", 0) >= signal:
                    continue
                networks_by_ssid[ssid] = {
                    "ssid": ssid,
                    "signal": signal,
                    "secured": bool(security) and security != "--",
                    "security": security if security and security != "--" else "",
                    "freq": freq,
                    "saved": ssid in saved_connections,
                    "active": active,
                }

    # Sort by signal (descending)
    networks = list(networks_by_ssid.values())
    networks.sort(key=lambda x: x["signal"], reverse=True)

    with _lock:
        _scan_cache["networks"] = networks
        _scan_cache["timestamp"] = time.time()

    return networks


def _nmcli_connect(ssid: str, password: str, timeout: int) -> dict:
    """Connect to a WiFi network using nmcli."""
    # Create or activate connection. Empty password supports open networks.
    args = ["nmcli", "device", "wifi", "connect", ssid]
    if password:
        args.extend(["password", password])

    code, out, err = _run(args, timeout=timeout)

    if code != 0:
        msg = err.strip() or out.strip() or "Connection failed"
        log.warning(f"Failed to connect to '{ssid}': {msg}")
        return {"ok": False, "mode": get_network_mode(), "ssid": ssid, "error": msg}

    _run(["nmcli", "connection", "modify", ssid, "connection.autoconnect", "yes"], timeout=5)

    # Get IP address
    time.sleep(1)  # Wait for DHCP
    ip = _get_ip_address()

    log.info(f"Connected to '{ssid}' with IP {ip}")
    return {
        "ok": True,
        "mode": MODE_WIFI_CLIENT,
        "ssid": ssid,
        "ip": ip or "unknown",
        "saved": True,
    }


# ============================================================================
# hostapd Backend Helpers (Bullseye fallback)
# ============================================================================

def _hostapd_start_ap() -> dict:
    """Start AP using hostapd + dnsmasq (Bullseye fallback)."""
    log.warning("hostapd backend not fully implemented yet")
    return {"ok": False, "error": "hostapd backend not implemented"}


def _hostapd_stop_ap() -> dict:
    """Stop AP using hostapd + dnsmasq."""
    return {"ok": False, "error": "hostapd backend not implemented"}


def _iw_scan(timeout: int) -> list:
    """Scan using iw command (for hostapd backend)."""
    return []


# ============================================================================
# Helper Functions
# ============================================================================

def _get_ip_address() -> Optional[str]:
    """Get the current IP address of wlan0."""
    try:
        code, out, _ = _run(
            ["ip", "-4", "addr", "show", "wlan0"],
            timeout=2
        )
        if code == 0:
            # Look for "inet 192.168.x.x/" pattern
            match = re.search(r"inet\s+(\d+\.\d+\.\d+\.\d+)", out)
            if match:
                return match.group(1)
    except Exception:
        pass
    return None


def _get_wifi_signal() -> Optional[int]:
    """Get WiFi signal strength in dBm."""
    try:
        code, out, _ = _run(
            ["nmcli", "-t", "-f", "SIGNAL", "device", "wifi", "show"],
            timeout=2
        )
        if code == 0:
            lines = out.strip().split("\n")
            if lines:
                try:
                    return int(lines[0].strip())
                except ValueError:
                    pass
    except Exception:
        pass
    return None


def start_background_monitor():
    """Start background monitoring of WiFi/AP state.

    Periodically checks:
    - If AP is active and uplink appears, stops AP
    - If AP is inactive and uplink disappears, starts AP

    Call this once at app startup.
    """
    def monitor_loop():
        last_state = None
        while True:
            try:
                time.sleep(30)  # Check every 30 seconds

                current_connected = has_uplink_connection()
                ap_active = ap_status().get("active", False)
                mode = get_network_mode()

                # If AP is active and uplink appeared, stop AP
                if ap_active and current_connected and mode != MODE_HOTSPOT_ONLY:
                    log.info("Uplink reconnected, stopping AP")
                    stop_ap()

                # If AP is inactive and uplink disappeared, start AP
                elif not ap_active and mode == MODE_HOTSPOT_ONLY:
                    log.info("Hotspot-only mode active, starting AP")
                    start_ap()

                elif not ap_active and not current_connected and last_state != current_connected:
                    log.info("Uplink lost, starting AP")
                    start_ap()

                last_state = current_connected

            except Exception as e:
                log.warning(f"Monitor error: {e}")

    thread = threading.Thread(target=monitor_loop, daemon=True)
    thread.start()
    log.info("WiFi monitor thread started")
