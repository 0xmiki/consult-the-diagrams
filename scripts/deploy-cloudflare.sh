#!/usr/bin/env bash

set -euo pipefail

project_root="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
secrets_dir="$(mktemp -d /tmp/consult-the-diagrams-secrets.XXXXXX)"
secrets_file="$secrets_dir/production.env"

cleanup() {
	rm -f -- "$secrets_file"
	rmdir -- "$secrets_dir" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

umask 077
awk '/^(OPENAI_KEY|OPENAI_UNSLOP_SKILL_ID|OPENAI_MODEL|OPENAI_REASONING_EFFORT)=/' \
	"$project_root/.env" \
	"$project_root/.env.local" > "$secrets_file"

for key in OPENAI_KEY OPENAI_UNSLOP_SKILL_ID OPENAI_MODEL OPENAI_REASONING_EFFORT; do
	if ! grep -q "^${key}=." "$secrets_file"; then
		echo "Missing ${key} in .env or .env.local." >&2
		exit 1
	fi
done

cd "$project_root"
bun run build
bunx wrangler deploy --secrets-file "$secrets_file"
