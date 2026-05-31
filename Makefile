.PHONY: help build build-multiplatform setup-buildx prod dev down logs clean startup-diagnose

help: ## Show this help message
	@echo "Usage: make [command]"
	@echo ""
	@echo "Commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

setup-buildx: ## Register QEMU binfmt handlers for multi-platform builds
	docker run --rm --privileged tonistiigi/binfmt --install all

build: ## Build all Docker images for the host architecture
	docker compose build

build-multiplatform: setup-buildx ## Build multi-platform images (amd64 + arm64) for registry pushes
	docker compose -f docker-compose.yml -f docker-compose.multiplatform.yml build

prod: ## Start the project in Production mode (detached)
	docker compose up -d

dev: ## Start the project in Development mode (detached, rebuilds images)
	docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build -d

down: ## Stop and remove all containers
	docker compose down

logs: ## Stream logs from all containers
	docker compose logs -f

clean: ## Stop containers and remove all persistent volumes (Fresh start)
	docker compose down -v

startup-diagnose: ## Diagnose startup failures (healthchecks, dependencies, backend/frontend/db logs)
	@echo "== Compose service status =="
	docker compose ps
	@echo ""
	@echo "== Backend health state =="
	@docker inspect vertex-backend-1 --format '{{json .State.Health}}' 2> /dev/null || echo "backend container not found"
	@echo ""
	@echo "== Frontend health state =="
	@docker inspect vertex-frontend-1 --format '{{json .State.Health}}' 2> /dev/null || echo "frontend container has no healthcheck or not found"
	@echo ""
	@echo "== Backend recent logs =="
	docker compose logs --tail=120 backend
	@echo ""
	@echo "== Frontend recent logs =="
	docker compose logs --tail=120 frontend
	@echo ""
	@echo "== DB recent logs =="
	docker compose logs --tail=120 db
	@echo ""
	@echo "== Redis recent logs =="
	docker compose logs --tail=120 redis
