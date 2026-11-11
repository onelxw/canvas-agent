#!/bin/sh
set -e

# Executed automatically by the official nginx image entrypoint through /docker-entrypoint.d/*.sh before nginx starts.
# Generate runtime config.js from environment variables. Each analytics provider has an independent variable;
# unset providers remain disabled, load no scripts, and send no external requests. Multiple providers may be enabled together.

# Keep the Docker-only upstream out of config.js and preserve nginx variables during substitution.
: "${NEW_API_UPSTREAM:?Set NEW_API_UPSTREAM to the New API internal origin (scheme://DNS-name:port)}"
if ! printf '%s\n' "$NEW_API_UPSTREAM" | grep -Eq '^https?://[A-Za-z0-9][A-Za-z0-9_.-]*:[0-9]+$'; then
    echo 'NEW_API_UPSTREAM must be an HTTP(S) origin with a DNS name and explicit port, without a path or trailing slash.' >&2
    exit 1
fi
envsubst '${NEW_API_UPSTREAM}' < /etc/nginx/canvas.conf.template > /etc/nginx/conf.d/default.conf

# GA4 and Baidu IDs contain only letters, numbers, and hyphens. Remove other characters
# so quotes and similar values cannot break the JavaScript strings in config.js as a defense-in-depth measure.
sanitize_id() {
    printf '%s' "$1" | tr -cd 'A-Za-z0-9-'
}

GA4_ID=$(sanitize_id "${ANALYTICS_GA4_ID:-}")
BAIDU_ID=$(sanitize_id "${ANALYTICS_BAIDU_ID:-}")

cat > /usr/share/nginx/html/config.js <<EOF
window.__RUNTIME_CONFIG__ = {
  ANALYTICS_GA4_ID: "${GA4_ID}",
  ANALYTICS_BAIDU_ID: "${BAIDU_ID}"
};
EOF
