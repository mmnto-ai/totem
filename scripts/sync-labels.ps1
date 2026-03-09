# Scripts requires GitHub CLI (gh) installed and authenticated.
# Run with: pwsh scripts/sync-labels.ps1

$REPO = "mmnto-ai/totem"

# 1. RENAME EXISTING LABELS (Preserves them on existing issues)
# gh label edit <old-name> --name <new-name> --color <hex> --description <desc>
Write-Host "Renaming and recoloring existing labels..." -ForegroundColor Cyan

# Types
gh label edit "bug" --name "type: bug" --color "d73a4a" --description "Something isn't working" --repo $REPO
gh label edit "enhancement" --name "type: feature" --color "a59758" --description "New feature or request" --repo $REPO
gh label edit "chore" --name "type: chore" --color "b1d3e7" --description "Maintenance, refactoring, or CI/CD" --repo $REPO
gh label edit "epic" --name "type: epic" --color "041b3f" --description "Large, multi-issue initiatives" --repo $REPO
gh label edit "documentation" --name "type: docs" --color "0075ca" --description "Improvements to documentation" --repo $REPO
gh label edit "security" --name "type: security" --color "ff0000" --description "Security vulnerabilities or hardening" --repo $REPO

# Priorities
gh label edit "P0" --name "priority: P0" --color "B60205" --description "Critical - drop everything and fix" --repo $REPO
gh label edit "P1" --name "priority: P1" --color "FF9F1C" --description "High priority - address this sprint" --repo $REPO
gh label edit "P2" --name "priority: P2" --color "45c461" --description "Medium priority - planned for near-term" --repo $REPO
gh label edit "P3" --name "priority: P3" --color "79ccdc" --description "Low priority - backlog" --repo $REPO

# Scopes / Domains
gh label edit "cli" --name "scope: cli" --color "de89ff" --description "Issues related to the CLI package" --repo $REPO
gh label edit "core" --name "scope: core" --color "de89ff" --description "Issues related to the Core engine package" --repo $REPO
gh label edit "mcp" --name "scope: mcp" --color "de89ff" --description "Issues related to the MCP server package" --repo $REPO
gh label edit "ci" --name "scope: ci" --color "32c597" --description "GitHub Actions, Turbo, or build pipelines" --repo $REPO
gh label edit "architecture" --name "domain: architecture" --color "1edb45" --description "System design and structural decisions" --repo $REPO
gh label edit "ux" --name "domain: ux" --color "1edb45" --description "Terminal UI, CLI output, and user experience" --repo $REPO

# Status / Meta
gh label edit "blocked" --name "status: blocked" --color "dda26d" --description "Blocked by external dependency" --repo $REPO
gh label edit "investigation" --name "status: investigation" --color "cfd3d7" --description "Research or spike" --repo $REPO

# Delete redundant or unused labels
Write-Host "Deleting redundant labels..." -ForegroundColor Yellow
gh label delete "feature" --yes --repo $REPO 2>$null
gh label delete "docs" --yes --repo $REPO 2>$null
gh label delete "design" --yes --repo $REPO 2>$null

Write-Host "Label taxonomy sync complete!" -ForegroundColor Green