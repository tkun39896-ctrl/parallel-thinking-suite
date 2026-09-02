#!/bin/zsh
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" || ! -x /usr/bin/security ]]; then
  print -r -- "This setup script requires macOS Keychain."
  exit 2
fi

pt_service="parallel-thinking-suite.openrouter"
pt_account="$(id -un)"
pt_secrets_file="${HOME:?}/.zsh_secrets"
pt_marker_start="# >>> parallel-thinking-suite OpenRouter Keychain >>>"
pt_marker_end="# <<< parallel-thinking-suite OpenRouter Keychain <<<"

if [[ "${1:-}" == "--stdin" ]]; then
  pt_openrouter_key="$(/bin/cat)"
elif [[ "${1:-}" == "--clipboard" ]]; then
  pt_openrouter_key="$(/usr/bin/pbpaste)"
else
  if ! pt_openrouter_key="$(/usr/bin/osascript \
    -e 'tell application "System Events" to activate' \
    -e 'set keyDialog to display dialog "Paste the complete OpenRouter API Key. It should start with sk-or-v1-." default answer "" with hidden answer buttons {"Cancel", "Save to Keychain"} default button "Save to Keychain" cancel button "Cancel" with title "Parallel Thinking — OpenRouter"' \
    -e 'text returned of keyDialog')"; then
    print -r -- "Cancelled; nothing changed."
    exit 3
  fi
fi
if [[ -z "$pt_openrouter_key" ]]; then
  print -r -- "No key received; nothing changed."
  exit 3
fi

if [[ "$pt_openrouter_key" != sk-or-v1-* || "$pt_openrouter_key" == *[[:space:]]* ]]; then
  unset pt_openrouter_key
  print -r -- "Invalid OpenRouter API Key format; nothing changed."
  print -r -- "Copy the complete key shown once by OpenRouter (it starts with sk-or-v1-) and run this script again."
  exit 4
fi

/usr/bin/security add-generic-password \
  -U \
  -a "$pt_account" \
  -s "$pt_service" \
  -w "$pt_openrouter_key"
unset pt_openrouter_key
if [[ "${1:-}" == "--clipboard" ]]; then
  /usr/bin/printf '' | /usr/bin/pbcopy
fi

if ! /usr/bin/security find-generic-password -a "$pt_account" -s "$pt_service" >/dev/null 2>&1; then
  print -r -- "Keychain verification failed; shell metadata was not changed."
  exit 5
fi

umask 077
touch "$pt_secrets_file"
chmod 600 "$pt_secrets_file"
pt_temp_file="$(mktemp "${TMPDIR:-/tmp}/parallel-thinking-zsh-secrets.XXXXXX")"
trap 'rm -f "$pt_temp_file"' EXIT

awk -v start="$pt_marker_start" -v end="$pt_marker_end" '
  $0 == start { skipping = 1; next }
  $0 == end { skipping = 0; next }
  skipping { next }
  /^[[:space:]]*(export[[:space:]]+)?OPENROUTER_API_KEY[[:space:]]*=/ { next }
  { print }
' "$pt_secrets_file" > "$pt_temp_file"

printf '\n%s\n' "$pt_marker_start" >> "$pt_temp_file"
printf 'export PARALLEL_THINK_OPENROUTER_KEYCHAIN_SERVICE=%q\n' "$pt_service" >> "$pt_temp_file"
printf 'export PARALLEL_THINK_OPENROUTER_KEYCHAIN_ACCOUNT=%q\n' "$pt_account" >> "$pt_temp_file"
printf '%s\n' "$pt_marker_end" >> "$pt_temp_file"

chmod 600 "$pt_temp_file"
mv "$pt_temp_file" "$pt_secrets_file"
trap - EXIT

print -r -- "OpenRouter credential saved to macOS Keychain."
print -r -- "Non-secret Keychain metadata saved to $pt_secrets_file."
print -r -- "parallel-thinking-suite will reuse it on future service starts."
