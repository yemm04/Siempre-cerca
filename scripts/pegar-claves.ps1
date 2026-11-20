# Script interactivo para pegar las claves API en el .env

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host " PEGAR CLAVES API" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

$envPath = Join-Path $PSScriptRoot "..\. env"

function Update-EnvVariable {
    param($Key, $Value)
    
    $content = Get-Content $envPath -Raw
    $pattern = "(?m)^$Key=.*$"
    
    if ($content -match $pattern) {
        $content = $content -replace $pattern, "$Key=$Value"
    } else {
        $content += "`n$Key=$Value"
    }
    
    Set-Content -Path $envPath -Value $content -NoNewline
    Write-Host "  OK $Key actualizado" -ForegroundColor Green
}

Write-Host "Pega las claves que obtuviste (Enter vacio para omitir):" -ForegroundColor Yellow
Write-Host ""

# Gemini
Write-Host "GOOGLE GEMINI (IA):" -ForegroundColor Cyan
$geminiKey = Read-Host "  API Key (empieza con AIzaSy...)"
if ($geminiKey) {
    Update-EnvVariable "AI_API_KEY" $geminiKey.Trim()
}

Write-Host ""

# Brevo
Write-Host "BREVO (Correos):" -ForegroundColor Cyan
$brevoKey = Read-Host "  API Key (empieza con xkeysib-...)"
if ($brevoKey) {
    Update-EnvVariable "BREVO_API_KEY" $brevoKey.Trim()
}

$brevoEmail = Read-Host "  Email verificado"
if ($brevoEmail) {
    Update-EnvVariable "MAIL_FROM" $brevoEmail.Trim()
}

Write-Host ""

# Twilio
Write-Host "TWILIO (SMS):" -ForegroundColor Cyan
$twilioSid = Read-Host "  Account SID (empieza con AC...)"
if ($twilioSid) {
    Update-EnvVariable "TWILIO_ACCOUNT_SID" $twilioSid.Trim()
}

$twilioToken = Read-Host "  Auth Token"
if ($twilioToken) {
    Update-EnvVariable "TWILIO_AUTH_TOKEN" $twilioToken.Trim()
}

$twilioVerify = Read-Host "  Verify Service SID (empieza con VA...)"
if ($twilioVerify) {
    Update-EnvVariable "TWILIO_VERIFY_SID" $twilioVerify.Trim()
}

Write-Host ""
Write-Host "================================" -ForegroundColor Green
Write-Host " CONFIGURACION COMPLETADA" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host ""

Write-Host "Ahora verifica que todo funciona:" -ForegroundColor Cyan
Write-Host "  npm run check" -ForegroundColor White
Write-Host ""
