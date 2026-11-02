#!/bin/bash
set -euo pipefail
version=8.30.1
sha256=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
work="${RUNNER_TEMP:-$(mktemp -d)}"
archive="${work}/gitleaks.tar.gz"
source_dir="${GITHUB_WORKSPACE:-.}"
curl -fsSL -o "${archive}" "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz"
echo "${sha256}  ${archive}" | sha256sum -c -
tar -xzf "${archive}" -C "${work}" gitleaks
"${work}/gitleaks" detect --source "${source_dir}" --redact --no-banner --exit-code 1
