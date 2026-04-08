#!/usr/bin/env bash
# scripts/configure_github_repo.sh
#
# Configura las variables del repositorio GitHub para el pipeline K6 QA.
# Requiere tener instalado y autenticado el CLI de GitHub (gh).
#
# Uso:
#   TARGET_REPO_URL=https://github.com/EGgames/HOTEL-MVP.git \
#   TARGET_REPO_BRANCH=dev \
#   bash scripts/configure_github_repo.sh
#
# Variables opcionales:
#   REPO_SLUG                  owner/repo (auto-detectado del git remote si se omite)
#   TARGET_REPO_URL            URL del repo backend a clonar y testear
#   TARGET_REPO_BRANCH         Rama del repo backend (por defecto: dev)
#   K6_QA_API_PORT             Puerto del backend (por defecto: 3100)
#   K6_QA_DB_PORT              Puerto de PostgreSQL (por defecto: 5540)
#   K6_FAILURE_ISSUES_ENABLED  Crear issues automáticos al fallar (por defecto: false)

set -euo pipefail

REPO_SLUG="${REPO_SLUG:-}"
TARGET_REPO_URL="${TARGET_REPO_URL:-https://github.com/EGgames/HOTEL-MVP.git}"
TARGET_REPO_BRANCH="${TARGET_REPO_BRANCH:-dev}"
K6_QA_API_PORT="${K6_QA_API_PORT:-3100}"
K6_QA_DB_PORT="${K6_QA_DB_PORT:-5540}"
K6_FAILURE_ISSUES_ENABLED="${K6_FAILURE_ISSUES_ENABLED:-false}"

# URL base que k6 usará para las peticiones (se puede sobrescribir)
K6_QA_BASE_URL="${K6_QA_BASE_URL:-http://127.0.0.1:${K6_QA_API_PORT}/api/v1}"

# Auto-detectar el slug del repo desde el remote origin si no fue provisto
if [[ -z "$REPO_SLUG" ]]; then
  origin_url="$(git remote get-url origin 2>/dev/null || echo '')"
  if [[ -z "$origin_url" ]]; then
    printf 'ERROR: No se pudo detectar el remote origin. Especifica REPO_SLUG manualmente.\n' >&2
    exit 1
  fi
  # Soporta HTTPS y SSH
  REPO_SLUG="${origin_url#https://github.com/}"
  REPO_SLUG="${REPO_SLUG#git@github.com:}"
  REPO_SLUG="${REPO_SLUG%.git}"
fi

printf 'Configurando variables para el repositorio: %s\n\n' "$REPO_SLUG"

gh variable set K6_TARGET_REPO_URL       --repo "$REPO_SLUG" --body "$TARGET_REPO_URL"
gh variable set K6_TARGET_REPO_BRANCH    --repo "$REPO_SLUG" --body "$TARGET_REPO_BRANCH"
gh variable set K6_QA_API_PORT           --repo "$REPO_SLUG" --body "$K6_QA_API_PORT"
gh variable set K6_QA_DB_PORT            --repo "$REPO_SLUG" --body "$K6_QA_DB_PORT"
gh variable set K6_QA_BASE_URL           --repo "$REPO_SLUG" --body "$K6_QA_BASE_URL"
gh variable set K6_FAILURE_ISSUES_ENABLED --repo "$REPO_SLUG" --body "$K6_FAILURE_ISSUES_ENABLED"

printf '\nVariables configuradas en %s:\n' "$REPO_SLUG"
printf '  K6_TARGET_REPO_URL        = %s\n' "$TARGET_REPO_URL"
printf '  K6_TARGET_REPO_BRANCH     = %s\n' "$TARGET_REPO_BRANCH"
printf '  K6_QA_API_PORT            = %s\n' "$K6_QA_API_PORT"
printf '  K6_QA_DB_PORT             = %s\n' "$K6_QA_DB_PORT"
printf '  K6_QA_BASE_URL            = %s\n' "$K6_QA_BASE_URL"
printf '  K6_FAILURE_ISSUES_ENABLED = %s\n' "$K6_FAILURE_ISSUES_ENABLED"
