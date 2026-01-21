# Deployment & Operations

## Overview

Kosarica is deployed to a single Hetzner VPS using **Docker-first deployment** with Kamal orchestration.

**Architecture:**
- Docker containers for all services (PostgreSQL, Node.js, Go price service, OpenTelemetry Collector, OpenObserve)
- Kamal for deployment orchestration
- OpenObserve for unified observability (logs + metrics + traces)

### Stack Decision

| Component | Tool | Purpose |
|-----------|------|---------|
| **Deployment** | Kamal | Zero-downtime deployments via Docker |
| **Orchestration** | Docker Compose | Local development and testing |
| **Observability** | OpenObserve | Single UI for logs, metrics, traces |
| **Telemetry** | OpenTelemetry Collector | Unified telemetry collection |
| **Containers** | Ubuntu 24.04 | Base image for all services |

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Hetzner VPS (Ubuntu 22.04)                     │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        Nginx (Port 80/443)                           │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                    │                                        │
│           ┌────────────────────────┼────────────────────────┐              │
│           ▼                        ▼                        ▼              │
│  ┌────────────────┐    ┌──────────────────┐    ┌────────────────────┐    │
│  │  Node.js App   │    │  Go Price Svc    │    │  PostgreSQL 16    │    │
│  │  :3000         │◄───│  :8080 (internal)│◄───│  :5432            │    │
│  │  OTel Metrics  │    │  OTel Metrics    │    │                    │    │
│  └────────────────┘    └──────────────────┘    └────────────────────┘    │
│           │                        │                                       │
│           └────────────────────────┼────────────────────────┐              │
│                                      ▼                        ▼              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                    OpenTelemetry Collector                          │   │
│  │  Receives OTLP logs/metrics → Sends to OpenObserve                  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                        OpenObserve                                  │   │
│  │  :5080 (UI)  │  Logs + Metrics + Traces + Dashboards + Alerts     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Provisioning (One-Time)

### 1. VPS Setup

Recommended specs:
- CPU: 4+ cores
- RAM: 8GB+
- Storage: 100GB+ SSD
- OS: Ubuntu 22.04 LTS

### 2. Install Docker and Kamal

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Install Kamal
npm install -g kamal

# Install nginx
sudo apt install nginx -y
```

### 3. Configure Firewall

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
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

### 5. Configure Environment Variables

Create `.env.production`:

```bash
# Database
POSTGRES_USER=kosarica
POSTGRES_PASSWORD=<strong-random-password>
POSTGRES_DB=kosarica

# Application
INTERNAL_API_KEY=<random-32-char-secret>
BETTER_AUTH_SECRET=<random-32-char-secret>
BETTER_AUTH_URL=https://your-domain.com
PASSKEY_RP_ID=your-domain.com
PASSKEY_RP_NAME=Kosarica

# Kamal
KAMAL_HOST=your-domain.com
GITHUB_USERNAME=<your-username>
KAMAL_REGISTRY_PASSWORD=<ghcr-token>

# OpenObserve
ZO_ROOT_USER_EMAIL=admin@kosarica.local
ZO_ROOT_USER_PASSWORD=<secure-password>

# Logging
LOG_LEVEL=info
```

## Deployment (Code Updates)

### Option A: Docker Compose (for initial setup/testing)

```bash
# Build and start all services
docker compose -f docker-compose.production.yml up -d

# View logs
docker compose -f docker-compose.production.yml logs -f

# Stop services
docker compose -f docker-compose.production.yml down
```

### Option B: Kamal (for production deployments)

```bash
# Initial setup
kamal setup

# Deploy all services
kamal deploy

# View logs
kamal app logs

# Rollback
kamal rollback

# Check status
kamal app status
```

### Build Docker Images

```bash
# Build Node.js image
docker build -t kosarica/nodejs:latest -f Dockerfile .

# Build Go service image
docker build -t kosarica/price-service:latest \
  -f services/price-service/deployment/Dockerfile \
  services/price-service/
```

### Push to Registry

```bash
# Tag images
docker tag kosarica/nodejs:latest ghcr.io/<username>/kosarica/nodejs:latest
docker tag kosarica/price-service:latest ghcr.io/<username>/kosarica/price-service:latest

# Push to registry
docker push ghcr.io/<username>/kosarica/nodejs:latest
docker push ghcr.io/<username>/kosarica/price-service:latest
```

## Observability

### OpenObserve Dashboard

Access at: `http://your-server:5080` (use firewall to restrict access)

Default credentials:
- Email: `admin@kosarica.local`
- Password: Set via `ZO_ROOT_USER_PASSWORD` env var

### Viewing Logs

```bash
# Via Docker Compose
docker compose -f docker-compose.production.yml logs -f nodejs
docker compose -f docker-compose.production.yml logs -f price-service

# Via Kamal
kamal app logs

# Via OpenObserve UI
# Stream: kosarica-logs
# Filter: service="kosarica-nodejs" OR service="price-service"
```

### Viewing Metrics

OpenObserve provides built-in dashboards for:
- CPU usage (via host metrics)
- Memory usage
- HTTP request metrics
- Custom application metrics

### Health Checks

```bash
# Node.js (exposed on port 3000)
curl http://localhost:3000/api/health

# Go service (internal only, via Docker network)
docker exec kosarica-price-service curl http://localhost:8080/health
docker exec kosarica-price-service curl http://localhost:8080/internal/health

# OpenObserve
curl http://localhost:5080/health
```

## Maintenance Runbooks

### Database Backup

#### Daily Backup (via cron)

```bash
# /home/kosarica/backup.sh
docker exec kosarica-postgres pg_dump -U kosarica kosarica | gzip > /home/kosarica/backups/kosarica_$(date +%Y%m%d).sql.gz
find /home/kosarica/backups -name "kosarica_*.sql.gz" -mtime +30 -delete
```

```bash
# Add to crontab
0 2 * * * /home/kosarica/backup.sh
```

#### Restore from Backup

```bash
gunzip < kosarica_20240121.sql.gz | docker exec -i kosarica-postgres psql -U kosarica kosarica
```

### Service Down

#### Diagnosis

```bash
# Check container status
docker ps -a

# Check logs
docker logs kosarica-nodejs
docker logs kosarica-price-service
docker logs kosarica-postgres

# Restart services
docker restart kosarica-nodejs
docker restart kosarica-price-service
```

#### Common Issues

| Issue | Solution |
|-------|----------|
| Container crash | Check logs: `docker logs <container>` |
| Port conflict | `docker ps` to see running containers |
| Out of memory | Check OpenObserve metrics dashboard |
| Database connection failed | `docker logs kosarica-postgres` |

### OpenObserve High Memory Usage

```bash
# Restart OpenObserve
docker restart kosarica-openobserve

# Check disk usage
docker exec kosarica-openobserve du -sh /data

# Clear old data if needed (via OpenObserve UI)
```

## Security Checklist

- [ ] Firewall configured (ufw) - only ports 80, 443 open
- [ ] SSL/TLS certificate installed (Let's Encrypt)
- [ ] INTERNAL_API_KEY is strong and random
- [ ] Database password is strong
- [ ] OpenObserve not accessible from internet (use SSH tunnel)
- [ ] Container non-root user configured
- [ ] Regular OS security updates applied
- [ ] Backup automation confirmed working
- [ ] Log rotation configured (Docker log driver)

## Container Operations

### View Container Stats

```bash
docker stats
```

### Execute Commands in Container

```bash
# Node.js container
docker exec -it kosarica-nodejs sh

# Go service container
docker exec -it kosarica-price-service sh

# PostgreSQL container
docker exec -it kosarica-postgres psql -U kosarica kosarica
```

### Update Container Image

```bash
# Pull new image
docker pull ghcr.io/<username>/kosarica/nodejs:latest

# Recreate container with new image
docker compose -f docker-compose.production.yml up -d --force-recreate nodejs
```

## Scaling Considerations

Current single-server deployment handles:
- ~10k concurrent users
- ~1M price records
- ~100 ingestion runs per day

If scaling needed:
1. Add external OpenObserve server (or managed service)
2. Separate PostgreSQL to managed service (e.g., AWS RDS)
3. Add read replicas for PostgreSQL
4. Consider Kubernetes for multi-container orchestration

## Additional Documentation

- [Docker Deployment Guide](./DEPLOYMENT-DOCKER.md) - Detailed Docker setup
- [Kamal Deployment Guide](./DEPLOYMENT-KAMAL.md) - Kamal-specific operations
- [Observability Guide](./OBSERVABILITY.md) - Monitoring and logging setup
- [Troubleshooting](./TROUBLESHOOTING.md) - Common issues and solutions
