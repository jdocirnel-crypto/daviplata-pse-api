/**
 * DaviPlata PSE — Captura la llamada API real
 * Abre DaviPlata, obtiene JWT, llena el formulario, 
 * y captura la petición exacta al hacer clic en "Continuar"
 */

const { chromium } = require('playwright');
const axios = require('axios');

const AUTH_URL = 'https://prod.bl.api.daviplata.com/auth/v1/token';
const CELULAR  = process.argv[2] || '3137016591';
const MONTO    = process.argv[3] || '50000';
const BANCO    = process.argv[4] || '1007';
const CORREO   = process.argv[5] || 'maria1@hotmail.com';
const NOMBRE   = process.argv[6] || 'Juan Perez';
const DOC      = process.argv[7] || '87678678';

async function main() {
    console.log('🚀 Abriendo navegador...');
    const browser = await chromium.launch({
        headless: false,  // Mostrar el navegador para ver qué pasa
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 900 },
        locale: 'es-CO'
    });

    const page = await context.newPage();

    // Interceptar TODAS las peticiones POST a workflow
    const capturedRequests = [];
    page.on('request', req => {
        if (req.url().includes('workflow') && req.method() === 'POST') {
            capturedRequests.push({
                url: req.url(),
                method: req.method(),
                headers: req.headers(),
                postData: req.postData()
            });
        }
    });

    // También capturar respuestas
    page.on('response', resp => {
        if (resp.url().includes('workflow')) {
            resp.text().then(text => {
                console.log(`\n📡 WORKFLOW RESPONSE [${resp.status()}]:`);
                console.log(text.substring(0, 2000));
            }).catch(() => {});
        }
    });

    // Navegar
    console.log('📡 Navegando a DaviPlata...');
    await page.goto('https://www.daviplata.com/recargar-con-pse', {
        waitUntil: 'networkidle',
        timeout: 30000
    });

    // Esperar a que cargue el formulario
    console.log('⏳ Esperando formulario...');
    await page.waitForTimeout(3000);

    const url = page.url();
    console.log(`📍 URL actual: ${url.substring(0, 120)}`);

    // Llenar formulario
    console.log('📝 Llenando formulario...');
    
    // Nombre
    const nombreInput = page.locator('#nombre');
    await nombreInput.fill(NOMBRE);
    console.log('  ✓ Nombre');

    // Número de documento
    const docInput = page.locator('#numeroDocumento');
    await docInput.fill(DOC);
    console.log('  ✓ Documento');

    // Número DaviPlata
    const celInput = page.locator('#numeroDvplata');
    await celInput.fill(CELULAR);
    console.log('  ✓ Celular');

    // Confirmar número
    const confInput = page.locator('#confirmaDvplata');
    await confInput.fill(CELULAR);
    console.log('  ✓ Confirmar celular');

    // Valor
    const valorInput = page.locator('input[name="valor"]');
    await valorInput.fill(MONTO);
    console.log('  ✓ Valor');

    // Correo
    const emailInput = page.locator('#emailUsuario');
    await emailInput.fill(CORREO);
    console.log('  ✓ Correo');

    // Checkbox
    const chk = page.locator('input[name="authData"]');
    await chk.check();
    console.log('  ✓ Checkbox');

    console.log('\n✅ Formulario llenado. Ahora resuelve el captcha manualmente');
    console.log('   y haz clic en "Continuar"...');
    console.log('   (tienes 60 segundos)\n');

    // Esperar a que se haga clic en Continuar o que se capture una request
    await page.waitForTimeout(60000);

    // Mostrar requests capturadas
    if (capturedRequests.length > 0) {
        console.log('\n📡 REQUESTS CAPTURADAS:');
        capturedRequests.forEach((req, i) => {
            console.log(`\n--- REQUEST ${i + 1} ---`);
            console.log(`URL: ${req.url}`);
            console.log(`POST DATA: ${req.postData}`);
        });
    } else {
        console.log('\n⚠️  No se capturaron requests al workflow');
        console.log('Posiblemente el botón Continuar no se habilitó (captcha pendiente)');
    }

    await browser.close();
}

main().catch(console.error);
