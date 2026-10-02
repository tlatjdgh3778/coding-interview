.DEFAULT_GOAL := dev

.PHONY: db dev stop reset-db logs local install check gen-ts gen-ts-docker check-gen-ts check-gen-ts-docker check-docker test-api test-e2e

DB_PORT ?= 5548
DATABASE_URL ?= postgres://dataroom_interview:dataroom_interview@127.0.0.1:$(DB_PORT)/dataroom_interview
export DB_PORT DATABASE_URL

db:
	docker compose up -d --wait --wait-timeout 60 db

dev:
	docker compose up -d --wait --wait-timeout 600
	@echo "Dataroom: http://localhost:$${WEB_PORT:-5178}"

stop:
	docker compose down

reset-db:
	docker compose down --remove-orphans
	@docker volume rm dataroom-interview_platform-pg-data >/dev/null 2>&1 || true
	@echo "Assignment database deleted. Run make dev to recreate it."

logs:
	docker compose logs -f

install:
	pnpm install --frozen-lockfile

local: db install
	pnpm dev

check: check-gen-ts
	pnpm lint
	pnpm typecheck
	pnpm build
	cargo fmt --manifest-path api/Cargo.toml -- --check
	cargo check --locked --manifest-path api/Cargo.toml --all-targets --all-features

gen-ts:
	sh scripts/gen-ts.sh

check-gen-ts:
	sh scripts/gen-ts.sh check

gen-ts-docker:
	sh scripts/gen-ts-docker.sh

check-gen-ts-docker:
	sh scripts/gen-ts-docker.sh check

check-docker: db check-gen-ts-docker
	docker compose run --rm --no-deps web sh -c 'pnpm lint && pnpm build'
	docker compose run --rm --no-deps api sh -c 'rustup component add rustfmt && cargo fmt --manifest-path api/Cargo.toml -- --check && cargo check --locked --manifest-path api/Cargo.toml --all-targets --all-features'

test-api: db
	docker compose run --rm --no-deps api cargo test --locked --manifest-path api/Cargo.toml --test dataroom_documents

test-e2e: dev
	docker compose --profile test run --rm --no-deps playwright
