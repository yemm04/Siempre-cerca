#!/usr/bin/env node
/**
 * Script interactivo para configurar las APIs de Siempre Cerca
 * Guía paso a paso para obtener las credenciales necesarias
 */

import readline from 'node:readline/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function print(msg, color = 'reset') {
  console.log(`${colors[color]}${msg}${colors.reset}`);
}

async function ask(question) {
  return await rl.question(`${colors.cyan}${question}${colors.reset} `);
}

function updateEnvFile(key, value) {
  let content = fs.readFileSync(envPath, 'utf8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}`;
  }
  
  fs.writeFileSync(envPath, content, 'utf8');
  print(`✓ ${key} actualizado`, 'green');
}

async function setupTwilio() {
  print('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  print('  📱 TWILIO VERIFY (SMS)', 'bright');
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  
  print('\n1. Abre: https://www.twilio.com/try-twilio');
  print('2. Regístrate gratis (verificarán tu teléfono)');
  print('3. En el Dashboard encontrarás:');
  print('   - Account SID (empieza con AC...)');
  print('   - Auth Token (haz clic en "Show")');
  
  const accountSid = await ask('\nPega tu Account SID:');
  const authToken = await ask('Pega tu Auth Token:');
  
  print('\n4. Ahora ve a: https://console.twilio.com/us1/develop/verify/services');
  print('5. Clic en "Create new" (o usa el servicio existente)');
  print('6. Copia el Service SID (empieza con VA...)');
  
  const verifySid = await ask('\nPega tu Verify Service SID:');
  
  if (accountSid && authToken && verifySid) {
    updateEnvFile('TWILIO_ACCOUNT_SID', accountSid.trim());
    updateEnvFile('TWILIO_AUTH_TOKEN', authToken.trim());
    updateEnvFile('TWILIO_VERIFY_SID', verifySid.trim());
    print('\n✅ Twilio configurado correctamente', 'green');
    
    print('\n⚠️  IMPORTANTE: En modo prueba, solo puedes enviar SMS a números verificados.', 'yellow');
    print('   Para verificar tu número: Console → Phone Numbers → Verified Caller IDs', 'yellow');
  } else {
    print('\n⚠️  Configuración de Twilio omitida', 'yellow');
  }
}

async function setupBrevo() {
  print('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  print('  📧 BREVO (Correos)', 'bright');
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  
  print('\n1. Abre: https://www.brevo.com/');
  print('2. Clic en "Sign up free"');
  print('3. Confirma tu email');
  print('4. Ve a: https://app.brevo.com/settings/keys/api');
  print('5. Clic en "Generate a new API key"');
  print('6. Dale un nombre: "Siempre Cerca"');
  
  const apiKey = await ask('\nPega tu API Key (empieza con xkeysib-...):');
  
  print('\n7. Ahora verifica tu email de remitente:');
  print('   Ve a: https://app.brevo.com/senders');
  print('   Agrega tu email y confírmalo');
  
  const mailFrom = await ask('\nPega tu email verificado:');
  
  if (apiKey && mailFrom) {
    updateEnvFile('BREVO_API_KEY', apiKey.trim());
    updateEnvFile('MAIL_FROM', mailFrom.trim());
    print('\n✅ Brevo configurado correctamente', 'green');
    print('   Plan gratuito: 300 correos/día', 'cyan');
  } else {
    print('\n⚠️  Configuración de Brevo omitida', 'yellow');
  }
}

async function setupGemini() {
  print('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  print('  🤖 GOOGLE GEMINI (IA)', 'bright');
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'blue');
  
  print('\n1. Abre: https://aistudio.google.com/apikey');
  print('2. Inicia sesión con tu cuenta Google');
  print('3. Clic en "Get API key" → "Create API key"');
  print('4. Copia la clave (empieza con AIzaSy...)');
  
  const apiKey = await ask('\nPega tu API Key de Gemini:');
  
  if (apiKey) {
    updateEnvFile('AI_PROVIDER', 'gemini');
    updateEnvFile('AI_API_KEY', apiKey.trim());
    print('\n✅ Gemini configurado correctamente', 'green');
    print('   Límite configurado: 200 llamadas/día', 'cyan');
  } else {
    print('\n⚠️  Configuración de IA omitida', 'yellow');
  }
}

async function main() {
  print('\n╔════════════════════════════════════════════╗', 'bright');
  print('║  🚀 CONFIGURACIÓN DE APIs - SIEMPRE CERCA ║', 'bright');
  print('╚════════════════════════════════════════════╝', 'bright');
  
  print('\nEste script te guiará para obtener las credenciales de:', 'cyan');
  print('  • Twilio Verify (SMS de verificación)');
  print('  • Brevo (envío de correos)');
  print('  • Google Gemini (inteligencia artificial)');
  
  const choice = await ask('\n¿Qué quieres configurar? (1=Twilio, 2=Brevo, 3=Gemini, 4=Todo, 0=Salir):');
  
  switch (choice) {
    case '1':
      await setupTwilio();
      break;
    case '2':
      await setupBrevo();
      break;
    case '3':
      await setupGemini();
      break;
    case '4':
      await setupTwilio();
      await setupBrevo();
      await setupGemini();
      break;
    case '0':
      print('\nSaliendo...', 'yellow');
      break;
    default:
      print('\nOpción no válida', 'yellow');
  }
  
  print('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'green');
  print('  ✅ CONFIGURACIÓN COMPLETADA', 'bright');
  print('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'green');
  
  print('\nPara verificar que todo funciona:', 'cyan');
  print('  npm run check\n');
  
  rl.close();
}

main().catch((error) => {
  print(`\n❌ Error: ${error.message}`, 'yellow');
  rl.close();
  process.exit(1);
});
