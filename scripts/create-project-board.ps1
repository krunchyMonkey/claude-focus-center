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

# GitHub's item-edit CLI uses node IDs (not --owner / --url). Cache
# project metadata so this also works with older gh versions on Windows.
$projectDetail = (Invoke-Gh -Arguments @('project', 'view', "$number", '--owner', $owner, '--format', 'json') | ConvertFrom-Json)
$script:projectId = [string]$projectDetail.id
if ([string]::IsNullOrWhiteSpace($script:projectId)) {
    throw 'Cannot determine GitHub Projects node ID.'
}

$schema = (Invoke-Gh -Arguments @('project', 'field-list', "$number", '--owner', $owner, '--limit', '100', '--format', 'json') | ConvertFrom-Json)
$script:fieldMap = @{}
foreach ($field in @($schema.fields)) {
    $script:fieldMap[[string]$field.name] = $field
}

function Get-ProjectItem {
    param([Parameter(Mandatory = $true)][string]$Url)
    $list = (Invoke-Gh -Arguments @('project', 'item-list', "$number", '--owner', $owner, '--limit', '200', '--format', 'json') | ConvertFrom-Json)
    foreach ($item in @($list.items)) {
        if ([string]$item.content.url -eq $Url -or [string]$item.url -eq $Url) {
            return $item
        }
    }
    return $null
}

function Ensure-ProjectItem {
    param([int]$Issue)
    $url = "https://github.com/$repo/issues/$Issue"
    $item = Get-ProjectItem -Url $url
    if ($null -ne $item -and -not [string]::IsNullOrWhiteSpace([string]$item.id)) {
        return $item
    }
    try {
        $item = (Invoke-Gh -Arguments @('project', 'item-add', "$number", '--owner', $owner, '--url', $url, '--format', 'json') | ConvertFrom-Json)
    } catch {
        # An interrupted previous run may already have created this item.
        $item = Get-ProjectItem -Url $url
        if ($null -eq $item) { throw }
    }
    if ([string]::IsNullOrWhiteSpace([string]$item.id)) {
        $item = Get-ProjectItem -Url $url
    }
    if ($null -eq $item -or [string]::IsNullOrWhiteSpace([string]$item.id)) {
        throw ("Unable to resolve a Project item ID for issue #{0}." -f $Issue)
    }
    return $item
}

function Set-ProjectField {
    param(
        [Parameter(Mandatory = $true)][string]$ItemId,
        [Parameter(Mandatory = $true)][string]$FieldName,
        [Parameter(Mandatory = $true)][string]$Value,
        [switch]$Numeric
    )
    $field = $script:fieldMap[$FieldName]
    if ($null -eq $field -or [string]::IsNullOrWhiteSpace([string]$field.id)) {
        throw "Project field '$FieldName' was not found."
    }
    $args = @('project', 'item-edit', '--id', $ItemId, '--project-id', $script:projectId,
              '--field-id', [string]$field.id)
    if ($Numeric) {
        $args += @('--number', $Value)
    } else {
        $choice = @($field.options | Where-Object { $_.name -eq $Value } | Select-Object -First 1)
        if ($choice.Count -eq 0 -or [string]::IsNullOrWhiteSpace([string]$choice[0].id)) {
            throw "Option '$Value' is not available for Project field '$FieldName'."
        }
        $args += @('--single-select-option-id', [string]$choice[0].id)
    }
    $null = Invoke-Gh -Arguments $args
}

function Set-Issue {
    param([int]$Issue, [string]$Release, [string]$Priority, [string]$Decision,
          [int]$Effort, [int]$OwnerHours, [switch]$Done)

    $item = Ensure-ProjectItem -Issue $Issue
    $itemId = [string]$item.id
    Set-ProjectField -ItemId $itemId -FieldName 'Release' -Value $Release
    Set-ProjectField -ItemId $itemId -FieldName 'Priority' -Value $Priority
    Set-ProjectField -ItemId $itemId -FieldName 'Decision' -Value $Decision
    Set-ProjectField -ItemId $itemId -FieldName 'Effort (h)' -Value "$Effort" -Numeric
    Set-ProjectField -ItemId $itemId -FieldName 'Owner attention (h)' -Value "$OwnerHours" -Numeric
    if ($Done -and $script:fieldMap.ContainsKey('Status')) {
        $status = $script:fieldMap['Status']
        if (@($status.options | Where-Object { $_.name -eq 'Done' }).Count -gt 0) {
            Set-ProjectField -ItemId $itemId -FieldName 'Status' -Value 'Done'
        } else {
            Write-Warning "Project Status has no Done option; set issue #$Issue manually."
        }
    }
    Write-Host ("Issue #{0} -> {1} ({2}h effort; {3}h owner)" -f $Issue, $Release, $Effort, $OwnerHours)
}

1..13 | ForEach-Object { Set-Issue $_ 'Shipped' 'P0' 'Complete' 0 0 -Done }
Set-Issue 14 'v0.1 Pilot' 'P0' 'Committed' 0 3
Set-Issue 18 'v0.1 Pilot' 'P0' 'Committed' 1 1
Set-Issue 26 'v0.1 Pilot' 'P0' 'Committed' 3 0
Set-Issue 27 'v0.1 Pilot' 'P0' 'Committed' 2 0
Set-Issue 28 'v0.1 Pilot' 'P0' 'Committed' 2 0
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
