#!/bin/bash
# setup_linux_service.sh - Installs AI Studio Bridge as a systemd service

if [ "$EUID" -ne 0 ]; then
  echo "Please run as root (sudo ./setup_linux_service.sh)"
  exit 1
fi

# Get absolute path of the current directory (should be the server folder)
SERVER_DIR=$(pwd)
INDEX_JS="${SERVER_DIR}/src/index.js"

# Validate that we are in the correct directory
if [ ! -f "$INDEX_JS" ]; then
    echo "Error: Could not find src/index.js."
    echo "Make sure you are running this script from inside the 'server' folder."
    exit 1
fi

# Ensure Node is available
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
    echo "Error: Node.js is not installed or not in PATH."
    exit 1
fi

SERVICE_FILE="/etc/systemd/system/ai-bridge.service"

echo "Installing AI Bridge Service..."
echo "Node path: $NODE_PATH"
echo "Server dir: $SERVER_DIR"

cat << EOF > $SERVICE_FILE
[Unit]
Description=AI Studio Local LAN Bridge
After=network.target

[Service]
Type=simple
User=$SUDO_USER
WorkingDirectory=$SERVER_DIR
ExecStart=$NODE_PATH src/index.js
Restart=on-failure
RestartSec=5
# Increase memory limit if dealing with massive files
Environment="NODE_OPTIONS=--max-old-space-size=2048"

[Install]
WantedBy=multi-user.target
EOF

echo "Reloading systemd daemon..."
systemctl daemon-reload

echo "Enabling service to start on boot..."
systemctl enable ai-bridge.service

echo "Starting service..."
systemctl start ai-bridge.service

echo ""
echo "✅ Setup Complete!"
echo "You can check the status and LAN IP with: "
echo "  sudo systemctl status ai-bridge"
echo "To view live logs, use: "
echo "  journalctl -u ai-bridge -f"