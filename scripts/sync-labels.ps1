# Scripts requires GitHub CLI (gh) installed and authenticated.
# Run with: pwsh scripts/sync-labels.ps1

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "[Error] GitHub CLI (gh) not found. Install from https://cli.github.com/ and authenticate." -ForegroundColor Red
    exit 1
}

$REPO = "mmnto-ai/totem"

function Merge-Label {
    param($OldName, $NewName)
    Write-Host "Merging '$OldName' into '$NewName'..." -ForegroundColor Cyan
    # Get issues with the old label
    $issues = gh issue list --label $OldName --repo $REPO --state all --json number --jq '.[].number' | Out-String
    $issueNumbers = $issues -split '\s+' | Where-Object { $_ -ne '' }
    
    foreach ($num in $issueNumbers) {
        Write-Host "  Updating issue #$num"
        gh issue edit $num --add-label $NewName --remove-label $OldName --repo $REPO
    }
    
    # Try deleting the old label
    gh label delete $OldName --yes --repo $REPO 2>$null
}

Write-Host "Updating canonical labels..." -ForegroundColor Yellow

# Tiers (Replaces Priorities)
gh label edit "tier-1" --color "d73a4a" --description "Immediate priority - next 1-2 PRs" --repo $REPO 2>$null
gh label edit "tier-2" --color "fbca04" --description "Next release cycle" --repo $REPO 2>$null
gh label edit "tier-3" --color "0e8a16" --description "Phase 4 / long-term architecture" --repo $REPO 2>$null

# Types
gh label edit "type: bug" --color "d73a4a" --description "Something is not working" --repo $REPO 2>$null
gh label edit "type: feature" --color "a59758" --description "New feature or request" --repo $REPO 2>$null
gh label edit "type: chore" --color "b1d3e7" --description "Maintenance, refactoring, or CI/CD" --repo $REPO 2>$null
gh label edit "type: epic" --color "041b3f" --description "Large, multi-issue initiatives" --repo $REPO 2>$null
gh label edit "type: docs" --color "0075ca" --description "Improvements to documentation" --repo $REPO 2>$null
gh label edit "type: security" --color "ff0000" --description "Security vulnerabilities or hardening" --repo $REPO 2>$null

# Scopes / Domains
gh label edit "scope: cli" --color "de89ff" --description "Issues related to the CLI package" --repo $REPO 2>$null
gh label edit "scope: core" --color "de89ff" --description "Issues related to the Core engine package" --repo $REPO 2>$null
gh label edit "scope: mcp" --color "de89ff" --description "Issues related to the MCP server package" --repo $REPO 2>$null
gh label edit "scope: ci" --color "32c597" --description "GitHub Actions, Turbo, or build pipelines" --repo $REPO 2>$null
gh label edit "domain: architecture" --color "1edb45" --description "System design and structural decisions" --repo $REPO 2>$null
gh label edit "domain: ux" --color "1edb45" --description "Terminal UI, CLI output, and user experience" --repo $REPO 2>$null

# Status / Meta
gh label edit "status: blocked" --color "dda26d" --description "Blocked by external dependency" --repo $REPO 2>$null
gh label edit "status: investigation" --color "cfd3d7" --description "Research or spike" --repo $REPO 2>$null

Write-Host "Merging redundant labels into canonical ones..." -ForegroundColor Yellow

# Type merges
Merge-Label "bug" "type: bug"
Merge-Label "enhancement" "type: feature"
Merge-Label "documentation" "type: docs"
Merge-Label "epic" "type: epic"
Merge-Label "tech-debt" "type: chore"
Merge-Label "technical-debt" "type: chore"
Merge-Label "refactor" "type: chore"

# Scope/Domain merges
Merge-Label "cli" "scope: cli"
Merge-Label "core" "scope: core"
Merge-Label "ci" "scope: ci"
Merge-Label "architecture" "domain: architecture"
Merge-Label "dx" "domain: ux"

# Priority -> Tier merges
Merge-Label "priority: P0" "tier-1"
Merge-Label "priority: P1" "tier-1"
Merge-Label "priority: P2" "tier-2"
Merge-Label "priority: P3" "tier-3"

Write-Host "Label taxonomy sync complete!" -ForegroundColor Green
