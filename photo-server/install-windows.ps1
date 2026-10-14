$ErrorActionPreference = 'Stop'

$base = 'C:\ProgramData\KantinPhotoServer'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$app = Join-Path $base 'app'
$private = Join-Path $base 'private'
$photos = Join-Path $base 'photos'
$readerKey = Join-Path $private 'photo-reader.json'
$entry = Join-Path $app 'index.js'
$starter = Join-Path $app 'windows-start.ps1'

foreach ($required in @($app, $private, $photos, $readerKey, $entry, $starter)) {
    if (-not (Test-Path -LiteralPath $required)) {
        throw "Eksik çalışma dosyası: $required"
    }
}
if (Get-ScheduledTask -TaskName 'KantinPhotoServer' -ErrorAction SilentlyContinue) {
    throw 'KantinPhotoServer görevi zaten mevcut; önce inceleyin.'
}

$action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File `"$starter`"" `
    -WorkingDirectory $app
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -Hidden `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'KantinPhotoServer' -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings `
    -Description 'Oturum açıldığında satış fotoğraflarını yalnız 127.0.0.1:8787 üzerinde sunar.' `
    -ErrorAction Stop | Out-Null
Start-ScheduledTask -TaskName 'KantinPhotoServer' -ErrorAction Stop

Get-ScheduledTask -TaskName 'KantinPhotoServer' |
    Select-Object TaskName, State, @{ Name = 'User'; Expression = { $_.Principal.UserId } }
