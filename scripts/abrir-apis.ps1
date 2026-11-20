# Script PowerShell para abrir las URLs de las APIs en el navegador
# Uso: .\scripts\abrir-apis.ps1

Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host " CONFIGURAR APIs - SIEMPRE CERCA" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "Voy a abrir 3 pestanas en tu navegador:" -ForegroundColor Yellow
Write-Host ""

Write-Host "1. GOOGLE GEMINI (IA) - La mas facil" -ForegroundColor Green
Write-Host "   - Inicia sesion con Gmail" -ForegroundColor Gray
Write-Host "   - Clic en Get API key -> Create API key" -ForegroundColor Gray
Write-Host "   - Copia la clave (empieza con AIzaSy...)" -ForegroundColor Gray
Write-Host ""

Write-Host "2. BREVO (Correos) - 3 minutos" -ForegroundColor Green
Write-Host "   - Sign up free" -ForegroundColor Gray
Write-Host "   - Settings -> API Keys -> Generate new" -ForegroundColor Gray
Write-Host "   - Senders -> Add sender (verifica tu email)" -ForegroundColor Gray
Write-Host ""

Write-Host "3. TWILIO (SMS) - 5 minutos" -ForegroundColor Green
Write-Host "   - Sign up (verificaran tu telefono)" -ForegroundColor Gray
Write-Host "   - Copia Account SID y Auth Token del Dashboard" -ForegroundColor Gray
Write-Host "   - Crea servicio Verify y copia Service SID" -ForegroundColor Gray
Write-Host ""

$choice = Read-Host "Abrir las 3 URLs ahora? (S/n)"

if ($choice -eq "" -or $choice -eq "s" -or $choice -eq "S") {
    Write-Host ""
    Write-Host "Abriendo navegador..." -ForegroundColor Cyan
    
    # Gemini (IA)
    Start-Process "https://aistudio.google.com/apikey"
    Start-Sleep -Seconds 2
    
    # Brevo (Correos)
    Start-Process "https://www.brevo.com/"
    Start-Sleep -Seconds 2
    
    # Twilio (SMS)
    Start-Process "https://www.twilio.com/try-twilio"
    
    Write-Host ""
    Write-Host "Navegador abierto con las 3 URLs" -ForegroundColor Green
    Write-Host ""
    Write-Host "Sigue las instrucciones en cada pestana." -ForegroundColor Yellow
    Write-Host "Cuando tengas las claves, pegalas en el archivo .env" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Luego ejecuta:" -ForegroundColor Cyan
    Write-Host "  npm run check" -ForegroundColor White
    Write-Host "Para verificar que todo funciona." -ForegroundColor Gray
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "Ok, puedes abrir las URLs manualmente:" -ForegroundColor Yellow
    Write-Host "  1. https://aistudio.google.com/apikey" -ForegroundColor White
    Write-Host "  2. https://www.brevo.com/" -ForegroundColor White
    Write-Host "  3. https://www.twilio.com/try-twilio" -ForegroundColor White
    Write-Host ""
}

Write-Host "Guia completa en: OBTENER-APIS.md" -ForegroundColor Cyan
Write-Host ""
