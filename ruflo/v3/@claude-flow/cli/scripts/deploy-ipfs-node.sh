#!/bin/bash
#
# Deploy IPFS Node to Google Cloud
# Provides free IPFS pinning for your users
#
# Usage:
#   ./deploy-ipfs-node.sh [PROJECT_ID] [ZONE]
#
# Example:
#   ./deploy-ipfs-node.sh my-project us-central1-a
#

set -e

PROJECT_ID="${1:-$(gcloud config get-value project)}"
ZONE="${2:-us-central1-a}"
INSTANCE_NAME="ipfs-node"
MACHINE_TYPE="e2-medium"  # $25/month, use e2-small for $8/month
DISK_SIZE="100GB"

echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  IPFS Node Deployment for Claude Flow                        ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Project: $PROJECT_ID"
echo "Zone: $ZONE"
echo "Machine: $MACHINE_TYPE"
echo "Disk: $DISK_SIZE"
echo ""

# Create firewall rules
echo "▶ Creating firewall rules..."
gcloud compute firewall-rules create ipfs-swarm \
  --project="$PROJECT_ID" \
  --allow=tcp:4001,udp:4001 \
  --target-tags=ipfs-node \
  --description="IPFS swarm connections" \
  2>/dev/null || echo "  (firewall rule already exists)"

gcloud compute firewall-rules create ipfs-api \
  --project="$PROJECT_ID" \
  --allow=tcp:5001 \
  --target-tags=ipfs-node \
  --source-ranges="0.0.0.0/0" \
  --description="IPFS API (consider restricting)" \
  2>/dev/null || echo "  (firewall rule already exists)"

gcloud compute firewall-rules create ipfs-gateway \
  --project="$PROJECT_ID" \
  --allow=tcp:8080 \
  --target-tags=ipfs-node \
  --description="IPFS Gateway" \
  2>/dev/null || echo "  (firewall rule already exists)"

# Create startup script
STARTUP_SCRIPT='#!/bin/bash
set -e

# Install IPFS
echo "Installing IPFS..."
wget -q https://dist.ipfs.tech/kubo/v0.24.0/kubo_v0.24.0_linux-amd64.tar.gz
tar xzf kubo_v0.24.0_linux-amd64.tar.gz
cd kubo && sudo bash install.sh
cd .. && rm -rf kubo kubo_v0.24.0_linux-amd64.tar.gz

# Create ipfs user
sudo useradd -m -s /bin/bash ipfs || true

# Initialize IPFS
sudo -u ipfs IPFS_PATH=/home/ipfs/.ipfs ipfs init --profile=server

# Configure IPFS for server use
sudo -u ipfs IPFS_PATH=/home/ipfs/.ipfs ipfs config Addresses.API /ip4/0.0.0.0/tcp/5001
sudo -u ipfs IPFS_PATH=/home/ipfs/.ipfs ipfs config Addresses.Gateway /ip4/0.0.0.0/tcp/8080
sudo -u ipfs IPFS_PATH=/home/ipfs/.ipfs ipfs config --json API.HTTPHeaders.Access-Control-Allow-Origin "[\"*\"]"
sudo -u ipfs IPFS_PATH=/home/ipfs/.ipfs ipfs config --json API.HTTPHeaders.Access-Control-Allow-Methods "[\"PUT\", \"POST\", \"GET\"]"

# Set storage limits (adjust as needed)
sudo -u ipfs IPFS_PATH=/home/ipfs/.ipfs ipfs config Datastore.StorageMax 80GB

# Create systemd service
cat > /etc/systemd/system/ipfs.service << EOF
[Unit]
Description=IPFS Daemon
After=network.target

[Service]
Type=simple
User=ipfs
Environment=IPFS_PATH=/home/ipfs/.ipfs
ExecStart=/usr/local/bin/ipfs daemon --migrate=true
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# Start IPFS
systemctl daemon-reload
systemctl enable ipfs
systemctl start ipfs

echo "IPFS node started successfully!"
'

# Create instance
echo "▶ Creating VM instance..."
gcloud compute instances create "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --machine-type="$MACHINE_TYPE" \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size="$DISK_SIZE" \
  --boot-disk-type=pd-ssd \
  --tags=ipfs-node \
  --metadata=startup-script="$STARTUP_SCRIPT"

# Get external IP
echo ""
echo "▶ Waiting for instance to start..."
sleep 30

EXTERNAL_IP=$(gcloud compute instances describe "$INSTANCE_NAME" \
  --project="$PROJECT_ID" \
  --zone="$ZONE" \
  --format='get(networkInterfaces[0].accessConfigs[0].natIP)')

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "                    DEPLOYMENT COMPLETE"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "  IPFS Node IP: $EXTERNAL_IP"
echo ""
echo "  Endpoints:"
echo "    API:     http://$EXTERNAL_IP:5001"
echo "    Gateway: http://$EXTERNAL_IP:8080"
echo "    Swarm:   /ip4/$EXTERNAL_IP/tcp/4001"
echo ""
echo "  Test commands:"
echo "    curl http://$EXTERNAL_IP:5001/api/v0/id"
echo "    curl http://$EXTERNAL_IP:8080/ipfs/QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG/readme"
echo ""
echo "  Configure Claude Flow CLI:"
echo "    export IPFS_API_URL=http://$EXTERNAL_IP:5001"
echo ""
echo "  SSH into node:"
echo "    gcloud compute ssh $INSTANCE_NAME --zone=$ZONE"
echo ""
echo "  Monthly cost estimate: ~\$25-54 depending on usage"
echo ""
