# CoachOS Deployment Guide

## Option A: DigitalOcean Droplet (Recommended — $24/month)

### 1. Create Server
```bash
# On DigitalOcean, create a Droplet:
# - Image: Ubuntu 22.04 LTS
# - Size: 2 vCPUs, 4GB RAM (minimum)
# - Region: closest to your clients
# - Enable backups
```

### 2. Install Docker on Server
```bash
ssh root@YOUR_SERVER_IP

# Install Docker
curl -fsSL https://get.docker.com | sh
systemctl enable docker

# Install Docker Compose plugin
apt-get install -y docker-compose-plugin

# Create deploy user
adduser deploy
usermod -aG docker deploy
```

### 3. Point Your Domain
In your domain registrar (Namecheap, GoDaddy, etc.):
```
A record: @ → YOUR_SERVER_IP
A record: www → YOUR_SERVER_IP
```
Wait ~10 minutes for DNS propagation.

### 4. Set Up SSL Certificate
```bash
# On your server
apt install -y certbot
certbot certonly --standalone -d yourdomain.com -d www.yourdomain.com

# Certs will be at:
# /etc/letsencrypt/live/yourdomain.com/fullchain.pem
# /etc/letsencrypt/live/yourdomain.com/privkey.pem

# Link to nginx certs directory
mkdir -p /srv/coachos/nginx/certs
ln -s /etc/letsencrypt/live/yourdomain.com/fullchain.pem /srv/coachos/nginx/certs/fullchain.pem
ln -s /etc/letsencrypt/live/yourdomain.com/privkey.pem /srv/coachos/nginx/certs/privkey.pem

# Auto-renew SSL
crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet && docker restart coachos-nginx-1
```

### 5. Upload Code
```bash
# From your local machine
rsync -avz --exclude 'node_modules' --exclude '__pycache__' --exclude '.git' \
  ./coachos/ deploy@YOUR_SERVER_IP:/srv/coachos/
```

Or push to GitHub and pull on server:
```bash
git push origin main
ssh deploy@YOUR_SERVER_IP "cd /srv/coachos && git pull"
```

### 6. Configure Environment
```bash
ssh deploy@YOUR_SERVER_IP
cd /srv/coachos

# Copy and fill in production env
cp backend/.env.production.template backend/.env
nano backend/.env   # Fill in all values
```

### 7. Deploy
```bash
cd /srv/coachos

# Build and start all services
docker compose -f docker-compose.prod.yml up -d --build

# Check status
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f backend

# Create first admin user
docker compose -f docker-compose.prod.yml exec backend \
  python manage.py createsuperuser
```

### 8. Verify
- Visit https://yourdomain.com — CoachOS login page
- Visit https://yourdomain.com/admin — Django admin
- Visit https://yourdomain.com/api/schema/swagger-ui/ — API docs

---

## Option B: Railway (Easiest, ~$20/month)

Railway deploys directly from GitHub with minimal config.

### 1. Push to GitHub
```bash
git init && git add . && git commit -m "Initial CoachOS"
git remote add origin https://github.com/YOUR_USER/coachos.git
git push -u origin main
```

### 2. Deploy on Railway
1. Go to railway.app → New Project → Deploy from GitHub repo
2. Add services:
   - **Backend**: Root dir `backend`, Start command: `gunicorn config.wsgi:application --bind 0.0.0.0:$PORT`
   - **PostgreSQL**: Add plugin
   - **Redis**: Add plugin
   - **Frontend**: Root dir `frontend`, Build: `npm run build`, serve dist/

3. Add environment variables from `.env.production.template`
4. Railway provides a free SSL domain like `coachos-production.up.railway.app`

---

## Option C: Render (Free tier available)

1. Create `render.yaml` in repo root
2. Connect GitHub repo at render.com
3. Free PostgreSQL + Redis available

---

## Ongoing Operations

### Update the app
```bash
ssh deploy@YOUR_SERVER_IP
cd /srv/coachos
git pull
docker compose -f docker-compose.prod.yml up -d --build backend celery celery-beat frontend
```

### Backup database
```bash
docker compose -f docker-compose.prod.yml exec db \
  pg_dump -U coachos coachos > backup_$(date +%Y%m%d).sql
```

### View logs
```bash
# All services
docker compose -f docker-compose.prod.yml logs -f

# Just backend
docker compose -f docker-compose.prod.yml logs -f backend

# Just Celery
docker compose -f docker-compose.prod.yml logs -f celery
```

### Run Django management commands
```bash
docker compose -f docker-compose.prod.yml exec backend python manage.py shell
docker compose -f docker-compose.prod.yml exec backend python manage.py migrate
```

---

## Stripe Webhook Setup

After deployment, register your webhook in Stripe dashboard:
```
URL: https://yourdomain.com/api/stripe/webhook/
Events: invoice.payment_succeeded, invoice.payment_failed, charge.refunded
```

Copy the webhook signing secret → set `DJSTRIPE_WEBHOOK_SECRET` in backend/.env

---

## Cost Breakdown

| Service | Monthly |
|---------|---------|
| DigitalOcean 2CPU/4GB | $24 |
| Domain name | ~$1 |
| SendGrid (40k emails free) | $0 |
| Stripe (2.9% + 30¢/transaction) | Variable |
| S3 (minimal usage) | ~$1 |
| **Total fixed** | **~$26/month** |

Scale up to 4GB/2CPU ($48) when you have 50+ clients.
