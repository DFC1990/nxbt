#!/bin/bash
# Setup Captive Portal für NXBT Hotspot
# Macht dnsmasq zur DNS-Umleitung für alle Domains auf 192.168.4.1
#
# Verwendung: sudo bash setup-captive-portal.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;36m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

log_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

log_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Prüfe ob root
if [ "$EUID" -ne 0 ]; then
    log_error "Dieses Skript muss als root ausgeführt werden"
    echo "Verwende: sudo bash setup-captive-portal.sh"
    exit 1
fi

echo ""
echo -e "${BLUE}╔════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  NXBT Captive Portal Setup${NC}"
echo -e "${BLUE}╚════════════════════════════════════════╝${NC}"
echo ""

# Get repo dir
REPO_DIR="$(cd "$(dirname "$0")" && pwd)"

log_info "Repo-Verzeichnis: $REPO_DIR"
log_info "Konfiguriert dnsmasq für Captive Portal..."
echo ""

# 1. Installiere dnsmasq
log_info "Prüfe dnsmasq..."
if ! command -v dnsmasq &> /dev/null; then
    log_info "Installiere dnsmasq..."
    apt update
    apt install -y dnsmasq
    log_success "dnsmasq installiert"
else
    log_success "dnsmasq schon installiert"
fi

# 2. Kopiere Config
CONFIG_SRC="$REPO_DIR/nxbt-hotspot-dns.conf"
CONFIG_DEST="/etc/dnsmasq.d/nxbt-hotspot.conf"

if [ ! -f "$CONFIG_SRC" ]; then
    log_error "Config nicht gefunden: $CONFIG_SRC"
    exit 1
fi

log_info "Kopiere dnsmasq Konfiguration..."
cp "$CONFIG_SRC" "$CONFIG_DEST"
log_success "Konfiguration installiert: $CONFIG_DEST"

# 3. Starte dnsmasq
log_info "Starte dnsmasq neu..."
systemctl restart dnsmasq
log_success "dnsmasq neu gestartet"

# 4. Enable dnsmasq
log_info "Aktiviere dnsmasq zum Auto-Start..."
systemctl enable dnsmasq
log_success "dnsmasq Auto-Start aktiviert"

# 5. Prüfe Status
echo ""
log_info "dnsmasq Status:"
systemctl status dnsmasq --no-pager || true

echo ""
log_success "Captive Portal Setup fertig! 🎉"
echo ""
echo "Ab jetzt:"
echo "  - Verbinde dich mit WiFi 'NXBT-CONTROL'"
echo "  - Gib JEDEN URL im Browser ein (z.B. google.com, facebook.com)"
echo "  - Du wirst automatisch zu http://192.168.4.1:8000/mobile geleitet"
echo ""
echo "Wenn du das zurückdrehen willst:"
echo "  sudo rm /etc/dnsmasq.d/nxbt-hotspot.conf"
echo "  sudo systemctl restart dnsmasq"
echo ""
