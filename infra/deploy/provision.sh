#!/usr/bin/env bash
#
# Prepares a fresh Ubuntu 24.04 droplet to run the demo.
#
# Idempotent: safe to re-run, which matters because the first attempt at this
# went through cloud-init and failed silently on a YAML parse error. Doing it
# over SSH instead means failures are visible while they happen.
#
# ASCII only. cloud-init rejected the earlier version of this file over a
# non-ASCII character in a comment, and nothing installed at all.
set -euo pipefail

log() { echo; echo "=== $* ==="; }

log "swap"
# The Next.js production build is the memory spike on a 2 GB box. Without swap
# the build gets OOM-killed part way through.
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

log "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  postgresql-16 postgresql-contrib-16 \
  nginx apache2-utils \
  certbot python3-certbot-nginx \
  git curl rsync ufw locales

log "locale"
# A real UTF-8 locale, never C or C.UTF-8 (ADR-011). Under a C ctype, non-ASCII
# characters are not letters, so Georgian full-text search and pg_trgm quietly
# return nothing and raise no error -- the deployment looks perfectly healthy.
locale-gen en_US.UTF-8
update-locale

log "node and pnpm"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
fi
npm install -g --silent pnpm@12 pm2

log "postgres"
systemctl enable --now postgresql
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='autoparts'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE USER autoparts WITH PASSWORD 'autoparts';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='autoparts'" | grep -q 1 \
  || sudo -u postgres createdb -O autoparts -E UTF8 \
       --lc-ctype=en_US.UTF-8 --lc-collate=en_US.UTF-8 -T template0 autoparts
# The migrations create these themselves and all four are "trusted" in PG13+,
# so the owner could do it. Done here as superuser anyway so a permissions
# surprise cannot stop migration 0001 on a fresh box.
sudo -u postgres psql -d autoparts -q -c \
  'CREATE EXTENSION IF NOT EXISTS pgcrypto;
   CREATE EXTENSION IF NOT EXISTS citext;
   CREATE EXTENSION IF NOT EXISTS pg_trgm;
   CREATE EXTENSION IF NOT EXISTS btree_gist;'

log "firewall"
# Only 80, 443 and SSH are reachable. The app's own ports stay on loopback, so
# nobody can talk to them directly and skip the password nginx holds.
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null

mkdir -p /srv/autoparts

log "versions"
node -v
pnpm -v
psql --version
nginx -v 2>&1
echo
echo "provisioned"
