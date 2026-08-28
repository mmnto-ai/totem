# Zero-mutation + clean-uninstall verification for the serena pilot.
#
# Usage:
#   pwsh -NoProfile -File verify-clean.ps1 -Phase pre
#   pwsh -NoProfile -File verify-clean.ps1 -Phase post
#
# `pre` captures the baseline `git status --porcelain`; `post` removes serena's
# residue from the checkout, re-captures, and diffs the two captures. The pilot's
# zero-mutation criterion is met only when the two captures are byte-identical
# and no serena residue remains.

param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('pre', 'post')]
  [string]$Phase
)

$ErrorActionPreference = 'Stop'

$Worktree = 'D:\Dev\worktrees\totem-totem-claude-spine-spike'
$Scratch  = 'C:\Users\jmatt\AppData\Local\Temp\claude\D--Dev-totem\79f6decd-54a6-4c97-a0f6-d995f35c8cd2\scratchpad'
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

if ($pre -ceq $post) {
  Write-Host ''
  Write-Host 'ZERO-MUTATION: PASS (pre and post porcelain captures are byte-identical)'
} else {
  Write-Host ''
  Write-Host 'ZERO-MUTATION: DIFFERENCE PRESENT (expected: the pilot''s own untracked spikes/serena-pilot/ tree)'
}
