# Scripts requires GitHub CLI (gh) installed and authenticated.
# Run with: pwsh scripts/sync-labels.ps1
# Optionally provide a repo: pwsh scripts/sync-labels.ps1 -Repo "mmnto-ai/totem-strategy"
# Dry run (prints every gh call, executes none): pwsh scripts/sync-labels.ps1 -WhatIf
#
# The literal `gh label edit` lines below ARE the canon: two readers regex this
# file's TEXT for the quoted three-argument form -- name, then --color, then
# --description (packages/core/src/parity-label-canon.ts and, in the strategy
# repo, tools/gh-parity-twins.cjs) -- and both refuse to judge against an empty
# canon. Never refactor them into a helper or a data table, and never write an
# EXAMPLE of that form in a comment: a comment is text too, and the readers would
# count it as a 25th label.

[CmdletBinding(SupportsShouldProcess)]
param (
    [string]$Repo = "mmnto-ai/totem"
)

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    Write-Host "[Error] GitHub CLI (gh) not found. Install from https://cli.github.com/ and authenticate." -ForegroundColor Red
    exit 1
}

# The native binary, resolved BEFORE the shadow below exists (a function named
# gh would otherwise win the lookup). -CommandType Application never returns a
# function, so this is the real gh.exe / gh on PATH.
$script:GhNative = (Get-Command gh -CommandType Application | Select-Object -First 1).Source
$script:Failures = [System.Collections.Generic.List[string]]::new()

# Shadow the gh executable for the whole script. PowerShell resolves a function
# before a native command, so every literal `gh ...` line below -- including the
# `gh issue list` / `gh issue edit` / `gh label delete` calls inside Merge-Label
# -- goes through here. Two modes:
#   -WhatIf : print the call (arguments carrying a space re-quoted so the line
#             reads like the authored call) and execute nothing.
#   normal  : forward to the native binary, then tally a non-zero exit on the
#             MUTATIONS whose failure means the sync did not converge -- `label
#             edit` and `issue edit`. `label create` (fails on an existing label
#             by design; the `edit` that follows carries the convergence) and
#             `label delete` (fails on an already-retired name) stay expected-
#             fail. Every literal line keeps its `2>$null`; the exit CODE is what
#             this checks, and the run ends non-zero when any mutation failed.
function script:gh {
    if ($WhatIfPreference) {
        $rendered = @($args | ForEach-Object {
                $text = [string]$_
                if ($text -match '\s') { '"' + $text + '"' } else { $text }
            })
        Write-Host "[WhatIf] gh $($rendered -join ' ')"
        $global:LASTEXITCODE = 0
        return
    }
    & $script:GhNative @args
    $verb = if ($args.Count -ge 2) { "$($args[0]) $($args[1])" } else { "$args" }
    if ($LASTEXITCODE -ne 0 -and ($verb -eq 'label edit' -or $verb -eq 'issue edit')) {
        $target = if ($args.Count -ge 3) { [string]$args[2] } else { '' }
        $script:Failures.Add("$verb $target")
        Write-Host "[Error] gh $verb '$target' failed (exit $LASTEXITCODE)" -ForegroundColor Red
    }
}

if (-not $WhatIfPreference) {
    # Fail loud when unauthenticated: every call below suppresses stderr with
    # `2>$null`, so without this preflight an unauthenticated run silently
    # no-ops. (Write access and API failures are caught per mutation above.)
    gh auth status 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[Error] GitHub CLI (gh) is not authenticated. Run 'gh auth login' and re-run this script." -ForegroundColor Red
        exit 1
    }
}

Write-Host "Syncing labels for repository: $Repo" -ForegroundColor Magenta

function Merge-Label {
    param($OldName, $NewName)
    Write-Host "Merging '$OldName' into '$NewName'..." -ForegroundColor Cyan
    # Get issues with the old label. A label the repo never carried lists as
    # empty with exit 0; a non-zero exit is a failed READ (auth, rate limit,
    # network), and deleting on one would strip the old label from every issue
    # that carries it with no replacement -- so the read failure keeps the label
    # and counts against convergence.
    $issues = gh issue list --label $OldName --repo $Repo --state all --limit 1000 --json number --jq '.[].number' | Out-String
    if ($LASTEXITCODE -ne 0) {
        $script:Failures.Add("issue list $OldName")
        Write-Host "[Error] gh issue list '$OldName' failed (exit $LASTEXITCODE) -- keeping '$OldName'" -ForegroundColor Red
        return
    }
    $issueNumbers = $issues -split '\s+' | Where-Object { $_ -ne '' }

    $failuresBefore = $script:Failures.Count
    foreach ($num in $issueNumbers) {
        Write-Host "  Updating issue #$num"
        gh issue edit $num --add-label $NewName --remove-label $OldName --repo $Repo
    }

    # The delete is gated on every relabel above having succeeded. On totem-status
    # (2026-09-08, mmnto-ai/totem#2837) every `issue edit` had failed on an absent
    # canonical and the delete still ran: `bug`, `enhancement` and `documentation`
    # left their issues with no replacement, repaired by hand.
    $relabelFailures = $script:Failures.Count - $failuresBefore
    if ($relabelFailures -gt 0) {
        Write-Host "[Error] keeping '$OldName': $relabelFailures relabel(s) into '$NewName' failed" -ForegroundColor Red
        return
    }

    # The migration read is capped (--limit 1000): a label on more issues than the
    # cap lists a subset, and deleting after relabelling only that subset strips
    # the rest (Greptile P1 on mmnto-ai/totem#2839). One more read, limit 1, asks
    # whether ANY issue still carries the old label; a remainder or a failed read
    # keeps the label, and the next run continues the migration.
    $remaining = gh issue list --label $OldName --repo $Repo --state all --limit 1 --json number --jq '.[].number' | Out-String
    if ($LASTEXITCODE -ne 0) {
        $script:Failures.Add("issue list $OldName (recheck)")
        Write-Host "[Error] gh issue list '$OldName' recheck failed (exit $LASTEXITCODE) -- keeping '$OldName'" -ForegroundColor Red
        return
    }
    if (@($remaining -split '\s+' | Where-Object { $_ -ne '' }).Count -gt 0) {
        $script:Failures.Add("issue list $OldName (issues remain past the 1000-issue read cap)")
        Write-Host "[Error] keeping '$OldName': issues still carry it after the relabel pass (the read is capped at 1000) -- re-run to continue the migration" -ForegroundColor Red
        return
    }

    # Every issue that carried the old label now carries the new one: retire it.
    # `label delete` fails on an already-retired name by design (2>$null, never
    # tallied), so a failure is VERIFIED rather than assumed benign: the exact
    # name is read back -- absent is a no-op, present or unreadable means the
    # taxonomy did not converge (CodeRabbit on mmnto-ai/totem#2839).
    gh label delete $OldName --yes --repo $Repo 2>$null
    if ($LASTEXITCODE -ne 0) {
        $present = gh label list --repo $Repo --search $OldName --limit 100 --json name --jq ".[] | select(.name == `"$OldName`") | .name" | Out-String
        if ($LASTEXITCODE -ne 0) {
            $script:Failures.Add("label delete $OldName (unverified)")
            Write-Host "[Error] gh label delete '$OldName' failed and the label could not be read back -- keeping '$OldName'" -ForegroundColor Red
            return
        }
        if ($present.Trim().Length -gt 0) {
            $script:Failures.Add("label delete $OldName")
            Write-Host "[Error] gh label delete '$OldName' failed and the label is still present" -ForegroundColor Red
        }
    }
}

Write-Host "Updating canonical labels..." -ForegroundColor Yellow

# Two lines per canonical label, every namespace (mmnto-ai/totem#2837): `create`
# makes it exist (an error on an existing label is suppressed and never tallied),
# `edit` converges its colour and description on every run AND is the line both
# canon parsers read -- a `create` line is invisible to them. An `edit`-only
# canonical fails loud on a repo that never carried it (the shadow tallies a
# non-zero `label edit`), which ended the run before any merge on liquid-city.

# Tiers (Replaces Priorities)
gh label create "tier-1" --color "d73a4a" --description "Immediate priority - next 1-2 PRs" --repo $Repo 2>$null
gh label edit "tier-1" --color "d73a4a" --description "Immediate priority - next 1-2 PRs" --repo $Repo 2>$null
gh label create "tier-2" --color "fbca04" --description "Next release cycle" --repo $Repo 2>$null
gh label edit "tier-2" --color "fbca04" --description "Next release cycle" --repo $Repo 2>$null
gh label create "tier-3" --color "0e8a16" --description "Phase 4 / long-term architecture" --repo $Repo 2>$null
gh label edit "tier-3" --color "0e8a16" --description "Phase 4 / long-term architecture" --repo $Repo 2>$null

# Types
gh label create "type: bug" --color "d73a4a" --description "Something is not working" --repo $Repo 2>$null
gh label edit "type: bug" --color "d73a4a" --description "Something is not working" --repo $Repo 2>$null
gh label create "type: feature" --color "a59758" --description "New feature or request" --repo $Repo 2>$null
gh label edit "type: feature" --color "a59758" --description "New feature or request" --repo $Repo 2>$null
gh label create "type: chore" --color "b1d3e7" --description "Maintenance, refactoring, or CI/CD" --repo $Repo 2>$null
gh label edit "type: chore" --color "b1d3e7" --description "Maintenance, refactoring, or CI/CD" --repo $Repo 2>$null
gh label create "type: epic" --color "041b3f" --description "Large, multi-issue initiatives" --repo $Repo 2>$null
gh label edit "type: epic" --color "041b3f" --description "Large, multi-issue initiatives" --repo $Repo 2>$null
gh label create "type: docs" --color "0075ca" --description "Improvements to documentation" --repo $Repo 2>$null
gh label edit "type: docs" --color "0075ca" --description "Improvements to documentation" --repo $Repo 2>$null
gh label create "type: security" --color "ff0000" --description "Security vulnerabilities or hardening" --repo $Repo 2>$null
gh label edit "type: security" --color "ff0000" --description "Security vulnerabilities or hardening" --repo $Repo 2>$null

# Scopes / Domains
gh label create "scope: cli" --color "de89ff" --description "Issues related to the CLI package" --repo $Repo 2>$null
gh label edit "scope: cli" --color "de89ff" --description "Issues related to the CLI package" --repo $Repo 2>$null
gh label create "scope: core" --color "de89ff" --description "Issues related to the Core engine package" --repo $Repo 2>$null
gh label edit "scope: core" --color "de89ff" --description "Issues related to the Core engine package" --repo $Repo 2>$null
gh label create "scope: mcp" --color "de89ff" --description "Issues related to the MCP server package" --repo $Repo 2>$null
gh label edit "scope: mcp" --color "de89ff" --description "Issues related to the MCP server package" --repo $Repo 2>$null
gh label create "scope: ci" --color "32c597" --description "GitHub Actions, Turbo, or build pipelines" --repo $Repo 2>$null
gh label edit "scope: ci" --color "32c597" --description "GitHub Actions, Turbo, or build pipelines" --repo $Repo 2>$null
gh label create "domain: architecture" --color "1edb45" --description "System design and structural decisions" --repo $Repo 2>$null
gh label edit "domain: architecture" --color "1edb45" --description "System design and structural decisions" --repo $Repo 2>$null
gh label create "domain: ux" --color "1edb45" --description "Terminal UI, CLI output, and user experience" --repo $Repo 2>$null
gh label edit "domain: ux" --color "1edb45" --description "Terminal UI, CLI output, and user experience" --repo $Repo 2>$null
gh label create "domain: strategy" --color "1edb45" --description "Product and execution strategy decisions" --repo $Repo 2>$null
gh label edit "domain: strategy" --color "1edb45" --description "Product and execution strategy decisions" --repo $Repo 2>$null

# Status / Meta
gh label create "status: blocked" --color "dda26d" --description "Blocked by external dependency" --repo $Repo 2>$null
gh label edit "status: blocked" --color "dda26d" --description "Blocked by external dependency" --repo $Repo 2>$null
gh label create "status: investigation" --color "cfd3d7" --description "Research or spike" --repo $Repo 2>$null
gh label edit "status: investigation" --color "cfd3d7" --description "Research or spike" --repo $Repo 2>$null

# Dispositions (issue pre-registration; the six fixed outcomes)
gh label create "disposition: premise-changed" --color "6f42c1" --description "UPDATE — the premise moved; a human rewrites or rules; stays open" --repo $Repo 2>$null
gh label edit "disposition: premise-changed" --color "6f42c1" --description "UPDATE — the premise moved; a human rewrites or rules; stays open" --repo $Repo 2>$null
gh label create "disposition: horizon" --color "6f42c1" --description "HOLD (Horizon) — premise valid, not now; open, label only, no card" --repo $Repo 2>$null
gh label edit "disposition: horizon" --color "6f42c1" --description "HOLD (Horizon) — premise valid, not now; open, label only, no card" --repo $Repo 2>$null
gh label create "disposition: done" --color "6f42c1" --description "ARCHIVE — done elsewhere; closed completed; comment carries the receipt (merged PR or path+digest)" --repo $Repo 2>$null
gh label edit "disposition: done" --color "6f42c1" --description "ARCHIVE — done elsewhere; closed completed; comment carries the receipt (merged PR or path+digest)" --repo $Repo 2>$null
gh label create "disposition: obsolete" --color "6f42c1" --description "ARCHIVE — premise gone, no successor; closed not planned; receipt is the ground contact" --repo $Repo 2>$null
gh label edit "disposition: obsolete" --color "6f42c1" --description "ARCHIVE — premise gone, no successor; closed not planned; receipt is the ground contact" --repo $Repo 2>$null
gh label create "disposition: superseded" --color "6f42c1" --description "SUPERSEDE — closed not planned; comment names the title-verified successor" --repo $Repo 2>$null
gh label edit "disposition: superseded" --color "6f42c1" --description "SUPERSEDE — closed not planned; comment names the title-verified successor" --repo $Repo 2>$null
gh label create "disposition: lateral" --color "6f42c1" --description "LATERAL — closed not planned; comment names the lane's tracking issue" --repo $Repo 2>$null
gh label edit "disposition: lateral" --color "6f42c1" --description "LATERAL — closed not planned; comment names the lane's tracking issue" --repo $Repo 2>$null

Write-Host "Merging redundant labels into canonical ones..." -ForegroundColor Yellow

# Type merges
Merge-Label "bug" "type: bug"
Merge-Label "enhancement" "type: feature"
Merge-Label "documentation" "type: docs"
Merge-Label "epic" "type: epic"
Merge-Label "tech-debt" "type: chore"
Merge-Label "technical-debt" "type: chore"
Merge-Label "refactor" "type: chore"
Merge-Label "chore" "type: chore"

# Scope/Domain merges
Merge-Label "cli" "scope: cli"
Merge-Label "core" "scope: core"
Merge-Label "ci" "scope: ci"
Merge-Label "mcp" "scope: mcp"
Merge-Label "architecture" "domain: architecture"
Merge-Label "dx" "domain: ux"

# Priority -> Tier merges
Merge-Label "priority: P0" "tier-1"
Merge-Label "priority: P1" "tier-1"
Merge-Label "priority: P2" "tier-2"
Merge-Label "priority: P3" "tier-3"

# Status merges
Merge-Label "blocked" "status: blocked"
Merge-Label "research" "status: investigation"
Merge-Label "investigation" "status: investigation"

# Domain merges
Merge-Label "strategy" "domain: strategy"

if ($script:Failures.Count -gt 0) {
    Write-Host "[Error] $($script:Failures.Count) label mutation(s) failed for $Repo -- the taxonomy did NOT converge:" -ForegroundColor Red
    foreach ($failure in $script:Failures) { Write-Host "  - $failure" -ForegroundColor Red }
    exit 1
}

Write-Host "Label taxonomy sync complete for $Repo!" -ForegroundColor Green
