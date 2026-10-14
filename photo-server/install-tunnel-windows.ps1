$ErrorActionPreference = 'Stop'

$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$tokenFile = 'C:\ProgramData\KantinPhotoServer\private\cloudflare-tunnel.token'
$taskName = 'KantinPhotoTunnel'

if (-not (Test-Path -LiteralPath $cloudflared)) { throw 'cloudflared.exe bulunamadi.' }
if (-not (Test-Path -LiteralPath $tokenFile)) { throw 'Tunnel token dosyasi bulunamadi.' }

$action = New-ScheduledTaskAction -Execute $cloudflared -Argument "tunnel --no-autoupdate run --token-file `"$tokenFile`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
$task = Get-ScheduledTask -TaskName $taskName
if ($task.State -ne 'Running') { throw "Tunnel gorevi calismiyor: $($task.State)" }
Write-Output "Tunnel gorevi calisiyor: $taskName"
