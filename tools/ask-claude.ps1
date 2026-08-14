[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Task,

  [Parameter(Mandatory = $true)]
  [string[]]$Files,

  [ValidateSet("low", "medium", "high", "xhigh", "max")]
  [string]$Effort = "low",

  [ValidateRange(15, 600)]
  [int]$TimeoutSeconds = 120
)

$ErrorActionPreference = "Stop"

function Find-ClaudeExecutable {
  $command = Get-Command claude -ErrorAction SilentlyContinue
  if ($command -and $command.Source) {
    return $command.Source
  }

  $extensionRoot = $null
  $codeCommand = Get-Command code -ErrorAction SilentlyContinue
  if ($codeCommand) {
    $located = & code --locate-extension anthropic.claude-code 2>$null
    if ($LASTEXITCODE -eq 0 -and $located) {
      $extensionRoot = ($located | Select-Object -First 1).Trim()
    }
  }

  if (-not $extensionRoot -and $env:USERPROFILE) {
    $extensionsDirectory = Join-Path $env:USERPROFILE ".vscode\extensions"
    if (Test-Path -LiteralPath $extensionsDirectory) {
      $extensionRoot = Get-ChildItem -LiteralPath $extensionsDirectory -Directory |
        Where-Object { $_.Name -like "anthropic.claude-code-*" } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
    }
  }

  if ($extensionRoot) {
    $bundledExecutable = Join-Path $extensionRoot "resources\native-binary\claude.exe"
    if (Test-Path -LiteralPath $bundledExecutable) {
      return $bundledExecutable
    }
  }

  throw "Claude Code was not found. Install its VS Code extension or expose the claude command on PATH."
}

$repositoryRoot = (& git rev-parse --show-toplevel 2>$null).Trim()
if (-not $repositoryRoot) {
  throw "Run this command inside a Git repository."
}

$repositoryRoot = [System.IO.Path]::GetFullPath($repositoryRoot)
$repositoryPrefix = $repositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) +
  [System.IO.Path]::DirectorySeparatorChar
$sourceSections = New-Object System.Collections.Generic.List[string]
$expandedFiles = $Files | ForEach-Object { $_ -split "," } | ForEach-Object { $_.Trim() } |
  Where-Object { $_ }

foreach ($file in $expandedFiles) {
  $candidate = if ([System.IO.Path]::IsPathRooted($file)) {
    $file
  } else {
    Join-Path $repositoryRoot $file
  }
  $resolved = (Resolve-Path -LiteralPath $candidate).Path

  if (-not $resolved.StartsWith($repositoryPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing a file outside the repository: $file"
  }

  $relativePath = $resolved.Substring($repositoryPrefix.Length).Replace("\", "/")
  $segments = $relativePath.Split("/")
  $leaf = $segments[$segments.Length - 1]
  if (
    $leaf -match '^\.env(?:\.|$)' -or
    $segments -contains ".git" -or
    $segments -contains ".next" -or
    $segments -contains "node_modules"
  ) {
    throw "Refusing a secret or generated path: $relativePath"
  }

  $fileInfo = Get-Item -LiteralPath $resolved
  if ($fileInfo.PSIsContainer) {
    throw "Pass explicit files, not directories: $relativePath"
  }
  if ($fileInfo.Length -gt 200KB) {
    throw "Refusing a file larger than 200 KB: $relativePath"
  }

  $lineNumber = 0
  $numberedSource = Get-Content -LiteralPath $resolved | ForEach-Object {
    $lineNumber += 1
    "{0,5}: {1}" -f $lineNumber, $_
  }
  $sourceSections.Add("--- $relativePath ---`n$($numberedSource -join "`n")")
}

$prompt = @"
You are the read-only second reviewer for a software change. Another coding agent owns all edits.

Task:
$Task

Rules:
- Review only the explicit, line-numbered source below.
- Do not claim you inspected files that are not included.
- Do not request, infer, reproduce, or expose credentials or personal data.
- Prioritize concrete correctness, security, privacy, accessibility, and lifecycle defects.
- Cite the file and line number for every finding.
- If the code is sound for this task, say so plainly.
- Keep the answer concise. Do not output a full replacement file.

$($sourceSections -join "`n`n")
"@

$claudeExecutable = Find-ClaudeExecutable
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $claudeExecutable
$startInfo.Arguments = "-p --model opus --effort $Effort --max-turns 1 --tools `"`" --output-format text --no-session-persistence --no-chrome"
$startInfo.WorkingDirectory = $repositoryRoot
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.CreateNoWindow = $true

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo
if (-not $process.Start()) {
  throw "Claude Code could not be started."
}

$stdoutTask = $process.StandardOutput.ReadToEndAsync()
$stderrTask = $process.StandardError.ReadToEndAsync()
$process.StandardInput.Write($prompt)
$process.StandardInput.Close()

if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
  $process.Kill()
  $process.WaitForExit()
  throw "Claude Code exceeded the $TimeoutSeconds-second review limit. Narrow the task or pass a larger timeout."
}
$process.WaitForExit()

$stdout = $stdoutTask.GetAwaiter().GetResult().Trim()
$stderr = $stderrTask.GetAwaiter().GetResult().Trim()
if ($process.ExitCode -ne 0) {
  throw "Claude Code failed with exit code $($process.ExitCode): $stderr"
}
if (-not $stdout) {
  throw "Claude Code returned an empty review."
}

$stdout
