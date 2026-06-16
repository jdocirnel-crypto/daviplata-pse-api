/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   DaviPlata PSE - Recarga Automática Completa               ║
 * ║                                                             ║
 * ║  Usa Playwright para:                                       ║
 * ║  1. Abrir DaviPlata y obtener JWT automáticamente           ║
 * ║  2. La app Angular maneja la encriptación JWE               ║
 * ║  3. Llena el formulario automáticamente                     ║
 * ║  4. Resuelve reCAPTCHA con 2captcha                         ║
 * ║  5. Envía la transacción                                    ║
 * ║  6. Devuelve la URL PSE para pagar                          ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Uso:
 *   node daviplata_complete.js [opciones]
 *
 * Opciones:
 *   --celular=NUMBER    Número DaviPlata a recargar
 *   --monto=NUMBER      Valor en COP (ej: 50000)
 *   --banco=CODE        Código banco (1007=Bogotá, 1051=Davivienda, etc)
 *   --correo=EMAIL      Correo registrado en PSE
 *   --nombre=TEXT       (opcional) Nombre completo del pagador
 *   --doc=NUMBER        (opcional) Número de documento
 *   --tipo-doc=TEXT     (opcional) CC, CE, NIT (default: CC)
 *   --captcha=KEY       API Key de 2captcha (para auto resolver captcha)
 *   --headless          Ejecutar sin ventana visible
 *
 * Ejemplo:
 *   node daviplata_complete.js --celular=3137016591 --monto=50000 ^
 *     --banco=1051 --correo=maria1@hotmail.com --captcha=TU_KEY
 *
 * Bancos disponibles:
 *   1007=Bogotá, 1051=Davivienda, 1052=AV Villas, 1013=BBVA,
 *   1001=Bancolombia, 1032=Caja Social, 1507=Nequi, 1151=Rappipay,
 *   1062=Banco W, 1066=Lulo Bank, 1019=Scotiabank, 1006=Itaú,
 *   1060=Falabella, 1040=Agrario, 1002=Popular, 1058=Occidente
 */

const { chromium } = require('playwright');
const axios = require('axios');
const readline = require('readline');
const path = require('path');
const fs = require('fs');

// ─── PARSE ARGS ──────────────────────────────────────────────────────────────
const args = {};
process.argv.slice(2).forEach(arg => {
    const m = arg.match(/^--(\w[\w-]*)=(.+)$/) || arg.match(/^--(\w[\w-]*)$/);
    if (m) args[m[1]] = m[2] !== undefined ? m[2] : true;
});

const CONFIG = {
    celular:   args.celular,
    monto:     args.monto,
    banco:     args.banco,
    correo:    args.correo,
    nombre:    args.nombre || '',
    doc:       args.doc || '',
    tipoDoc:   args['tipo-doc'] || 'CC',
    captcha:   args.captcha || '',
    headless:  args.headless === 'true' || !!args.headless,
    logFile:   args.log || path.join(__dirname, 'daviplata.log'),
};

const CAPTCHA_SITE_KEY = '6LdlZsIkAAAAACkTKDN0laXfW_4MRZ7ZPAek54fV';

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync(CONFIG.logFile, line + '\n'); } catch {}
}

function decodeJWT(token) {
    try {
        return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    } catch { return null; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 2CAPTCHA ────────────────────────────────────────────────────────────────
async function solveCaptcha(apiKey) {
    if (!apiKey) {
        log('⚠️  Sin API key de 2captcha');
        return null;
    }
    
    // Reintentar hasta 3 veces
    for (let attempt = 1; attempt <= 3; attempt++) {
        log(`🤖 Resolviendo reCAPTCHA vía 2captcha (intento ${attempt}/3)...`);
        try {
            const submit = await axios.get('https://2captcha.com/in.php', {
                params: { key: apiKey, method: 'userrecaptcha',
                    googlekey: CAPTCHA_SITE_KEY,
                    pageurl: 'https://recargar.daviplata.com/psevnz/',
                    json: 1 }
            });
            if (submit.data.status !== 1) {
                const err = submit.data.request;
                if (err === 'ERROR_ZERO_BALANCE') {
                    log('✗ Saldo insuficiente en 2captcha — recarga tu cuenta');
                    return null;
                }
                log(`✗ Error: ${err}, reintentando...`);
                await sleep(5000);
                continue;
            }
            const id = submit.data.request;
            log(`⏳ Captcha enviado (id: ${id})...`);
            
            for (let i = 0; i < 25; i++) {
                await sleep(3000);
                const res = await axios.get('https://2captcha.com/res.php', {
                    params: { key: apiKey, action: 'get', id, json: 1 }
                });
                if (res.data.status === 1) {
                    log(`✅ Captcha resuelto (${(i+1)*3}s)`);
                    return res.data.request;
                }
                if (i % 5 === 4) log(`  Esperando... ${(i+1)*3}s`);
            }
            log(`✗ Timeout intento ${attempt}`);
        } catch (e) {
            log(`✗ Error: ${e.message}`);
        }
        await sleep(3000);
    }
    return null;
}

// ─── BANCOS ──────────────────────────────────────────────────────────────────
// Mapeo de códigos a NOMBRES exactos del dropdown de DaviPlata
const BANCOS = {
    '1007': 'BANCO DE BOGOTA', '1051': 'DAVIbank S.A.',
    '1052': 'BANCO AV VILLAS', '1013': 'BANCO BBVA COLOMBIA S.A.',
    '1001': 'BANCOLOMBIA', '1032': 'BANCO CAJA SOCIAL',
    '1507': 'NEQUI', '1151': 'RAPPIPAY', '1066': 'LULO BANK',
    '1019': 'SCOTIABANK COLPATRIA', '1006': 'BANCO ITAU',
    '1060': 'BANCO FALABELLA', '1040': 'BANCO AGRARIO',
    '1002': 'BANCO POPULAR', '1058': 'BANCO DE OCCIDENTE',
    '1062': 'BANCO GNB SUDAMERIS', '1012': 'BANCOLOMBIA',
    '1111': 'BANCO PICHINCHA S.A.', '1053': 'BANCO SANTANDER COLOMBIA',
    '1503': 'NU', '1099': 'BOLD CF',
    '1050': 'BANCO UNION', '1505': 'DALE',
    '1508': 'MOVII S.A.', '1501': 'COINK SA',
    '1504': 'UALÁ', '1509': 'GLOBAL66',
    '1510': 'PAYCASH', '1070': 'BANCO SERFINANZA',
    '1025': 'BANCO FINANDINA S.A. BIC', '1502': 'IRIS',
};

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('');
    console.log('  ╔══════════════════════════════════════════╗');
    console.log('  ║   💰 DaviPlata PSE - Recarga Automática ║');
    console.log('  ║   v2.0 — Con encriptación JWE          ║');
    console.log('  ╚══════════════════════════════════════════╝');
    console.log('');

    // ── Validar argumentos ──
    if (!CONFIG.celular || !CONFIG.monto || !CONFIG.banco || !CONFIG.correo) {
        console.log('❌ Faltan parámetros requeridos.\n');
        console.log('Uso: node daviplata_complete.js \\');
        console.log('  --celular=3137016591 --monto=50000 --banco=1007 \\');
        console.log('  --correo=email@test.com --captcha=API_KEY\n');
        console.log('Bancos:');
        Object.entries(BANCOS).forEach(([k, v]) => console.log(`  ${k}=${v}`));
        process.exit(1);
    }

    if (!BANCOS[CONFIG.banco]) {
        console.log(`❌ Código de banco "${CONFIG.banco}" no válido`);
        process.exit(1);
    }

    log(`📱 Celular: ${CONFIG.celular}`);
    log(`💰 Monto: $${parseInt(CONFIG.monto).toLocaleString()}`);
    log(`🏦 Banco: ${BANCOS[CONFIG.banco]} (${CONFIG.banco})`);
    log(`📧 Correo: ${CONFIG.correo}`);
    log(`🔑 2captcha: ${CONFIG.captcha ? '✓ Configurado' : '✗ No configurado (manual)'}`);

    // ── 1. Abrir navegador ──
    log('\n🌐 Abriendo navegador...');
    const browser = await chromium.launch({
        headless: CONFIG.headless,
        args: [
            '--no-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-web-security',
            '--disable-features=IsolateOrigins,site-per-process'
        ]
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 900 },
        locale: 'es-CO',
        timezoneId: 'America/Bogota',
    });

    const page = await context.newPage();

    // Capturar eventos
    let jwtCaptured = null;
    let workflowResponse = null;
    let formSubmitted = false;

    page.on('framenavigated', frame => {
        const url = frame.url();
        const m = url.match(/solicitudInicial\/([^/?#]+)/);
        if (m) jwtCaptured = m[1];
    });

    // Interceptar respuestas del workflow
    page.on('response', resp => {
        if (resp.url().includes('workflow') && resp.status() === 200) {
            resp.text().then(text => {
                try {
                    const json = JSON.parse(text);
                    if (json.data || json.payload) {
                        workflowResponse = json;
                    }
                    if (text.includes('idTransaccion') || text.includes('urlPse')) {
                        if (json.payload?.idTransaccion || json.data?.payload?.idTransaccion) {
                            formSubmitted = true;
                        }
                    }
                } catch {}
            }).catch(() => {});
        }
    });

    // ── 2. Navegar a DaviPlata ──
    log('📡 Navegando a DaviPlata...');
    try {
        await page.goto('https://www.daviplata.com/recargar-con-pse', {
            waitUntil: 'domcontentloaded',
            timeout: 30000
        });
    } catch (e) {
        log(`⚠️  Timeout en navegación inicial: ${e.message}`);
    }

    // ── 3. Esperar que cargue el formulario ──
    log('⏳ Esperando que cargue el formulario PSE...');
    try {
        await page.waitForURL(/pse010-web|formulariodatos/, { timeout: 25000 });
        log('✅ Formulario cargado');
    } catch {
        log('⚠️  Timeout esperando URL del formulario');
        const currentUrl = page.url();
        log(`   URL actual: ${currentUrl.substring(0, 150)}`);
        if (currentUrl.includes('solicitudInicial')) {
            log('   ✅ URL contiene solicitudInicial, continuando...');
        }
    }

    await sleep(2000); // Dar tiempo a que Angular termine de renderizar

    // ── 4. Llenar formulario ──
    log('📝 Llenando formulario...');

    try {
        // ── Helper para selects personalizados Angular ──
        async function selectAngularDropdown(placeholderText, optionText) {
            // Encontrar el .inputSelect que contiene el placeholder
            const inputs = await page.locator('.inputSelect').all();
            for (const inp of inputs) {
                const text = await inp.innerText().catch(() => '');
                if (text.includes(placeholderText)) {
                    // Click para abrir el dropdown
                    await inp.click();
                    await sleep(600);
                    // Buscar la opción en el dropdown que se abrió
                    const option = page.locator(`.contBoxSelect li:has-text("${optionText}")`).last();
                    if (await option.isVisible({ timeout: 3000 }).catch(() => false)) {
                        await option.click();
                        await sleep(300);
                        return true;
                    }
                }
            }
            return false;
        }

        // Nombre completo
        const nombreInput = page.locator('#nombre');
        if (await nombreInput.isVisible({ timeout: 3000 }).catch(() => false)) {
            const nombre = CONFIG.nombre || CONFIG.correo.split('@')[0].replace(/[._]/g, ' ');
            await nombreInput.fill(nombre);
            log('  ✓ Nombre');
        } else log('  ⚠️ No se encontró campo nombre');

        // Tipo de documento (dropdown Angular)
        const tipoDocMap = { 'CC': 'Cédula de ciudadanía', 'CE': 'Cédula de extranjería', 'NIT': 'NIT' };
        const tipoDocText = tipoDocMap[CONFIG.tipoDoc] || 'Cédula de ciudadanía';
        if (await selectAngularDropdown('Seleccione', tipoDocText)) {
            log(`  ✓ Tipo documento: ${tipoDocText}`);
        } else log('  ⚠️ No se pudo seleccionar tipo documento');

        // Número de documento
        const docInput = page.locator('#numeroDocumento');
        if (await docInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            const doc = CONFIG.doc || '0000000000';
            await docInput.fill(doc);
            log('  ✓ Documento');
        } else log('  ⚠️ No se encontró campo documento');

        // Celular DaviPlata
        const celInput = page.locator('#numeroDvplata');
        if (await celInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await celInput.fill(CONFIG.celular);
            log('  ✓ Celular');
        } else log('  ⚠️ No se encontró campo celular');

        // Confirmar celular
        const confInput = page.locator('#confirmaDvplata');
        if (await confInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await confInput.fill(CONFIG.celular);
            log('  ✓ Confirmar celular');
        }

        // Valor
        const valorInput = page.locator('input[name="valor"]');
        if (await valorInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await valorInput.fill(CONFIG.monto);
            log('  ✓ Valor');
        } else log('  ⚠️ No se encontró campo valor');

        // Banco (dropdown Angular)
        const bancoNombre = BANCOS[CONFIG.banco];
        if (!bancoNombre) {
            log(`  ❌ Código de banco ${CONFIG.banco} no encontrado en el mapeo`);
        } else if (await selectAngularDropdown('Seleccione el banco', bancoNombre)) {
            log(`  ✓ Banco: ${bancoNombre}`);
        } else {
            log(`  ⚠️ No se pudo seleccionar banco: ${bancoNombre}`);
        }

        // Correo
        const emailInput = page.locator('#emailUsuario');
        if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
            await emailInput.fill(CONFIG.correo);
            log('  ✓ Correo');
        } else log('  ⚠️ No se encontró campo correo');

        // Checkbox términos
        const chk = page.locator('input[name="authData"]');
        if (await chk.isVisible({ timeout: 2000 }).catch(() => false)) {
            await chk.check({ force: true });
            log('  ✓ Aceptar términos');
        } else log('  ⚠️ No se encontró checkbox');

        log('✅ Formulario completado');
    } catch (e) {
        log(`⚠️  Error llenando formulario: ${e.message}`);
    }

    // ── 5. Resolver captcha ──
    let captchaToken = null;
    if (CONFIG.captcha) {
        captchaToken = await solveCaptcha(CONFIG.captcha);
    }

    if (captchaToken) {
        log('🔧 Inyectando token captcha en la página...');
        // Usar evaluate para inyectar el token de reCAPTCHA vía la API de grecaptcha
        const injected = await page.evaluate((token) => {
            return new Promise((resolve) => {
                // Método 1: Usar grecaptcha.execute() si está disponible
                if (typeof grecaptcha !== 'undefined' && grecaptcha.execute) {
                    try {
                        // Buscar el widget ID
                        const widgets = document.querySelectorAll('[data-sitekey]');
                        widgets.forEach(w => {
                            const widgetId = w.getAttribute('data-widget-id');
                            if (widgetId !== null) {
                                grecaptcha.execute(parseInt(widgetId));
                            }
                        });
                        resolve('grecaptcha.execute()');
                        return;
                    } catch(e) {}
                }
                
                // Método 2: Disparar evento de callback
                const recaptchaResponse = document.querySelector('#g-recaptcha-response');
                if (recaptchaResponse) {
                    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLTextAreaElement.prototype, 'value'
                    ).set;
                    nativeInputValueSetter.call(recaptchaResponse, token);
                    recaptchaResponse.dispatchEvent(new Event('input', { bubbles: true }));
                    resolve('textarea set');
                    return;
                }
                
                resolve('no method found');
            });
        }, captchaToken);
        log(`  Inyección captcha: ${injected}`);
        
        // Esperar y verificar si el botón se habilitó
        log('⏳ Verificando si el captcha fue aceptado...');
        for (let i = 0; i < 10; i++) {
            const btnDisabled = await page.locator('button:has-text("Continuar")').isDisabled()
                .catch(() => true);
            if (!btnDisabled) {
                log('✅ Captcha aceptado — botón Continuar habilitado');
                break;
            }
            await sleep(1000);
        }
    }

    // Si después de todo el captcha no se resolvió, esperar intervención manual
    const btnFinalDisabled = await page.locator('button:has-text("Continuar")').isDisabled()
        .catch(() => true);
    if (btnFinalDisabled && !CONFIG.headless) {
        log('⚠️  Captcha no resuelto automáticamente — resuélvelo manualmente');
        log('⏳ Esperando hasta 90s...');
        for (let i = 0; i < 30; i++) {
            const disabled = await page.locator('button:has-text("Continuar")').isDisabled()
                .catch(() => true);
            if (!disabled || formSubmitted) {
                log('✅ Captcha resuelto manualmente');
                break;
            }
            await sleep(3000);
        }
    }

    // ── 6. Hacer clic en Continuar ──
    if (!formSubmitted) {
        log('🔄 Haciendo clic en "Continuar"...');
        try {
            const continuarBtn = page.locator('button:has-text("Continuar")');
            if (await continuarBtn.isEnabled({ timeout: 5000 }).catch(() => false)) {
                await continuarBtn.click();
                log('✅ Click en "Continuar" — esperando respuesta...');
                await sleep(3000);
            } else {
                log('⚠️  Botón Continuar deshabilitado');
            }
        } catch (e) {
            log(`⚠️  Error al hacer clic: ${e.message}`);
        }
    }

    // ── 7. Confirmar en pantalla de confirmación ──
    log('⏳ Buscando pantalla de confirmación...');
    await sleep(2000);

    const currentUrlAfterSubmit = page.url();
    log(`📍 URL actual: ${currentUrlAfterSubmit.substring(0, 120)}`);

    // Si estamos en confirmacion-web, buscar botón para confirmar
    if (currentUrlAfterSubmit.includes('confirmacion')) {
        log('✅ En pantalla de confirmación — buscando botón para finalizar...');

        // Hacer scroll hacia abajo para ver botones ocultos
        await page.evaluate(() => {
            // Scroll suave al fondo de la página
            window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        });
        await sleep(1000);

        // Buscar botón de PAGAR/CONFIRMAR (NO el de volver/editar)
        const confirmBtns = [
            { text: 'Meter Plata', type: 'forward' },
            { text: 'Pagar', type: 'forward' },
            { text: 'Confirmar', type: 'forward' },
            { text: 'Realizar pago', type: 'forward' },
            { text: 'Aceptar', type: 'forward' },
            { text: 'Finalizar', type: 'forward' },
        ];
        const backBtns = ['Volver', 'Editar', 'Atrás', 'Cancelar', 'Regresar', 'Modificar', 'AtráS', 'Corregir'];

        // Scroll completo para ver todos los botones
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(1500);
        // Scroll gradual hacia arriba para asegurar que vemos todo
        for (let s = 0; s < 3; s++) {
            await page.evaluate(() => window.scrollBy(0, -300));
            await sleep(300);
        }
        await sleep(1000);
        // Scroll final al fondo otra vez
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(1000);

        let clickedConfirm = false;
        for (const btnDef of confirmBtns) {
            try {
                const btns = page.locator(`button:has-text("${btnDef.text}")`);
                const count = await btns.count();
                for (let i = 0; i < count; i++) {
                    const btn = btns.nth(i);
                    if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
                        const btnText = (await btn.innerText().catch(() => '')).trim();
                        // Verificar que NO sea botón de retroceso
                        const isBack = backBtns.some(b => btnText.toLowerCase().includes(b.toLowerCase()));
                        if (!isBack && await btn.isEnabled().catch(() => false)) {
                            await btn.scrollIntoViewIfNeeded();
                            await sleep(500);
                            log(`  Click en: "${btnText.substring(0, 30)}"`);
                            await btn.click();
                            clickedConfirm = true;
                            await sleep(3000);
                            break;
                        }
                    }
                }
                if (clickedConfirm) break;
            } catch {}
        }

        if (!clickedConfirm) {
            // Fallback: buscar cualquier botón que NO sea de retroceso
            log('⚠️  Buscando botón de pago por exclusión...');
            const allButtons = await page.locator('button:visible').all();
            for (const btn of allButtons) {
                const text = (await btn.innerText().catch(() => '')).trim();
                const disabled = await btn.isDisabled().catch(() => true);
                const isBack = backBtns.some(b => text.toLowerCase().includes(b.toLowerCase()));
                if (!disabled && text && !isBack && text.length > 2) {
                    log(`  Intentando: "${text.substring(0, 40)}"`);
                    await btn.scrollIntoViewIfNeeded();
                    await sleep(300);
                    await btn.click().catch(() => {});
                    await sleep(3000);
                    break;
                }
            }
        }
    }

    // ── 8. Esperar resultado final ──
    log('⏳ Esperando resultado final de la transacción...');
    await sleep(3000);

    // ── 8. Mostrar resultado ──
    console.log('\n' + '═'.repeat(50));
    console.log('  📋 RESULTADO');
    console.log('═'.repeat(50));

    try {
        // Intentar extraer información de la página actual
        const pageText = await page.textContent('body').catch(() => '');
        const pageUrl = page.url();
        
        console.log(`  📍 URL: ${pageUrl.substring(0, 120)}`);

        if (pageUrl.includes('confirmacion')) {
            console.log('  ✅ Transacción creada — en página de confirmación');
        } else if (pageUrl.includes('transaccionexitosa')) {
            console.log('  ✅ ¡Transacción exitosa!');
        } else if (pageUrl.includes('pse010-web')) {
            console.log('  ⚠️  Aún en el formulario — la transacción no se procesó');
            console.log('  Posible causa: captcha no resuelto o campos incorrectos');
        }

        // Buscar datos de transacción en la página
        const idMatch = pageText.match(/(?:id|ID|transaccion|Transacción)[:\s]*([A-Z0-9-]+)/i);
        if (idMatch) console.log(`  🆔 ID Transacción: ${idMatch[1]}`);

        if (workflowResponse) {
            console.log(`\n  📡 Última respuesta del servidor:`);
            console.log(`  ${JSON.stringify(workflowResponse).substring(0, 500)}`);
        }

    } catch (e) {
        log(`Error leyendo resultado: ${e.message}`);
    }

    console.log('═'.repeat(50) + '\n');

    // Tomar screenshot
    try {
        await page.screenshot({ path: path.join(__dirname, 'daviplata_result.png'), fullPage: true });
        log('📸 Screenshot guardado: daviplata_result.png');
    } catch {}

    await browser.close();
    log('🌐 Navegador cerrado');
    log(`📝 Log guardado en: ${CONFIG.logFile}`);
    console.log('');
}

main().catch(e => {
    console.error('❌ Error fatal:', e.message);
    process.exit(1);
});
