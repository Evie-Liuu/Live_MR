# start-tunnel.ps1
# 啟動 Cloudflare Tunnel，自動取得公開 HTTPS URL（行動裝置免憑證警告）
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
    # 重新整理 PATH
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
Write-Host "[1/4] 啟動基礎服務..." -ForegroundColor Cyan

$setupArgs = if ($IP) { @("-IP", $IP) } else { @() }
& "$PSScriptRoot\setup.ps1" @setupArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host "[錯誤] 基礎服務啟動失敗。" -ForegroundColor Red
    exit 1
}

# ---------- Step 2: 啟動 Cloudflare Tunnel ----------

Write-Host ""
Write-Host "[2/4] 啟動 Cloudflare Tunnel..." -ForegroundColor Cyan
Write-Host "   → 透過 http://127.0.0.1:8080（nginx loopback port）" -ForegroundColor DarkGray

$logFile = "$env:TEMP\livemr-cloudflared.log"
"" | Set-Content $logFile

$cfProcess = Start-Process -FilePath "cloudflared" `
    -ArgumentList "tunnel --url http://127.0.0.1:8080" `
    -RedirectStandardError $logFile `
    -NoNewWindow -PassThru

# ---------- Step 3: 等待並解析 Tunnel URL ----------

Write-Host "   等待 Tunnel 建立" -NoNewline -ForegroundColor Cyan

$tunnelUrl = $null
$maxWait   = 60   # 最多等 60 秒
$waited    = 0

while (-not $tunnelUrl -and $waited -lt $maxWait) {
    if ($cfProcess.HasExited) {
        Write-Host ""
        Write-Host "[錯誤] cloudflared 意外結束，最後 10 行日誌：" -ForegroundColor Red
        Get-Content $logFile -ErrorAction SilentlyContinue | Select-Object -Last 10 |
            ForEach-Object { Write-Host "   $_" -ForegroundColor DarkGray }
        exit 1
    }

    Start-Sleep 2
    $waited += 2
    Write-Host "." -NoNewline

    $log = Get-Content $logFile -Raw -ErrorAction SilentlyContinue
    if ($log -match 'https://[a-zA-Z0-9\-]+\.trycloudflare\.com') {
        $tunnelUrl = $Matches[0]
    }
}

Write-Host ""

if (-not $tunnelUrl) {
    Write-Host "[錯誤] 等待 Tunnel URL 逾時（60 秒）。" -ForegroundColor Red
    Write-Host "   請確認伺服器可連上網路。日誌：$logFile" -ForegroundColor Yellow
    $cfProcess | Stop-Process -Force -ErrorAction SilentlyContinue
    exit 1
}

$tunnelHost = $tunnelUrl -replace "https://", ""
Write-Host "   Tunnel URL：$tunnelUrl" -ForegroundColor Green

# ---------- Step 4: 更新前端環境並重啟 ----------

Write-Host ""
Write-Host "[3/4] 更新前端網域設定..." -ForegroundColor Cyan

(Get-Content ".env") `
    -replace 'VITE_LIVEKIT_URL=.*', "VITE_LIVEKIT_URL=wss://$tunnelHost/livekit" `
    -replace 'VITE_APP_DOMAIN=.*',  "VITE_APP_DOMAIN=$tunnelHost" |
    Set-Content ".env" -Encoding utf8

Write-Host "   OK" -ForegroundColor Green

Write-Host ""
Write-Host "[4/4] 重啟前端套用新網域..." -ForegroundColor Cyan
docker compose restart frontend
Write-Host "   OK" -ForegroundColor Green

# ---------- 完成 ----------

Write-Host ""
Write-Host "================================================" -ForegroundColor Green
Write-Host "  Cloudflare Tunnel 已啟動！" -ForegroundColor Green
Write-Host ""
Write-Host "  公開網址：$tunnelUrl" -ForegroundColor Yellow
Write-Host ""
Write-Host "  行動裝置直接輸入網址或掃 QR Code 即可" -ForegroundColor DarkGray
Write-Host "  無需接受憑證警告" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  [注意] 每次啟動 URL 不同（免費版限制）" -ForegroundColor DarkGray
Write-Host "  [注意] 影像/音訊串流需與伺服器在同一區網" -ForegroundColor DarkGray
Write-Host "================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  保持此視窗開啟以維持 Tunnel 運作。" -ForegroundColor DarkGray
Write-Host "  關閉視窗即停止 Tunnel（Docker 服務仍在背景執行）。" -ForegroundColor DarkGray
Write-Host ""

# 保持視窗開啟，等待 cloudflared 結束
try {
    $cfProcess | Wait-Process
} catch {
    # 使用者關閉視窗或 Ctrl+C
}

Write-Host "Tunnel 已停止。"
