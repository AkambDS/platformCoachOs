# CoachOS — Production Operations
# Usage: make <target>
# Requires: Docker installed, ubuntu user in docker group

export DOCKER_BUILDKIT=1
COMPOSE = docker compose -f docker-compose.prod.yml

# ── Status ────────────────────────────────────────────────────────────────────

status:
	$(COMPOSE) ps

# ── Start / Stop ──────────────────────────────────────────────────────────────

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart backend celery celery-beat

# ── Deploy (pull code + rebuild + restart) ────────────────────────────────────

# Full deploy — rebuilds everything including frontend on EC2 (slow on small instances)
deploy:
	git pull
	$(COMPOSE) build backend celery celery-beat
	$(COMPOSE) build frontend
	$(COMPOSE) up -d --force-recreate frontend
	$(COMPOSE) up -d

# Backend-only deploy — skips frontend build (fastest, use when only backend changed)
deploy-backend:
	git pull
	$(COMPOSE) build backend celery celery-beat
	$(COMPOSE) up -d

# Deploy frontend only — build locally, push dist to EC2 via rsync
# Usage from your Mac: make deploy-frontend HOST=ubuntu@<ec2-ip>
deploy-frontend:
	cd frontend && npm run build
	rsync -az --delete frontend/dist/ $(HOST):/home/ubuntu/coachos/frontend-dist/
	ssh $(HOST) "cd /home/ubuntu/coachos && docker compose -f docker-compose.prod.yml up -d --force-recreate frontend"

# Prune old Docker images/layers to free disk space (run periodically on EC2)
prune:
	docker system prune -f --volumes

# ── Logs ─────────────────────────────────────────────────────────────────────

logs:
	$(COMPOSE) logs -f --tail=100

logs-api:
	$(COMPOSE) logs backend -f --tail=100

logs-celery:
	$(COMPOSE) logs celery celery-beat -f --tail=100

logs-nginx:
	$(COMPOSE) logs nginx -f --tail=100

logs-all:
	$(COMPOSE) logs --since 72h -t > /tmp/coachos_logs_$(shell date +%Y%m%d_%H%M%S).txt
	@echo "Saved to /tmp/coachos_logs_*.txt"

# ── Django management ─────────────────────────────────────────────────────────

shell:
	$(COMPOSE) exec backend python manage.py shell

migrate:
	$(COMPOSE) exec backend python manage.py migrate

createsuperuser:
	$(COMPOSE) exec backend python manage.py createsuperuser

# ── Database backup ───────────────────────────────────────────────────────────

backup:
	$(COMPOSE) exec db pg_dump -U coachos coachos | gzip > backup_$(shell date +%Y%m%d_%H%M%S).sql.gz
	@echo "Backup saved."

.PHONY: status up down restart deploy logs logs-api logs-celery logs-nginx logs-all shell migrate createsuperuser backup
