# start-tunnel.ps1
# 啟動 Cloudflare Tunnel（免費版），tunnel 斷線自動重連並更新網域設定
#
# 用法：
#   .\start-tunnel.ps1           # 自動偵測 LAN IP
#   .\start-tunnel.ps1 -IP 10.0.0.5

param([string]$IP = "")

# ---------- 前置檢查 ----------

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "[錯誤] 找不到 Docker，請先安裝 Docker Desktop。" -ForegroundColor Red
    exit 1
}

$opensslExe = (Get-Command openssl -ErrorAction SilentlyContinue).Source
if (-not $opensslExe) {
    foreach ($p in @(
        "$env:ProgramFiles\Git\usr\bin\openssl.exe",
        "${env:ProgramFiles(x86)}\Git\usr\bin\openssl.exe"
    )) {
        if ($p -and (Test-Path $p)) { $opensslExe = $p; break }
    }
}
if (-not $opensslExe) {
    Write-Host "[錯誤] 找不到 openssl，請安裝 Git for Windows。" -ForegroundColor Red
    exit 1
}

if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
    Write-Host "cloudflared 未安裝，嘗試透過 winget 安裝..." -ForegroundColor Yellow
    winget install Cloudflare.cloudflared --accept-source-agreements --accept-package-agreements
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" +
                [System.Environment]::GetEnvironmentVariable("PATH", "User")
    if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) {
        Write-Host "[錯誤] 安裝失敗。請手動安裝：winget install Cloudflare.cloudflared" -ForegroundColor Red
        exit 1
    }
    Write-Host "cloudflared 安裝完成。" -ForegroundColor Green
}

# ---------- Step 1: 啟動基礎服務 ----------

Write-Host ""
Write-Host "[1/2] 啟動基礎服務..." -ForegroundColor Cyan

$setupArgs = if ($IP) { @("-IP", $IP) } else { @() }
& "$PSScriptRoot\setup.ps1" @setupArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host "[錯誤] 基礎服務啟動失敗。" -ForegroundColor Red
    exit 1
}

# ---------- 工具函式：啟動一次 Tunnel，回傳 (url, process) ----------

function Start-OneTunnel {
    param([string]$LogFile)

    "" | Set-Content $LogFile

    $proc = Start-Process -FilePath "cloudflared" `
        -ArgumentList "tunnel --url http://127.0.0.1:8080" `
        -RedirectStandardError $LogFile `
        -NoNewWindow -PassThru

    Write-Host "   等待 Tunnel 建立" -NoNewline -ForegroundColor Cyan

    $waited    = 0
    $tunnelUrl = $null

    while (-not $tunnelUrl -and $waited -lt 60) {
        if ($proc.HasExited) {
            Write-Host ""
            return $null, $proc
        }
        Start-Sleep 2
        $waited += 2
        Write-Host "." -NoNewline
        $log = Get-Content $LogFile -Raw -ErrorAction SilentlyContinue
        if ($log -match 'https://[a-zA-Z0-9\-]+\.trycloudflare\.com') {
            $tunnelUrl = $Matches[0]
        }
    }

    Write-Host ""
    return $tunnelUrl, $proc
}

# ---------- Step 2: Tunnel 重連主迴圈 ----------

Write-Host ""
Write-Host "[2/2] 啟動 Cloudflare Tunnel（免費版，斷線自動重連）..." -ForegroundColor Cyan
Write-Host "   → 警告訊息『account-less Tunnels have no uptime guarantee』屬正常現象，已忽略" -ForegroundColor DarkGray
Write-Host "   Ctrl+C 停止" -ForegroundColor DarkGray

$logFile   = "$env:TEMP\livemr-cloudflared.log"
$cfProcess = $null
$attempt   = 0

try {
    while ($true) {
        $attempt++

        if ($attempt -gt 1) {
            Write-Host ""
            Write-Host "[$(Get-Date -Format 'HH:mm:ss')] Tunnel 斷線（第 $attempt 次），5 秒後重新連線..." -ForegroundColor Yellow
            Start-Sleep 5
        }

        Write-Host ""
        Write-Host "[$(Get-Date -Format 'HH:mm:ss')] 連線中..." -ForegroundColor Cyan

        $tunnelUrl, $cfProcess = Start-OneTunnel -LogFile $logFile

        if (-not $tunnelUrl) {
            Write-Host "[警告] 無法取得 Tunnel URL，最後 5 行日誌：" -ForegroundColor Yellow
            Get-Content $logFile -ErrorAction SilentlyContinue | Select-Object -Last 5 |
                ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }
            continue
        }

        $tunnelHost = $tunnelUrl -replace "https://", ""

        # 更新 .env 並重啟前端套用新網域
        (Get-Content ".env") `
            -replace 'VITE_LIVEKIT_URL=.*', "VITE_LIVEKIT_URL=wss://$tunnelHost/livekit" `
            -replace 'VITE_APP_DOMAIN=.*',  "VITE_APP_DOMAIN=$tunnelHost" |
            Set-Content ".env" -Encoding utf8

        docker compose restart frontend 2>&1 | Out-Null

        Write-Host ""
        Write-Host "================================================" -ForegroundColor Green
        Write-Host "  Tunnel 已連線！" -ForegroundColor Green
        Write-Host ""
        Write-Host "  公開網址：$tunnelUrl" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "  行動裝置直接輸入網址或掃 QR Code 即可" -ForegroundColor DarkGray
        Write-Host "  [注意] 每次重連 URL 不同（免費版限制）" -ForegroundColor DarkGray
        Write-Host "  [注意] 影像/音訊串流需與伺服器在同一區網" -ForegroundColor DarkGray
        Write-Host "================================================" -ForegroundColor Green

        # 等待 cloudflared 結束（阻塞，直到斷線或 Ctrl+C）
        $cfProcess | Wait-Process
    }
} finally {
    if ($cfProcess -and -not $cfProcess.HasExited) {
        $cfProcess | Stop-Process -Force -ErrorAction SilentlyContinue
    }
    Write-Host ""
    Write-Host "Tunnel 已停止。"
}
