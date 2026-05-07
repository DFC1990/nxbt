#!/bin/bash
# NXBT WiFi Hotspot + Mobile UI - Update Script
# Führt alle notwendigen Schritte durch, um das Update zu installieren
# Verwendung: bash update.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m'

# Konfiguration
# Nutze das Verzeichnis, in dem dieses Skript liegt, als Repo-Verzeichnis
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
VENV_PATH="$HOME/nxbt-env"
SERVICE_NAME="nxbt"
CURRENT_USER=$(whoami)

# Helper-Funktionen
log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_header() {
    echo ""
    echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
    echo -e "${BLUE}║  NXBT WiFi Hotspot Update${NC}"
    echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
    echo ""
}

print_step() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

confirm() {
    local prompt="$1"
    local response
    read -p "$(echo -e ${YELLOW}$prompt${NC})" -n 1 -r
    echo
    [[ $REPLY =~ ^[Jj]$ ]]
}

# ============================================================================
# Checks
# ============================================================================

print_header

log_info "Starte NXBT Update..."
log_info "Benutzer: $CURRENT_USER"
log_info "Repo-Verzeichnis: $REPO_DIR"
log_info "Virtualenv: $VENV_PATH"
echo ""

# Prüfe ob Repo existiert
if [ ! -d "$REPO_DIR" ]; then
    log_error "Repo nicht gefunden: $REPO_DIR"
    exit 1
fi

# Prüfe ob virtualenv existiert
if [ ! -f "$VENV_PATH/bin/activate" ]; then
    log_error "Virtualenv nicht gefunden: $VENV_PATH"
    log_info "Bitte erst virtualenv erstellen:"
    echo "  python3 -m venv ~/nxbt-env"
    exit 1
fi

log_success "Alle Voraussetzungen vorhanden"

# ============================================================================
# Step 1: Git Pull
# ============================================================================

print_step "Schritt 1: Repository aktualisieren (git pull)"

cd "$REPO_DIR"

# Prüfe ob Git installiert
if ! command -v git &> /dev/null; then
    log_error "Git nicht installiert!"
    exit 1
fi

# Prüfe ob wir in einem Git-Repo sind
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "Kein Git-Repository!"
    exit 1
fi

# Git pull
log_info "Ziehe Updates von master..."
git pull origin master
log_success "Git pull erfolgreich"

# ============================================================================
# Step 2: Virtualenv aktivieren
# ============================================================================

print_step "Schritt 2: Python Virtualenv aktivieren"

source "$VENV_PATH/bin/activate"
log_success "Virtualenv aktiviert"
log_info "Python: $(python3 --version)"
log_info "pip: $(pip --version)"

# ============================================================================
# Step 3: System Dependencies
# ============================================================================

print_step "Schritt 3: System-Abhängigkeiten prüfen"

log_info "Führe dep_check.sh aus..."
if [ -f "$REPO_DIR/scripts/dep_check.sh" ]; then
    bash "$REPO_DIR/scripts/dep_check.sh"
    log_success "System-Dependencies geprüft"
else
    log_warning "dep_check.sh nicht gefunden"
fi

# ============================================================================
# Step 4: Python Packages installieren
# ============================================================================

print_step "Schritt 4: Python-Pakete installieren"

log_info "Installiere nxbt mit neuen Abhängigkeiten..."
cd "$REPO_DIR"
pip install -e . --upgrade

log_success "Pakete installiert"
log_info "Neue Packages: Flask-Limiter (Rate Limiting), eventlet 0.37+ (Python 3.12+ Support)"

# ============================================================================
# Step 4b: Security Setup (Secrets & Directories)
# ============================================================================

print_step "Schritt 4b: Sicherheits-Setup"

log_info "Erstelle ~/.nxbt Verzeichnisse..."
mkdir -p ~/.nxbt/macros
chmod 700 ~/.nxbt
chmod 700 ~/.nxbt/macros
log_success "Verzeichnisse erstellt mit sicheren Permissions"

log_info "Alte secrets.txt wird ignoriert (neue Version nutzt ~/.nxbt/secrets)"
if [ -f "$REPO_DIR/nxbt/web/secrets.txt" ]; then
  log_warning "Alte secrets.txt sollte manuell gelöscht werden: rm $REPO_DIR/nxbt/web/secrets.txt"
fi

# ============================================================================
# Step 5: Systemd Service aktualisieren
# ============================================================================

print_step "Schritt 5: Systemd Service aktualisieren"

SERVICE_SRC="$REPO_DIR/nxbt.service.example"
SERVICE_DEST="/etc/systemd/system/nxbt.service"

if [ ! -f "$SERVICE_SRC" ]; then
    log_error "Service-Template nicht gefunden: $SERVICE_SRC"
    exit 1
fi

log_info "Kopiere Service-Datei..."
log_warning "Dies erfordert sudo-Rechte!"

if sudo cp "$SERVICE_SRC" "$SERVICE_DEST"; then
    log_success "Service-Datei kopiert"
else
    log_error "Service-Datei konnte nicht kopiert werden"
    exit 1
fi

# Zeige aktuelle Service-Config
echo ""
log_info "Aktuelle Service-Konfiguration:"
echo ""
grep -E "User=|ExecStart=|MemoryMax=" "$SERVICE_DEST" || true
echo ""

# Prüfe ob User/ExecStart angepasst werden müssen
log_warning "WICHTIG: Bitte prüfe die Service-Datei!"
log_info "Bearbeite die Datei mit:"
echo "  sudo nano $SERVICE_DEST"
echo ""
echo "Prüfe/ändere diese Zeilen:"
echo "  - User=dfernandez (oder dein Benutzer: $CURRENT_USER)"
echo "  - ExecStart=/home/dfernandez/nxbt-env/bin/nxbt ... (dein virtualenv Pfad)"
echo ""

if ! confirm "Service-Datei bereits angepasst? (j/n) "; then
    log_warning "Bitte Service-Datei anpassen und dann erneut ausführen:"
    echo "  sudo nano $SERVICE_DEST"
    echo "  bash update.sh"
    exit 0
fi

# ============================================================================
# Step 6: Systemd reload und restart
# ============================================================================

print_step "Schritt 6: Systemd Service neu laden und starten"

log_info "Lade Systemd-Konfiguration neu..."
if sudo systemctl daemon-reload; then
    log_success "Systemd reload erfolgreich"
else
    log_error "Systemd reload fehlgeschlagen"
    exit 1
fi

log_info "Aktiviere Service zum Auto-Start..."
if sudo systemctl enable $SERVICE_NAME; then
    log_success "Service aktiviert"
else
    log_error "Service konnte nicht aktiviert werden"
    exit 1
fi

log_info "Starte Service neu..."
if sudo systemctl restart $SERVICE_NAME; then
    log_success "Service neu gestartet"
else
    log_error "Service konnte nicht gestartet werden"
    exit 1
fi

# ============================================================================
# Step 7: Status prüfen
# ============================================================================

print_step "Schritt 7: Status prüfen"

sleep 2

log_info "Service-Status:"
sudo systemctl status $SERVICE_NAME --no-pager || true

echo ""
log_info "Letzte 10 Log-Zeilen:"
journalctl -u $SERVICE_NAME -n 10 --no-pager || true

# ============================================================================
# Fertig
# ============================================================================

print_step "Update fertig! ✅"

echo ""
log_success "NXBT erfolgreich aktualisiert!"
echo ""
echo "Nächste Schritte:"
echo "  1. Warte 3-5 Sekunden, bis der Hotspot aktiv wird"
echo "  2. Verbinde dein Handy mit WLAN 'NXBT-CONTROL' (Passwort: nxbt1234)"
echo "  3. Öffne http://192.168.4.1:8000/mobile im Browser"
echo ""
echo "Logs live anschauen:"
echo "  journalctl -u nxbt -f"
echo ""
echo "🆕 Neue Features in dieser Version:"
echo "  ✓ Mobile UI mit vollständigem Makro-Manager"
echo "  ✓ Virtual Gamepad zum direkten Steuern"
echo "  ✓ WiFi Hotspot Auto-Connect"
echo "  ✓ Rate Limiting & Security Fixes"
echo "  ✓ Secrets in ~/.nxbt/ (sicherer)"
echo ""

# ============================================================================
# Optional: Captive Portal Setup
# ============================================================================

echo ""
log_info "Möchtest du auch Captive Portal einrichten?"
echo "Damit werden ALLE URLs (z.B. google.com) automatisch zu der Mobile-UI geleitet."
echo ""

if confirm "Captive Portal jetzt einrichten? (j/n) "; then
    echo ""
    print_step "Richte Captive Portal ein..."

    if sudo bash "$REPO_DIR/setup-captive-portal.sh"; then
        log_success "Captive Portal eingerichtet!"
        echo ""
        echo "Jetzt kannst du:"
        echo "  - Verbinde dich mit 'NXBT-CONTROL' WiFi"
        echo "  - Gib JEDEN URL ein (z.B. google.com)"
        echo "  - Wird automatisch zu http://192.168.4.1:8000/mobile geleitet"
    else
        log_error "Captive Portal Setup fehlgeschlagen"
    fi
else
    log_info "Captive Portal Setup übersprungen."
    echo "Du kannst es später manuell einrichten:"
    echo "  sudo bash $REPO_DIR/setup-captive-portal.sh"
fi

echo ""
echo "Probleme? Siehe Plan-Datei im Repository für Details."
echo ""

deactivate  # Virtualenv deaktivieren
