#Requires -Version 5.1
<#
.SYNOPSIS
Creates or updates the Claude Focus Center GitHub Projects roadmap.
.DESCRIPTION
Windows-native alternative to create-project-board.sh. Requires GitHub CLI
authenticated with the 'project' scope. Safe to re-run; does not modify code.
#>
$ErrorActionPreference = 'Stop'
$owner = 'krunchyMonkey'
$repo = 'krunchyMonkey/claude-focus-center'
$title = 'Claude Focus Center Roadmap'

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'GitHub CLI (gh) is not available in PowerShell. Install it from https://cli.github.com/'
}

function Invoke-Gh {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)
    $lines = & gh @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ("GitHub CLI command failed: gh " + ($Arguments -join ' '))
    }
    return ($lines -join "`n")
}

# Avoid shell emulation: use the same PowerShell gh.exe that passed authentication.
$null = Invoke-Gh -Arguments @('auth', 'status')
$projects = (Invoke-Gh -Arguments @('project', 'list', '--owner', $owner, '--limit', '100', '--format', 'json') | ConvertFrom-Json)
$existing = @($projects.projects | Where-Object { $_.title -eq $title } | Select-Object -First 1)
if ($existing.Count -gt 0) {
    $number = [int]$existing[0].number
    Write-Host "Reusing project #$number"
} else {
    $created = (Invoke-Gh -Arguments @('project', 'create', '--owner', $owner, '--title', $title, '--format', 'json') | ConvertFrom-Json)
    $number = [int]$created.number
    if ($number -le 0) { throw 'Project creation did not return a valid number.' }
    Write-Host "Created project #$number"
}

try {
    $null = Invoke-Gh -Arguments @('project', 'link', "$number", '--owner', $owner, '--repo', $repo)
} catch {
    Write-Warning 'Project linking reported an error (it may already be linked). Verify the repository Projects tab.'
}
$null = Invoke-Gh -Arguments @('project', 'edit', "$number", '--owner', $owner,
    '--description', 'Claude Code attention dashboard: release choices, investment, and owner attention.',
    '--visibility', 'PUBLIC')

function Ensure-Field {
    param([string]$Name, [string]$Type, [string]$Options = '')
    $fields = (Invoke-Gh -Arguments @('project', 'field-list', "$number", '--owner', $owner, '--limit', '100', '--format', 'json') | ConvertFrom-Json)
    if (@($fields.fields | Where-Object { $_.name -eq $Name }).Count -gt 0) { return }
    $args = @('project', 'field-create', "$number", '--owner', $owner, '--name', $Name, '--data-type', $Type)
    if ($Type -eq 'SINGLE_SELECT') { $args += @('--single-select-options', $Options) }
    $null = Invoke-Gh -Arguments $args
    Write-Host "Added project field: $Name"
}

Ensure-Field 'Release' 'SINGLE_SELECT' 'Shipped,v0.1 Pilot,v0.2 Reliability,v0.3 UX/Beta,Explore'
Ensure-Field 'Priority' 'SINGLE_SELECT' 'P0,P1,P2'
Ensure-Field 'Decision' 'SINGLE_SELECT' 'Complete,Committed,Candidate,Optional,Parked'
Ensure-Field 'Effort (h)' 'NUMBER'
Ensure-Field 'Owner attention (h)' 'NUMBER'

function Set-Issue {
    param([int]$Issue, [string]$Release, [string]$Priority, [string]$Decision,
          [int]$Effort, [int]$OwnerHours, [switch]$Done)
    $url = "https://github.com/$repo/issues/$Issue"
    try {
        $null = Invoke-Gh -Arguments @('project', 'item-add', "$number", '--owner', $owner, '--url', $url)
    } catch {
        # GitHub may return an error if the item already exists. Edit will check it.
        Write-Host "Issue #$Issue: already present or add reported an error; verifying by field update."
    }
    foreach ($field in @(
        @('Release', $Release),
        @('Priority', $Priority),
        @('Decision', $Decision),
        @('Effort (h)', "$Effort"),
        @('Owner attention (h)', "$OwnerHours")
    )) {
        $null = Invoke-Gh -Arguments @('project', 'item-edit', "$number", '--owner', $owner,
            '--url', $url, '--field', $field[0], '--value', $field[1])
    }
    if ($Done) {
        try {
            $null = Invoke-Gh -Arguments @('project', 'item-edit', "$number", '--owner', $owner,
                '--url', $url, '--field', 'Status', '--value', 'Done')
        } catch {
            Write-Warning "Unable to set issue #$Issue to Done; adjust Status in the UI."
        }
    }
    Write-Host ("Issue #{0} -> {1} ({2}h effort; {3}h owner)" -f $Issue, $Release, $Effort, $OwnerHours)
}

1..13 | ForEach-Object { Set-Issue $_ 'Shipped' 'P0' 'Complete' 0 0 -Done }
Set-Issue 14 'v0.1 Pilot' 'P0' 'Committed' 5 3
Set-Issue 18 'v0.1 Pilot' 'P0' 'Committed' 3 1
Set-Issue 20 'v0.2 Reliability' 'P0' 'Candidate' 8 2
Set-Issue 21 'v0.2 Reliability' 'P1' 'Candidate' 8 1
Set-Issue 22 'v0.2 Reliability' 'P1' 'Candidate' 6 2
Set-Issue 23 'v0.3 UX/Beta' 'P1' 'Optional' 6 2
Set-Issue 24 'v0.3 UX/Beta' 'P2' 'Optional' 10 2
Set-Issue 25 'v0.3 UX/Beta' 'P2' 'Optional' 10 3
Set-Issue 15 'Explore' 'P2' 'Parked' 6 2
Set-Issue 16 'Explore' 'P2' 'Parked' 6 2

Write-Host ''
Write-Host "Roadmap ready: https://github.com/users/$owner/projects/$number"
Write-Host 'Set up Board (Status) and Roadmap (Release) views from the GitHub UI if desired.'
