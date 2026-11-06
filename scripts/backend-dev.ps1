#requires -Version 5.1
<#
  Arkan CRM backend process manager (Windows PowerShell 5.1).

  Canonical commands, from the repository root:
    npm run backend:start
    npm run backend:status
    npm run backend:logs
    npm run backend:logs:follow
    npm run backend:stop
    npm run backend:restart

  The API is launched detached through WMI (its parent is WmiPrvSE, not this
  shell), keeps the NestJS watcher/hot reload, appends stdout+stderr to
  .dev/logs/backend.log and records ownership in .dev/backend.json.

  A second start is a no-op while the managed instance is healthy. A stale
  managed watcher (alive but no listener) is stopped and replaced. Foreign
  processes on port 4001 are never killed.
#>

[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'status', 'logs', 'stop', 'restart')]
  [string]$Command = 'status',

  [int]$Lines = 80,
  [switch]$Follow,
  [int]$TimeoutSec = 90
)

$ErrorActionPreference = 'Stop'
$OwnerTag = 'arkan-crm-backend-manager-v1'
$Port = 4001
$BootGraceSec = 120
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BackendDir = Join-Path $ProjectRoot 'apps\backend'
$DevDir = Join-Path $ProjectRoot '.dev'
$LogDir = Join-Path $DevDir 'logs'
$LogFile = Join-Path $LogDir 'backend.log'
$StateFile = Join-Path $DevDir 'backend.json'
$LauncherFile = Join-Path $DevDir 'run-backend.cmd'
$NestCli = Join-Path $ProjectRoot 'node_modules\@nestjs\cli\bin\nest.js'
$HealthUrl = "http://127.0.0.1:$Port/health"
$AuthUrl = "http://127.0.0.1:$Port/auth/me"

function Write-Info([string]$Message) {
  Write-Host "[backend] $Message"
}

function Write-Warn([string]$Message) {
  Write-Host "[backend] WARNING: $Message" -ForegroundColor Yellow
}

function Write-ErrorLine([string]$Message) {
  Write-Host "[backend] ERROR: $Message" -ForegroundColor Red
}

function Get-ProcessInfo([int]$ProcessId) {
  if ($ProcessId -le 0) { return $null }
  return Get-CimInstance Win32_Process -Filter "ProcessId=$ProcessId" -ErrorAction SilentlyContinue
}

function Get-ListenerPids {
  $ids = @()
  try {
    $ids = @(
      Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop |
        ForEach-Object { [int]$_.OwningProcess }
    )
  } catch {
    $ids = @()
    foreach ($line in (netstat -ano | Select-String -Pattern 'LISTENING')) {
      $text = $line.Line
      if ($text -match "[:.]$Port\s" -and $text -match 'LISTENING') {
        $parts = $text.Trim() -split '\s+'
        $ids += [int]$parts[-1]
      }
    }
  }
  return @($ids | Sort-Object -Unique)
}

function Get-DescendantProcesses([int]$RootProcessId) {
  if ($RootProcessId -le 0) { return @() }
  $all = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
  $children = @{}
  foreach ($process in $all) {
    $parent = [int]$process.ParentProcessId
    if (-not $children.ContainsKey($parent)) {
      $children[$parent] = New-Object System.Collections.ArrayList
    }
    [void]$children[$parent].Add($process)
  }
  $result = New-Object System.Collections.ArrayList
  $queue = New-Object System.Collections.Queue
  $seen = @{}
  $queue.Enqueue($RootProcessId)
  while ($queue.Count -gt 0) {
    $current = [int]$queue.Dequeue()
    if ($seen.ContainsKey($current)) { continue }
    $seen[$current] = $true
    if (-not $children.ContainsKey($current)) { continue }
    foreach ($child in $children[$current]) {
      [void]$result.Add($child)
      $queue.Enqueue([int]$child.ProcessId)
    }
  }
  return @($result)
}

function Get-NodeExe {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if (-not $command) { return $null }
  return $command.Source
}

function Read-State {
  if (-not (Test-Path $StateFile)) { return $null }
  try {
    $raw = Get-Content -Path $StateFile -Raw -Encoding UTF8
    $state = $raw | ConvertFrom-Json
    if ($state.owner -ne $OwnerTag) { return $null }
    return $state
  } catch {
    return $null
  }
}

function Save-State($State) {
  $State | ConvertTo-Json -Depth 5 | Set-Content -Path $StateFile -Encoding UTF8
}

function Test-ProcessMatches($ProcessInfo, [string]$CreatedAt, [string]$CommandPattern) {
  if (-not $ProcessInfo) { return $false }
  if ($CreatedAt) {
    try {
      $expected = [datetime]::Parse(
        $CreatedAt,
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]::RoundtripKind
      )
      $actual = [datetime]$ProcessInfo.CreationDate
      if ([Math]::Abs(($actual.ToUniversalTime() - $expected.ToUniversalTime()).TotalSeconds) -gt 2) {
        return $false
      }
    } catch {
      return $false
    }
  }
  if ($CommandPattern -and ([string]$ProcessInfo.CommandLine -notmatch $CommandPattern)) {
    return $false
  }
  return $true
}

function Get-ManagedInstance($State) {
  if (-not $State) { return $null }
  $wrapper = Get-ProcessInfo ([int]$State.wrapperPid)
  $wrapperOk = Test-ProcessMatches $wrapper $State.wrapperCreatedAt 'run-backend\.cmd'
  $watcher = $null
  $watcherOk = $false
  if ($State.watcherPid) {
    $watcher = Get-ProcessInfo ([int]$State.watcherPid)
    $watcherOk = Test-ProcessMatches $watcher $State.watcherCreatedAt 'nest\.js'
  }
  if (-not $wrapperOk -and -not $watcherOk) { return $null }
  return [pscustomobject]@{
    Wrapper = $wrapper
    Watcher = $watcher
    WrapperOk = $wrapperOk
    WatcherOk = $watcherOk
    RootPid = if ($wrapperOk) { [int]$wrapper.ProcessId } else { [int]$watcher.ProcessId }
  }
}

function Get-HttpStatus([string]$Url) {
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($curl) {
    $raw = & $curl.Source -s -o NUL --noproxy '*' --max-time 3 -w '%{http_code}' $Url 2>$null
    $code = 0
    if ([int]::TryParse(([string]$raw).Trim(), [ref]$code)) { return $code }
    return 0
  }
  try {
    $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
    return [int]$response.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

function Wait-Health([int]$Seconds) {
  $deadline = (Get-Date).AddSeconds([Math]::Max(1, $Seconds))
  while ((Get-Date) -lt $deadline) {
    if ((Get-HttpStatus $HealthUrl) -eq 200) { return $true }
    Start-Sleep -Seconds 1
  }
  return ((Get-HttpStatus $HealthUrl) -eq 200)
}

function Test-ListenerIsDescendant([int]$RootProcessId, [int]$ListenerProcessId) {
  if ($RootProcessId -le 0 -or $ListenerProcessId -le 0) { return $false }
  if ($RootProcessId -eq $ListenerProcessId) { return $true }
  $descendants = @(Get-DescendantProcesses $RootProcessId)
  return (@($descendants | Where-Object { [int]$_.ProcessId -eq $ListenerProcessId }).Count -gt 0)
}

function Show-LogTail([int]$Count) {
  if (-not (Test-Path $LogFile)) {
    Write-Info "No log file yet: $LogFile"
    return
  }
  $safeCount = [Math]::Max(1, $Count)
  Write-Info "Last $safeCount lines of $LogFile"
  Get-Content -Path $LogFile -Tail $safeCount -Encoding UTF8 -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host $_ }
}

function Stop-ManagedInstance($State, $Instance) {
  if (-not $Instance) { return $false }
  $root = [int]$Instance.RootPid
  if ($root -le 0) { return $false }
  Write-Info "Stopping the project-owned backend tree (root PID $root) ..."
  & taskkill.exe /PID $root /T /F 2>&1 | ForEach-Object { Write-Host "  $_" }
  $deadline = (Get-Date).AddSeconds(15)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if (-not (Get-ProcessInfo $root)) { break }
  }
  if (Get-ProcessInfo $root) {
    Write-ErrorLine "PID $root is still alive; keeping its ownership state."
    return $false
  }
  Remove-Item -Path $StateFile -Force -ErrorAction SilentlyContinue
  return $true
}

function Start-Backend {
  $node = Get-NodeExe
  if (-not $node) {
    Write-ErrorLine 'node was not found on PATH. Open a new terminal and retry.'
    return 1
  }
  if (-not (Test-Path $NestCli)) {
    Write-ErrorLine "Nest CLI not found: $NestCli"
    return 1
  }
  if (-not (Test-Path $BackendDir)) {
    Write-ErrorLine "Backend directory not found: $BackendDir"
    return 1
  }
  New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

  $state = Read-State
  $instance = Get-ManagedInstance $state

  if ($instance) {
    $root = [int]$instance.RootPid
    $listenerIds = @(Get-ListenerPids)
    $health = Get-HttpStatus $HealthUrl
    $isDescendant = $false
    if ($listenerIds.Count -eq 1) {
      $isDescendant = Test-ListenerIsDescendant $root $listenerIds[0]
    }

    if ($listenerIds.Count -eq 1 -and $isDescendant -and $health -eq 200) {
      Write-Info "Already running and healthy (root PID $root, listener PID $($listenerIds[0])). No new process was started."
      return 0
    }
    if ($listenerIds.Count -eq 1 -and -not $isDescendant -and $health -eq 200) {
      Write-ErrorLine "Port $Port is served by unmanaged PID $($listenerIds[0]); refusing to start another backend."
      return 1
    }

    # A booting instance or a hot reload may be briefly unhealthy.
    if (Wait-Health 10) {
      $ids = @(Get-ListenerPids)
      if ($ids.Count -eq 1 -and (Test-ListenerIsDescendant $root $ids[0])) {
        Write-Info "Already running and healthy (root PID $root, listener PID $($ids[0])). No new process was started."
        return 0
      }
    }

    $ageSec = 999999
    if ($state.startedAt) {
      try {
        $started = [datetime]::Parse(
          [string]$state.startedAt,
          [Globalization.CultureInfo]::InvariantCulture,
          [Globalization.DateTimeStyles]::RoundtripKind
        )
        $ageSec = ((Get-Date).ToUniversalTime() - $started.ToUniversalTime()).TotalSeconds
      } catch {
        $ageSec = 999999
      }
    }
    $wasHealthy = [bool]$state.healthyAt
    if (-not $wasHealthy -and $ageSec -lt $BootGraceSec) {
      Write-ErrorLine "A managed instance started $([int]$ageSec)s ago is still starting or unhealthy. Not starting a duplicate."
      Write-Info 'Check: npm run backend:logs'
      return 1
    }

    Write-Warn 'The managed backend is not healthy. Repairing the stale project-owned instance.'
    if (-not (Stop-ManagedInstance $state $instance)) {
      Write-ErrorLine 'Could not stop the stale instance safely; refusing to start another.'
      return 1
    }
    $remaining = @(Get-ListenerPids)
    if ($remaining.Count -gt 0) {
      Write-ErrorLine "Port $Port is still in use by PID $($remaining[0]); refusing to start a second backend."
      return 1
    }
  } else {
    $foreign = @(Get-ListenerPids)
    if ($foreign.Count -gt 0) {
      $foreignInfo = Get-ProcessInfo $foreign[0]
      $foreignCmd = if ($foreignInfo) { [string]$foreignInfo.CommandLine } else { 'unknown command line' }
      Write-ErrorLine "Port $Port is already in use by PID $($foreign[0]): $foreignCmd"
      Write-Info 'Refusing to start a second backend. If this is the project backend, stop it manually and retry.'
      return 1
    }
    if ($state) {
      Remove-Item -Path $StateFile -Force -ErrorAction SilentlyContinue
    }
  }

  if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 5MB)) {
    $oldLog = "$LogFile.1"
    Remove-Item -Path $oldLog -Force -ErrorAction SilentlyContinue
    Move-Item -Path $LogFile -Destination $oldLog -Force
  }

  $header = @(
    '',
    ('=' * 78),
    "backend start $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')",
    "node: $node",
    "nest: $NestCli",
    "cwd:  $BackendDir",
    ('=' * 78)
  ) -join [Environment]::NewLine
  Add-Content -Path $LogFile -Value $header -Encoding UTF8

  $launcher = @"
@echo off
setlocal
cd /d "$BackendDir"
set NO_COLOR=1
"$node" "$NestCli" start --watch >> "$LogFile" 2>&1
"@
  Set-Content -Path $LauncherFile -Value $launcher -Encoding ASCII

  Write-Info 'Starting the backend detached (NestJS watch; hot reload preserved) ...'
  $wrapperPid = 0
  try {
    $create = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
      CommandLine = ('cmd.exe /d /s /c ""{0}""' -f $LauncherFile)
      CurrentDirectory = $BackendDir
    }
    if ($create.ReturnValue -ne 0 -or -not $create.ProcessId) {
      throw "Win32_Process.Create returned $($create.ReturnValue)"
    }
    $wrapperPid = [int]$create.ProcessId
  } catch {
    Write-Warn "WMI launch failed ($($_.Exception.Message)); falling back to Start-Process."
    $startedProcess = Start-Process -FilePath 'cmd.exe' `
      -ArgumentList @('/d', '/s', '/c', "`"$LauncherFile`"") `
      -WorkingDirectory $BackendDir -WindowStyle Hidden -PassThru
    $wrapperPid = [int]$startedProcess.Id
  }

  $wrapper = $null
  for ($i = 0; $i -lt 20; $i++) {
    $wrapper = Get-ProcessInfo $wrapperPid
    if ($wrapper) { break }
    Start-Sleep -Milliseconds 250
  }
  if (-not $wrapper) {
    Write-ErrorLine "The launcher process $wrapperPid did not appear."
    Show-LogTail 40
    return 1
  }

  $watcher = $null
  for ($i = 0; $i -lt 20; $i++) {
    $descendants = @(Get-DescendantProcesses $wrapperPid)
    $found = $descendants |
      Where-Object { $_.Name -eq 'node.exe' -and ([string]$_.CommandLine -match 'nest\.js') } |
      Select-Object -First 1
    if ($found) {
      $watcher = $found
      break
    }
    Start-Sleep -Milliseconds 500
  }

  $newState = [ordered]@{
    owner = $OwnerTag
    port = $Port
    wrapperPid = $wrapperPid
    wrapperCreatedAt = ([datetime]$wrapper.CreationDate).ToUniversalTime().ToString('o')
    watcherPid = if ($watcher) { [int]$watcher.ProcessId } else { $null }
    watcherCreatedAt = if ($watcher) { ([datetime]$watcher.CreationDate).ToUniversalTime().ToString('o') } else { $null }
    startedAt = (Get-Date).ToUniversalTime().ToString('o')
    healthyAt = $null
    logFile = $LogFile
    launcher = $LauncherFile
    node = $node
    nestCli = $NestCli
  }
  Save-State $newState

  $watcherLabel = if ($watcher) { "watch PID $($watcher.ProcessId)" } else { 'watcher starting' }
  Write-Info "Detached launcher PID $wrapperPid; $watcherLabel."
  Write-Info "Waiting for $HealthUrl (up to $TimeoutSec s) ..."

  if (-not (Wait-Health $TimeoutSec)) {
    Write-ErrorLine "The backend did not become healthy within $TimeoutSec s. It was NOT restarted automatically."
    Write-Info 'Diagnose with: npm run backend:logs'
    Write-Info 'Stop it with:  npm run backend:stop'
    Show-LogTail 60
    return 1
  }

  $newState.healthyAt = (Get-Date).ToUniversalTime().ToString('o')
  Save-State $newState
  $ids = @(Get-ListenerPids)
  $listenerText = if ($ids.Count -gt 0) { [string]$ids[0] } else { 'not detected yet' }
  Write-Info "Backend is healthy (HTTP 200). Listener PID: $listenerText."
  Write-Info "Log: $LogFile"
  Write-Info 'Status:  npm run backend:status'
  Write-Info 'Logs:    npm run backend:logs'
  Write-Info 'Stop:    npm run backend:stop'
  return 0
}

function Show-Status {
  $state = Read-State
  $instance = Get-ManagedInstance $state
  $listenerIds = @(Get-ListenerPids)
  $health = 0
  $auth = 0
  if ($listenerIds.Count -gt 0) {
    $health = Get-HttpStatus $HealthUrl
    $auth = Get-HttpStatus $AuthUrl
  }

  Write-Host ''
  Write-Host 'Arkan CRM backend status'
  Write-Host "  Port: $Port"
  Write-Host "  Log:  $LogFile"

  if (-not $instance) {
    if ($listenerIds.Count -gt 0) {
      $foreignInfo = Get-ProcessInfo $listenerIds[0]
      Write-Host '  State: UNMANAGED LISTENER' -ForegroundColor Yellow
      Write-Host "  Listener PID: $($listenerIds[0])"
      if ($foreignInfo) { Write-Host "  Command: $($foreignInfo.CommandLine)" }
      Write-Host "  /health: $health"
      Write-Host "  /auth/me: $auth"
      return 1
    }
    Write-Host '  State: STOPPED' -ForegroundColor Yellow
    if ($state) {
      Write-Host '  Managed state is stale (the process is gone). Run: npm run backend:start'
    }
    return 1
  }

  $root = [int]$instance.RootPid
  $wrapperText = if ($instance.WrapperOk) { [string]$instance.Wrapper.ProcessId } else { 'gone' }
  $watcherText = if ($instance.WatcherOk) { [string]$instance.Watcher.ProcessId } else { 'gone' }
  Write-Host "  Launcher PID: $wrapperText"
  Write-Host "  Watcher PID:  $watcherText"
  Write-Host "  Started:      $($state.startedAt)"

  if ($listenerIds.Count -eq 0) {
    Write-Host '  State: DEGRADED (watcher alive, API listener missing)' -ForegroundColor Red
    Write-Host '  /health: no HTTP response'
    Show-LogTail 40
    return 1
  }

  if ($listenerIds.Count -ne 1) {
    Write-Host "  State: UNHEALTHY (expected one listener, found $($listenerIds.Count))" -ForegroundColor Red
    Write-Host "  Listener PIDs: $($listenerIds -join ', ')"
    return 1
  }

  $listenerProcessId = $listenerIds[0]
  $isDescendant = Test-ListenerIsDescendant $root $listenerProcessId
  Write-Host "  Listener PID: $listenerProcessId"
  Write-Host "  /health: $health"
  Write-Host "  /auth/me: $auth (401 is expected without a token)"

  if (-not $isDescendant) {
    Write-Host '  State: UNMANAGED LISTENER (not a child of the managed watcher)' -ForegroundColor Red
    return 1
  }
  if ($health -ne 200) {
    Write-Host '  State: DEGRADED (listener present, health failed)' -ForegroundColor Red
    Show-LogTail 40
    return 1
  }

  Write-Host '  State: RUNNING (healthy)' -ForegroundColor Green
  return 0
}

function Stop-Backend {
  $state = Read-State
  $instance = Get-ManagedInstance $state
  if (-not $instance) {
    $listenerIds = @(Get-ListenerPids)
    if ($listenerIds.Count -gt 0) {
      Write-ErrorLine "Port $Port is owned by unmanaged PID $($listenerIds[0]); refusing to stop it."
      return 1
    }
    if ($state) {
      Remove-Item -Path $StateFile -Force -ErrorAction SilentlyContinue
    }
    Write-Info 'Backend is not running.'
    return 0
  }
  if (-not (Stop-ManagedInstance $state $instance)) { return 1 }
  $listenerIds = @(Get-ListenerPids)
  if ($listenerIds.Count -gt 0) {
    Write-ErrorLine "Port $Port is still listening (PID $($listenerIds[0]))."
    return 1
  }
  Write-Info 'Backend stopped. The frontend and data services were not touched.'
  return 0
}

function Restart-Backend {
  $stopCode = Stop-Backend
  if ($stopCode -ne 0) { return $stopCode }
  Start-Sleep -Seconds 1
  return Start-Backend
}

function Show-Logs {
  if (-not (Test-Path $LogFile)) {
    Write-ErrorLine "No log file at $LogFile"
    return 1
  }
  if ($Follow) {
    Write-Info "Following $LogFile. Press Ctrl+C to stop following; the backend keeps running."
    Get-Content -Path $LogFile -Tail ([Math]::Max(1, $Lines)) -Encoding UTF8 -Wait |
      ForEach-Object { Write-Host $_ }
    return 0
  }
  Show-LogTail $Lines
  return 0
}

$mutex = $null
$exitCode = 1
try {
  $canRun = $true
  if ($Command -in @('start', 'stop', 'restart')) {
    $mutex = New-Object -TypeName System.Threading.Mutex `
      -ArgumentList $false, 'Local\ArkanCrmBackendManager'
    $acquired = $false
    try {
      $acquired = $mutex.WaitOne(15000)
    } catch [System.Threading.AbandonedMutexException] {
      $acquired = $true
    }
    if (-not $acquired) {
      Write-ErrorLine 'Another backend manager command is already running.'
      $exitCode = 1
      $canRun = $false
    }
  }

  if ($canRun) {
    switch ($Command) {
      'start' { $exitCode = Start-Backend }
      'status' { $exitCode = Show-Status }
      'logs' { $exitCode = Show-Logs }
      'stop' { $exitCode = Stop-Backend }
      'restart' { $exitCode = Restart-Backend }
    }
  }
} catch {
  Write-ErrorLine $_.Exception.Message
  $exitCode = 1
} finally {
  if ($mutex) {
    try { $mutex.ReleaseMutex() } catch { }
    $mutex.Dispose()
  }
}

exit $exitCode
