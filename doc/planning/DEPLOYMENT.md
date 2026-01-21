# Deployment & Operations

## Overview

Kosarica is deployed to a single Hetzner VPS running:
- PostgreSQL 15+
- Node.js service (frontend + API)
- Go price service

## Provisioning (One-Time)

### 1. VPS Setup

Recommended specs:
- CPU: 4+ cores
- RAM: 8GB+
- Storage: 100GB+ SSD
- OS: Ubuntu 22.04 LTS

### 2. Install Dependencies

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install PostgreSQL 15
sudo apt install postgresql-15 postgresql-contrib-15

# Install Node.js 20 (via NodeSource)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Go 1.21+
wget https://go.dev/dl/go1.21.0.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.21.0.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc

# Install pnpm
npm install -g pnpm

# Install nginx
sudo apt install nginx -y

# Install git
sudo apt install git -y
```

### 3. PostgreSQL Configuration

```bash
# Create database and user
sudo -u postgres psql
```

```sql
CREATE DATABASE kosarica;
CREATE USER kosarica WITH ENCRYPTED PASSWORD 'your-password';
GRANT ALL PRIVILEGES ON DATABASE kosarica TO kosarica;
\q
```

### 4. Reverse Proxy (nginx)

```nginx
# /etc/nginx/sites-available/kosarica
server {
    listen 80;
    server_name your-domain.com;

    # Node.js frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # Go service (internal only - firewall this)
    location /internal/ {
        proxy_pass http://localhost:8080;
        internal;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/kosarica /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### 5. Systemd Services

Create `/etc/systemd/system/kosarica-node.service`:

```ini
[Unit]
Description=Kosarica Node.js Service
After=network.target postgresql.service

[Service]
Type=simple
User=kosarica
WorkingDirectory=/home/kosarica/app
Environment="NODE_ENV=production"
ExecStart=/usr/bin/node /home/kosarica/app/build/index.js
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Create `/etc/systemd/system/kosarica-go.service`:

```ini
[Unit]
Description=Kosarica Go Price Service
After=network.target postgresql.service

[Service]
Type=simple
User=kosarica
WorkingDirectory=/home/kosarica/app/services/price-service
Environment="DATABASE_URL=postgres://kosarica:password@localhost/kosarica"
Environment="PORT=8080"
ExecStart=/home/kosarica/app/services/price-service/price-service
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable kosarica-node kosarica-go
```

## Deployment (Code Updates)

### Build

```bash
# On local machine
pnpm build

# Build Go service
cd services/price-service
go build -o price-service cmd/server/main.go
```

### Deploy

```bash
# On server
cd /home/kosarica/app
git pull

# Run migrations
pnpm db:migrate

# Restart services
sudo systemctl restart kosarica-node kosarica-go
```

### Zero-Downtime Deployment

For production, use rolling restarts:

```bash
# Restart Go first (API will queue requests)
sudo systemctl restart kosarica-go
sleep 5

# Then restart Node
sudo systemctl restart kosarica-node
```

## Maintenance Runbooks

### Database Backup

#### Daily Backup (cron)

```bash
# /home/kosarica/backup.sh
pg_dump $DATABASE_URL | gzip > /home/kosarica/backups/kosarica_$(date +%Y%m%d).sql.gz
# Keep last 30 days
find /home/kosarica/backups -name "kosarica_*.sql.gz" -mtime +30 -delete
```

```bash
# Add to crontab
0 2 * * * /home/kosarica/backup.sh
```

#### Restore from Backup

```bash
gunzip < kosarica_20240121.sql.gz | psql $DATABASE_URL
```

### Database Migration Rollback

**Warning**: Drizzle does NOT support automatic rollback. Manual SQL is required.

```bash
# Before migration, backup!
pg_dump $DATABASE_URL > pre-migration-backup.sql

# If migration fails:
psql $DATABASE_URL < pre-migration-backup.sql
```

### Service Down

#### Diagnosis

```bash
# Check service status
sudo systemctl status kosarica-node
sudo systemctl status kosarica-go

# Check logs
sudo journalctl -u kosarica-node -n 100
sudo journalctl -u kosarica-go -n 100

# Check health endpoints
curl http://localhost:3000/api/health
curl http://localhost:8080/health
curl http://localhost:8080/internal/health
```

#### Common Issues

| Issue | Solution |
|-------|----------|
| Port already in use | `sudo lsof -i :3000` or `:8080` to find process |
| Database connection failed | Check PostgreSQL is running: `sudo systemctl status postgresql` |
| Out of memory | Check logs: `sudo journalctl -u kosarica-node --since "5 minutes ago"` |
| Go service panic | Check logs and restart: `sudo systemctl restart kosarica-go` |

### Circuit Breaker Open

When the Go service is unreachable, the circuit breaker opens:

```bash
# Check Go service status
sudo systemctl status kosarica-go

# Check Go service health
curl http://localhost:8080/internal/health

# If healthy, manual reset may be needed
# (Circuit breaker auto-resets after cooldown)
```

### PostgreSQL High CPU/Memory

```bash
# Check active connections
psql -U kosarica -d kosarica -c "SELECT count(*) FROM pg_stat_activity;"

# Check long-running queries
psql -U kosarica -d kosarica -c "SELECT pid, query, state FROM pg_stat_activity WHERE state != 'idle';"

# Kill hung query if needed
psql -U kosarica -d kosarica -c "SELECT pg_terminate_backend(pid);"
```

## Health Checks

### Node.js Service

```bash
curl http://localhost:3000/api/health
```

Expected response:
```json
{
  "status": "ok"
}
```

### Go Service

```bash
# Liveness (always 200 if running)
curl http://localhost:8080/health

# Readiness (includes DB check)
curl http://localhost:8080/internal/health
```

Expected response:
```json
{
  "status": "ok",
  "database": "connected"
}
```

### Monitoring

Set up external monitoring (UptimeRobot, Pingdom, etc.) for:
- `https://your-domain.com/api/health`
- `http://your-server-ip:8080/internal/health` (via VPN or SSH tunnel)

## Logs

### View Logs

```bash
# Node.js logs (real-time)
sudo journalctl -u kosarica-node -f

# Go service logs (real-time)
sudo journalctl -u kosarica-go -f

# Last 100 lines
sudo journalctl -u kosarica-node -n 100
sudo journalctl -u kosarica-go -n 100

# Logs since today
sudo journalctl -u kosarica-node --since "today"
sudo journalctl -u kosarica-go --since "today"
```

### Log Levels

Set via environment:

```bash
# Node.js
export LOG_LEVEL=debug  # or info, warn, error

# Go service
export PRICE_SERVICE_LOG_LEVEL=debug  # or info, warn, error
```

## Security Checklist

- [ ] Firewall configured (ufw) - only ports 80, 443 open
- [ ] SSL/TLS certificate installed (Let's Encrypt)
- [ ] INTERNAL_API_KEY is strong and random
- [ ] Database password is strong
- [ ] PostgreSQL only listens on localhost
- [ ] Go service not accessible from internet (firewall or nginx `internal` directive)
- [ ] Regular OS security updates applied
- [ ] Backup automation confirmed working
- [ ] Log rotation configured

## Environment Variables (Production)

```bash
# Node.js (.env.production)
DATABASE_URL=postgresql://kosarica:STRONG_PASSWORD@localhost/kosarica
INTERNAL_API_KEY=RANDOM_LONG_SECRET_KEY_HERE
BETTER_AUTH_SECRET=ANOTHER_RANDOM_32_CHAR_SECRET
BETTER_AUTH_URL=https://your-domain.com
PASSKEY_RP_ID=your-domain.com
PASSKEY_RP_NAME=Kosarica

# Go service
DATABASE_URL=postgresql://kosarica:STRONG_PASSWORD@localhost/kosarica
PORT=8080
INTERNAL_API_KEY=RANDOM_LONG_SECRET_KEY_HERE
PRICE_SERVICE_RATE_LIMIT_REQUESTS_PER_SECOND=2
```

## Scaling Considerations

Current single-server deployment handles:
- ~10k concurrent users
- ~1M price records
- ~100 ingestion runs per day

If scaling needed:
1. Add read replicas for PostgreSQL
2. Separate Go service to dedicated server
3. Add CDN for static assets
4. Consider managed PostgreSQL (e.g., AWS RDS)
