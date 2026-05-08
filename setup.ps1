# setup.ps1
# 用途：初始化或切換地點時一鍵重設 IP、憑證、啟動服務
#
# 用法：
#   .\setup.ps1              # 自動偵測 LAN IP
#   .\setup.ps1 -IP 10.0.0.5 # 手動指定 IP

param([string]$IP = "")

# ---------- 工具函式 ----------

function Get-LanIP {
    $candidates = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.PrefixOrigin -eq "Dhcp"
        }

    if ($candidates.Count -eq 0) {
        $candidates = Get-NetIPAddress -AddressFamily IPv4 |
            Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }
    }

    if ($candidates.Count -gt 1) {
        Write-Host "偵測到多個網路介面，使用第一個。若要指定請加 -IP 參數：" -ForegroundColor Yellow
        foreach ($c in $candidates) {
            Write-Host "  $($c.IPAddress)  ($($c.InterfaceAlias))"
        }
    }

    return ($candidates | Select-Object -First 1).IPAddress
}

function Get-EnvIP {
    if (-not (Test-Path ".env")) { return $null }
    $line = Get-Content ".env" | Where-Object { $_ -match "^SERVER_NAME=" }
    if ($line) { return ($line -replace "SERVER_NAME=", "").Trim() }
    return $null
}

function Write-Step($n, $msg) {
    Write-Host "`n[$n/4] $msg..." -ForegroundColor Cyan
}

function Write-Ok { Write-Host "   OK" -ForegroundColor Green }

# ---------- 前置檢查 ----------

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "錯誤：找不到 Docker，請先安裝 Docker Desktop。" -ForegroundColor Red
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
    Write-Host "錯誤：找不到 openssl。" -ForegroundColor Red
    Write-Host "   安裝 Git for Windows 後重試（內建 openssl）。" -ForegroundColor Yellow
    exit 1
}

if (-not (Test-Path ".env.example")) {
    Write-Host "錯誤：請在專案根目錄執行此腳本。" -ForegroundColor Red
    exit 1
}

# ---------- 決定目標 IP ----------

if ($IP -eq "") { $IP = Get-LanIP }

if (-not $IP) {
    Write-Host "錯誤：無法偵測 LAN IP，請用 -IP 參數手動指定。" -ForegroundColor Red
    exit 1
}

$currentIP = Get-EnvIP
$certExists = (Test-Path "certs/cert.pem") -and (Test-Path "certs/key.pem")

# IP 未變且憑證存在 → 直接啟動，不重建
if ($currentIP -eq $IP -and $certExists) {
    Write-Host "`nIP 未變更 ($IP)，直接啟動服務。" -ForegroundColor Cyan
    docker compose up -d
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nhttps://$IP" -ForegroundColor Yellow
    }
    exit $LASTEXITCODE
}

if ($currentIP -and $currentIP -ne $IP) {
    Write-Host "`nIP 變更：$currentIP → $IP" -ForegroundColor Yellow
}

# ---------- 設定 .env ----------

Write-Step 1 "設定 .env"

$content = Get-Content ".env.example" -Raw
$content = $content `
    -replace '<HOST_IP>',                       $IP `
    -replace 'your_api_key',                    'devkey' `
    -replace 'your_api_secret_min_32_chars',    'devsecret1234567890devsecret1234567890'
Set-Content ".env" $content -Encoding utf8
Write-Ok

# ---------- 產生 SSL 自簽憑證 ----------

Write-Step 2 "產生 SSL 憑證（IP: $IP）"

if (-not (Test-Path "certs")) { New-Item -ItemType Directory "certs" | Out-Null }

$opensslOutput = & $opensslExe req -x509 -nodes -days 365 -newkey rsa:2048 `
    -keyout "certs/key.pem" `
    -out "certs/cert.pem" `
    -subj "/CN=$IP" `
    -addext "subjectAltName=IP:$IP" 2>&1

if ($LASTEXITCODE -ne 0) {
    Write-Host "錯誤：憑證產生失敗。" -ForegroundColor Red
    Write-Host $opensslOutput
    exit 1
}
Write-Ok

# ---------- 停止舊服務 ----------

Write-Step 3 "停止舊服務"
docker compose down 2>&1 | Out-Null
Write-Ok

# ---------- 啟動所有服務 ----------

Write-Step 4 "啟動所有服務"
docker compose up -d

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n================================================" -ForegroundColor Green
    Write-Host "  服務已啟動！" -ForegroundColor Green
    Write-Host "  網址：https://$IP" -ForegroundColor Yellow
    Write-Host "  首次開啟需在瀏覽器接受憑證警告（點「進階」→「繼續」）" -ForegroundColor DarkGray
    Write-Host "================================================" -ForegroundColor Green
} else {
    Write-Host "`n啟動失敗，請執行：docker compose logs" -ForegroundColor Red
    exit 1
}
