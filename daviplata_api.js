/**
 * ╔═══════════════════════════════════════════════════════════════╗
 * ║   DaviPlata PSE API Server                                  ║
 * ║                                                             ║
 * ║  Servicio REST que mantiene un navegador persistente        ║
 * ║  para procesar recargas a DaviPlata vía PSE.                ║
 * ║                                                             ║
 * ║  Un solo link → redirige al usuario directo a PSE           ║
 * ╚═══════════════════════════════════════════════════════════════╝
 *
 * Inicio:
 *   SET CAPTCHA_KEY=7fcc7b08476323f7febd6c3f18044e78
 *   node daviplata_api.js
 *
 * Uso:
 *   http://localhost:3000/pagar?celular=3137016591&monto=50000&banco=1007&correo=email@test.com
 *
 *   Parámetros: celular, monto, banco, correo, nombre(opcional), doc(opcional)
 */

const express = require('express');
const { chromium } = require('playwright');
const axios = require('axios');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const CAPTCHA_KEY = process.env.CAPTCHA_KEY || '7fcc7b08476323f7febd6c3f18044e78';
const CAPTCHA_SITE_KEY = '6LdlZsIkAAAAACkTKDN0laXfW_4MRZ7ZPAek54fV';

// ─── BANCOS ──────────────────────────────────────────────────────────────────
const BANCOS = {
    '1007': 'BANCO DE BOGOTA', '1051': 'DAVIbank S.A.',
    '1052': 'BANCO AV VILLAS', '1013': 'BANCO BBVA COLOMBIA S.A.',
    '1001': 'BANCOLOMBIA', '1032': 'BANCO CAJA SOCIAL',
    '1507': 'NEQUI', '1151': 'RAPPIPAY', '1066': 'LULO BANK',
    '1019': 'SCOTIABANK COLPATRIA', '1006': 'BANCO ITAU',
    '1060': 'BANCO FALABELLA', '1040': 'BANCO AGRARIO',
    '1002': 'BANCO POPULAR', '1058': 'BANCO DE OCCIDENTE',
    '1062': 'BANCO GNB SUDAMERIS', '1111': 'BANCO PICHINCHA S.A.',
};

const BANCO_NOMBRES = {};
for (const [k, v] of Object.entries(BANCOS)) BANCO_NOMBRES[k] = v;

// ─── ESTADO GLOBAL ───────────────────────────────────────────────────────────
let browser = null;
let context = null;
let page = null;
let browserReady = false;
let lastActivity = Date.now();
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 min

function log(msg) {
    const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
    console.log(line);
    try { fs.appendFileSync('daviplata_api.log', line + '\n'); } catch {}
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── 2CAPTCHA ────────────────────────────────────────────────────────────────
async function solveCaptcha() {
    if (!CAPTCHA_KEY) return null;
    log('🤖 Resolviendo captcha...');
    for (let a = 1; a <= 2; a++) {
        try {
            const submit = await axios.get('https://2captcha.com/in.php', {
                params: { key: CAPTCHA_KEY, method: 'userrecaptcha',
                    googlekey: CAPTCHA_SITE_KEY,
                    pageurl: 'https://recargar.daviplata.com/psevnz/', json: 1 }
            });
            if (submit.data.status !== 1) {
                log(`  Error: ${submit.data.request}`);
                await sleep(3000); continue;
            }
            const id = submit.data.request;
            for (let i = 0; i < 20; i++) {
                await sleep(2000);
                const res = await axios.get('https://2captcha.com/res.php', {
                    params: { key: CAPTCHA_KEY, action: 'get', id, json: 1 }
                });
                if (res.data.status === 1) return res.data.request;
            }
        } catch (e) { log(`  Error: ${e.message}`); }
        await sleep(2000);
    }
    return null;
}

// ─── SELECTOR ANGULAR ────────────────────────────────────────────────────────
async function selectAngularDropdown(placeholderText, optionText) {
    const inputs = await page.locator('.inputSelect').all();
    for (const inp of inputs) {
        const text = await inp.innerText().catch(() => '');
        if (text.includes(placeholderText)) {
            await inp.click();
            await sleep(500);
            const option = page.locator(`.contBoxSelect li:has-text("${optionText}")`).last();
            if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
                await option.click();
                await sleep(200);
                return true;
            }
        }
    }
    return false;
}

// ─── INICIAR NAVEGADOR ───────────────────────────────────────────────────────
async function initBrowser() {
    log('🚀 Iniciando navegador persistente...');
    browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });
    context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        viewport: { width: 1280, height: 900 },
        locale: 'es-CO',
    });
    page = await context.newPage();
    browserReady = true;
    log('✅ Navegador listo');
}

// ─── PROCESAR PAGO ───────────────────────────────────────────────────────────
async function processPayment(params) {
    if (!browserReady || !page) {
        await initBrowser();
    }

    // Si pasaron más de 4 min, refrescar sesión
    if (Date.now() - lastActivity > 240000) {
        log('🔄 Sesión antigua, refrescando...');
        await page.goto('about:blank');
    }

    // 1. Ir a DaviPlata
    log('📡 Navegando a DaviPlata...');
    await page.goto('https://www.daviplata.com/recargar-con-pse', {
        waitUntil: 'domcontentloaded', timeout: 25000
    }).catch(() => {});
    
    // 2. Esperar formulario
    try {
        await page.waitForURL(/pse010-web|formulariodatos/, { timeout: 20000 });
    } catch {}
    await sleep(2000);

    // 3. Llenar formulario
    log('📝 Llenando formulario...');
    
    const nombreInput = page.locator('#nombre');
    if (await nombreInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await nombreInput.fill(params.nombre);
    }

    await selectAngularDropdown('Seleccione', 'Cédula de ciudadanía');

    const docInput = page.locator('#numeroDocumento');
    if (await docInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await docInput.fill(params.doc);
    }

    const celInput = page.locator('#numeroDvplata');
    if (await celInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await celInput.fill(params.celular);
    }

    const confInput = page.locator('#confirmaDvplata');
    if (await confInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confInput.fill(params.celular);
    }

    const valorInput = page.locator('input[name="valor"]');
    if (await valorInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await valorInput.fill(params.monto);
    }

    const bancoNombre = BANCO_NOMBRES[params.banco];
    if (bancoNombre) {
        await selectAngularDropdown('Seleccione el banco', bancoNombre);
    }

    const emailInput = page.locator('#emailUsuario');
    if (await emailInput.isVisible({ timeout: 2000 }).catch(() => false)) {
        await emailInput.fill(params.correo);
    }

    const chk = page.locator('input[name="authData"]');
    if (await chk.isVisible({ timeout: 2000 }).catch(() => false)) {
        await chk.check({ force: true });
    }

    log('✅ Formulario listo');

    // 4. Captcha
    const captchaToken = await solveCaptcha();
    if (captchaToken) {
        await page.evaluate((token) => {
            const ta = document.querySelector('#g-recaptcha-response');
            if (ta) {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                setter.call(ta, token);
                ta.dispatchEvent(new Event('input', { bubbles: true }));
            }
        }, captchaToken);
        await sleep(2000);
    }

    // 5. Click Continuar
    log('🔄 Click en Continuar...');
    try {
        const btn = page.locator('button:has-text("Continuar")');
        await btn.waitFor({ state: 'visible', timeout: 5000 });
        const disabled = await btn.isDisabled().catch(() => true);
        if (!disabled) {
            await btn.click();
            await sleep(3000);
        }
    } catch {}

    // 6. Confirmar - esperar a que cargue la confirmación
    await sleep(3000);
    const urlAfter = page.url();
    log(`📍 ${urlAfter.includes('confirmacion') ? '✅ Confirmación' : urlAfter.substring(0, 80)}`);

    if (urlAfter.includes('confirmacion')) {
        log('🔄 Buscando botón "Meter Plata"...');
        
        // Scroll varias veces para asegurar que vemos todo
        for (let s = 0; s < 5; s++) {
            await page.evaluate(() => window.scrollBy(0, 500));
            await sleep(500);
        }
        await sleep(2000);
        // Scroll al fondo
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await sleep(1500);
        // Scroll un poco hacia arriba
        await page.evaluate(() => window.scrollBy(0, -200));
        await sleep(1000);

        // Buscar "Meter Plata" con varios intentos
        let clicked = false;
        const textos = ['Meter Plata', 'meter plata', 'Pagar', 'pagar', 'Confirmar', 'confirmar'];
        for (const texto of textos) {
            try {
                const btn = page.locator(`button:has-text("${texto}")`).first();
                if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
                    const txt = (await btn.innerText().catch(() => '')).trim();
                    const disabled = await btn.isDisabled().catch(() => true);
                    if (!disabled && txt) {
                        log(`  Click en: "${txt.substring(0, 30)}"`);
                        await btn.scrollIntoViewIfNeeded();
                        await sleep(500);
                        await btn.click();
                        clicked = true;
                        await sleep(5000);
                        break;
                    }
                }
            } catch {}
        }

        // Fallback: cualquier botón que no sea Modificar/Volver
        if (!clicked) {
            log('⚠️  Buscando botón por exclusión...');
            const backWords = ['modificar', 'volver', 'editar', 'atrás', 'cancelar', 'regresar', 'corregir'];
            const allBtns = await page.locator('button:visible').all();
            for (const btn of allBtns) {
                const text = (await btn.innerText().catch(() => '')).trim();
                const disabled = await btn.isDisabled().catch(() => true);
                const isBack = backWords.some(b => text.toLowerCase().includes(b));
                if (!disabled && text && !isBack && text.length > 2) {
                    log(`  Fallback click: "${text.substring(0, 40)}"`);
                    await btn.scrollIntoViewIfNeeded();
                    await sleep(500);
                    await btn.click().catch(() => {});
                    await sleep(5000);
                    break;
                }
            }
        }
    }

    // 7. Obtener URL final (PSE)
    await sleep(2000);
    const finalUrl = page.url();
    lastActivity = Date.now();
    
    log(`🏁 URL final: ${finalUrl.substring(0, 120)}`);
    
    // Extraer URL PSE si es redirección
    if (finalUrl.includes('pse.com.co') || finalUrl.includes('registro.pse')) {
        return { success: true, url: finalUrl, pse: true };
    } else if (finalUrl.includes('transaccionexitosa')) {
        return { success: true, url: finalUrl, pse: false, message: 'Transacción exitosa' };
    } else {
        return { success: true, url: finalUrl, pse: false, message: 'Revisar estado' };
    }
}

// ─── EXPRESS API ──────────────────────────────────────────────────────────────
const app = express();

app.get('/pagar', async (req, res) => {
    const { celular, monto, banco, correo, nombre, doc, tipo_doc } = req.query;

    // Validar
    if (!celular || !monto || !banco || !correo) {
        return res.status(400).json({
            error: 'Faltan parámetros',
            uso: '/pagar?celular=3137016591&monto=50000&banco=1007&correo=email@test.com',
            bancos: Object.fromEntries(Object.entries(BANCO_NOMBRES).map(([k, v]) => [k, v]))
        });
    }

    if (!BANCO_NOMBRES[banco]) {
        return res.status(400).json({ error: `Banco "${banco}" no válido` });
    }

    // ── MODO HTML: página de carga con auto-form ──
    log(`\n══════ NUEVA RECARGA ══════`);
    log(`📱 ${celular} | 💰 $${parseInt(monto).toLocaleString()} | 🏦 ${BANCO_NOMBRES[banco]} (${banco})`);

    const bancoNombre = BANCO_NOMBRES[banco] || banco;
    const montoFormato = parseInt(monto).toLocaleString('es-CO');
    const formId = 'f-' + Date.now();

    res.send(`<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PSE - Procesando pago</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;
background:#f5f7fa;min-height:100vh;display:flex;justify-content:center;
align-items:center;padding:20px}
.card{background:#fff;border-radius:12px;padding:2.5em;width:440px;
max-width:100%;box-shadow:0 2px 12px rgba(0,0,0,.08);text-align:center}
.pse-logo{background:#00695c;color:#fff;width:60px;height:60px;
border-radius:50%;display:flex;align-items:center;justify-content:center;
margin:0 auto 16px;font-weight:700;font-size:22px;letter-spacing:1px}
h2{color:#1a1a1a;margin-bottom:4px;font-size:1.25em;font-weight:600}
.sub{color:#666;font-size:.85em;margin-bottom:20px}
.spinner{width:40px;height:40px;border:3px solid #e0e0e0;
border-top-color:#00695c;border-radius:50%;animation:spin .7s linear infinite;
margin:0 auto 18px}
@keyframes spin{to{transform:rotate(360deg)}}
.detalles{background:#f8f9fa;border-radius:8px;padding:14px 16px;
margin:0 0 16px;text-align:left;font-size:.88em}
.detalles .fila{display:flex;justify-content:space-between;
padding:5px 0;border-bottom:1px solid #eee}
.detalles .fila:last-child{border-bottom:none}
.detalles .lbl{color:#888}
.detalles .val{color:#1a1a1a;font-weight:500}
.estado{color:#00695c;font-size:.82em;font-weight:500}
</style></head><body>
<div class="card">
<div class="pse-logo">PSE</div>
<h2>Procesando pago</h2>
<p class="sub">Por favor espera, esto tomara unos segundos...</p>
<div class="spinner"></div>
<div class="detalles">
<div class="fila"><span class="lbl">Celular DaviPlata</span><span class="val">${celular}</span></div>
<div class="fila"><span class="lbl">Valor a pagar</span><span class="val">$${montoFormato}</span></div>
<div class="fila"><span class="lbl">Banco</span><span class="val">${bancoNombre}</span></div>
<div class="fila"><span class="lbl">Correo PSE</span><span class="val">${correo}</span></div>
</div>
<div class="estado" id="estado">Procesando, por favor espera...</div>
<form id="${formId}" method="POST" action="/procesar">
<input type="hidden" name="celular" value="${celular.replace(/"/g,'')}">
<input type="hidden" name="monto" value="${monto}">
<input type="hidden" name="banco" value="${banco}">
<input type="hidden" name="correo" value="${correo.replace(/"/g,'')}">
<input type="hidden" name="nombre" value="${(nombre || correo.split('@')[0]).replace(/"/g,'')}">
<input type="hidden" name="doc" value="${doc || '0000000000'}">
</form>
<script>document.getElementById('${formId}').submit();</script>
</body></html>`);
});

// Endpoint POST para procesar (recibe JSON o form-urlencoded)
app.post('/procesar', express.urlencoded({ extended: true }), express.json(), async (req, res) => {
    const { celular, monto, banco, correo, nombre, doc, tipo_doc } = req.body;

    if (!celular || !monto || !banco || !correo) {
        return res.status(400).send('Faltan parámetros - <a href="/">Volver</a>');
    }

    const params = {
        celular, monto, banco, correo,
        nombre: nombre || correo.split('@')[0].replace(/[._]/g, ' '),
        doc: doc || '0000000000',
        tipo_doc: tipo_doc || 'CC'
    };

    try {
        log(`📡 Procesando recarga de $${parseInt(monto).toLocaleString()} a ${celular}...`);
        const result = await processPayment(params);
        if (result.pse && result.url) {
            log(`➡️  Redirigiendo a PSE`);
            // Redirigir a PSE
            res.redirect(result.url);
        } else {
            res.send(`<h3>Procesado</h3><p>URL: ${result.url}</p><a href="${result.url}">Continuar</a>`);
        }
    } catch (e) {
        log(`❌ Error: ${e.message}`);
        res.status(500).send(`Error: ${e.message} - <a href="/">Volver</a>`);
    }
});

app.get('/', (req, res) => {
    res.json({
        nombre: 'DaviPlata PSE API',
        version: '1.0',
        endpoints: {
            '/pagar': 'GET ?celular=&monto=&banco=&correo=&nombre=&doc=',
            '/health': 'GET - estado del servicio'
        },
        bancos: Object.fromEntries(Object.entries(BANCO_NOMBRES).map(([k, v]) => [k, v])),
        uso: '/pagar?celular=3137016591&monto=50000&banco=1007&correo=email@test.com'
    });
});

app.get('/health', (req, res) => {
    res.json({
        status: browserReady ? 'ok' : 'starting',
        uptime: Math.floor((Date.now() - lastActivity) / 1000) + 's desde última actividad',
        session_age: browserReady ? Math.floor((Date.now() - lastActivity) / 1000) + 's' : 'n/a'
    });
});

// ─── INICIO ──────────────────────────────────────────────────────────────────
async function start() {
    log('╔══════════════════════════════════════════╗');
    log('║   DaviPlata PSE API Server             ║');
    log('╚══════════════════════════════════════════╝');
    
    await initBrowser();

    app.listen(PORT, () => {
        log(`✅ Servidor corriendo en http://localhost:${PORT}`);
        log(`📱 Uso: http://localhost:${PORT}/pagar?celular=...&monto=...&banco=...&correo=...`);
    });
}

start().catch(e => {
    console.error('❌ Error fatal:', e);
    process.exit(1);
});

// ─── RECICLAJE ───────────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
    log('🛑 Apagando...');
    if (browser) await browser.close();
    process.exit(0);
});
