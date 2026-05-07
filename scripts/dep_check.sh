# Constants
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

printf "\n${RED}Installing System Requirements and Bluetooth Requirements...${NC}\n\n"
# Bluetooth + Sys Reqs
sudo apt install libbluetooth-dev bluez bluez-tools bluez-firmware libgirepository1.0-dev gcc libcairo2-dev pkg-config python3-dev gir1.2-gtk-3.0 -y

printf "\n${CYAN}Checking for NetworkManager (WiFi AP management)...${NC}\n"
if ! systemctl is-active --quiet NetworkManager 2>/dev/null; then
  printf "${RED}NetworkManager not found. Installing...${NC}\n"
  sudo apt install -y network-manager
  sudo systemctl enable NetworkManager
  sudo systemctl start NetworkManager
  printf "${CYAN}NetworkManager installed and started.${NC}\n"
else
  printf "${CYAN}NetworkManager is already active.${NC}\n"
fi
