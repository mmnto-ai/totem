# Zero-mutation + clean-uninstall verification for the serena pilot.
#
# Usage:
#   pwsh -NoProfile -File verify-clean.ps1 -Phase pre
#   pwsh -NoProfile -File verify-clean.ps1 -Phase post
#   pwsh -NoProfile -File verify-clean.ps1 -Phase post -Worktree <path> -Scratch <path>
#
# `pre` captures the baseline `git status --porcelain`; `post` removes serena's
# residue from the checkout, re-captures, and diffs the two captures. The pilot's
# zero-mutation criterion is met when no serena residue remains AND either the
# two captures are byte-identical or every line present in POST but not in PRE is
# an untracked path under `spikes/serena-pilot/` — the pilot's own tree, which is
# its documented end state (`?? spikes/serena-pilot/`) and not a mutation of the
# checkout under verification. Any other difference still fails. `post` exits 1
# when either check fails, so a caller can gate on the process status.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('pre', 'post')]
  [string]$Phase,

  # Checkout under verification. Defaults to the repository this script lives in.
  [string]$Worktree,

  # Where the pre/post captures are written. Defaults to a script-local scratch dir.
  [string]$Scratch = (Join-Path $PSScriptRoot '.scratch')
)

$ErrorActionPreference = 'Stop'

if (-not $Worktree) {
  $Worktree = & git -C $PSScriptRoot rev-parse --show-toplevel
  if (-not $Worktree) {
    throw 'could not derive -Worktree from git rev-parse --show-toplevel; pass -Worktree explicitly'
  }
  # git reports forward slashes on Windows; normalise to the native separator.
  $Worktree = (Resolve-Path -LiteralPath $Worktree).ProviderPath
}

New-Item -ItemType Directory -Force -Path $Scratch | Out-Null

$PreFile  = Join-Path $Scratch 'git-status-pre.txt'
$PostFile = Join-Path $Scratch 'git-status-post.txt'

function Get-StatusText {
  # --porcelain is the stable, machine-readable form; capture it verbatim.
  $s = & git -C $Worktree status --porcelain
  if ($null -eq $s) { return '' }
  return ($s -join "`n")
}

if ($Phase -eq 'pre') {
  Get-StatusText | Set-Content -Path $PreFile -NoNewline -Encoding utf8
  Write-Host "PRE captured -> $PreFile"
  Write-Host "--- content ---"
  Get-Content $PreFile -Raw
  Write-Host "--- end (length: $((Get-Item $PreFile).Length) bytes) ---"
  exit 0
}

# ---------------- post phase ----------------

# Set by either failing check; drives the exit status so a caller can gate on it.
$failed = $false

Write-Host '=== removing serena residue from the CHECKOUT ==='
$ProjectSerena = Join-Path $Worktree '.serena'
if (Test-Path $ProjectSerena) {
  Get-ChildItem $ProjectSerena -Recurse -Force | ForEach-Object { Write-Host "  removing: $($_.FullName)" }
  Remove-Item $ProjectSerena -Recurse -Force
  Write-Host "  removed: $ProjectSerena"
} else {
  Write-Host "  (already absent): $ProjectSerena"
}

Write-Host ''
Write-Host '=== verifying absence of serena residue anywhere in the checkout ==='
$residue = Get-ChildItem $Worktree -Recurse -Force -Filter '.serena*' -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch '\\node_modules\\' -and $_.FullName -notmatch '\\spikes\\serena-pilot\\' }
if ($residue) {
  Write-Host 'RESIDUE FOUND:'
  $residue | ForEach-Object { Write-Host "  $($_.FullName)" }
  $failed = $true
} else {
  Write-Host '  none (pass)'
}

Write-Host ''
Write-Host '=== git status diff (pre vs post) ==='
Get-StatusText | Set-Content -Path $PostFile -NoNewline -Encoding utf8
$pre  = if (Test-Path $PreFile)  { Get-Content $PreFile  -Raw } else { '<<MISSING PRE CAPTURE>>' }
$post = if (Test-Path $PostFile) { Get-Content $PostFile -Raw } else { '' }
if ($null -eq $pre)  { $pre  = '' }
if ($null -eq $post) { $post = '' }

Write-Host "PRE  (len $($pre.Length)):"
if ($pre.Trim().Length -eq 0)  { Write-Host '  <clean tree>' } else { Write-Host $pre }
Write-Host "POST (len $($post.Length)):"
if ($post.Trim().Length -eq 0) { Write-Host '  <clean tree>' } else { Write-Host $post }

# The one difference the pilot is allowed to leave behind: its OWN untracked
# tree. `?? spikes/serena-pilot/` is the documented end state, and git collapses
# an untracked directory to that single entry, so both the directory line and any
# path beneath it are exempt. The pattern anchors on the trailing separator, so a
# sibling like `?? spikes/serena-pilot-scratch/` is NOT exempt.
$ExemptPattern = '^\?\? "?spikes/serena-pilot/'

function Split-StatusLines {
  param([string]$Text)
  if ([string]::IsNullOrEmpty($Text)) { return @() }
  # Porcelain lines carry significant LEADING whitespace (` M path`), so split
  # without trimming and drop only the wholly blank entries.
  return @($Text -split "`r?`n" | Where-Object { $_.Trim().Length -gt 0 })
}

if ($pre -ceq $post) {
  Write-Host ''
  Write-Host 'ZERO-MUTATION: PASS (pre and post porcelain captures are byte-identical)'
} else {
  $preLines  = Split-StatusLines $pre
  $postLines = Split-StatusLines $post
  # Case-sensitive: git paths are case-sensitive even where the filesystem is not.
  $addedLines = @($postLines | Where-Object { $preLines -cnotcontains $_ })
  $unexempt   = @($addedLines | Where-Object { $_ -cnotmatch $ExemptPattern })

  Write-Host ''
  Write-Host 'PRESENT IN POST BUT NOT PRE:'
  if ($addedLines.Count -eq 0) { Write-Host '  <none>' } else { $addedLines | ForEach-Object { Write-Host "  $_" } }

  if ($unexempt.Count -eq 0) {
    Write-Host ''
    Write-Host 'ZERO-MUTATION: PASS (every new porcelain line is an untracked path under spikes/serena-pilot/ — the pilot''s own tree)'
  } else {
    Write-Host ''
    Write-Host 'ZERO-MUTATION: FAIL (new porcelain lines outside the pilot''s own untracked tree):'
    $unexempt | ForEach-Object { Write-Host "  $_" }
    $failed = $true
  }
}

if ($failed) {
  Write-Host ''
  Write-Host 'VERIFY-CLEAN: FAIL (see the checks above)'
  exit 1
}

Write-Host ''
Write-Host 'VERIFY-CLEAN: PASS'
exit 0
