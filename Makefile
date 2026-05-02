.PHONY: help build prod dev down logs clean

help: ## Show this help message
	@echo "Usage: make [command]"
	@echo ""
	@echo "Commands:"
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-15s %s\n", $$1, $$2}'

build: ## Build all Docker images without starting them
	docker compose build

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
