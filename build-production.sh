#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$repo_root"

browsers="${LES_BUILD_BROWSERS:-chrome}"
version_increment="${LES_VERSION_INCREMENT:-patch}"

if ! command -v node >/dev/null 2>&1 && command -v brew >/dev/null 2>&1; then
	node_prefix="$(brew --prefix node@22 2>/dev/null || true)"
	if [[ -x "$node_prefix/bin/node" ]]; then
		export PATH="$node_prefix/bin:$PATH"
	fi
fi

if ! command -v node >/dev/null 2>&1 || ! command -v yarn >/dev/null 2>&1; then
	printf 'Node.js and Yarn are required to build LES.\n' >&2
	exit 1
fi

yarn build --increment-version "$version_increment" --browsers="$browsers" "$@"

printf 'Production package directory: %s/dist/zip/\n' "$repo_root"
