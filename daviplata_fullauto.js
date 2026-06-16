/**
 * DaviPlata PSE — FULLY AUTOMATIC
 * No necesita intervención manual.
 * 
 * Uso:
 *   npm install playwright
 *   node daviplata_fullauto.js --celular=3137016591 --monto=50000 --banco=1007 --correo=email@test.com
 *
 * Parámetros:
 *   --celular   Número DaviPlata a recargar
 *   --monto     Valor en COP
 *   --banco     Código del banco (1007=Bogotá, 1051=Davivienda, 1013=BBVA, etc.)
 *   --correo    Correo registrado en PSE
 *   --nombre    (opcional) Nombre completo
 *   --doc       (opcional) Número de documento
 *   --captcha   (opcional) API key de 2captcha
 *   --headless  (opcional) "true" para modo invisible
 */

const { chromium } = require('playwright');
const axios = require('axios');

// ─── PARSE ARGS ──────────────────────────────────────────────────────────────
const args = {};
process.argv.slice(2).forEach(arg => {
    const m = arg.match(/^--(\w+)=(.+)$/);
    if (m) args[m[1]] = m[2];
});

const CELULAR   = args.celular;
const MONTO     = args.monto;
const BANCO     = args.banco;
const CORREO    = args.correo;
const NOMBRE    = args.nombre || 'Juan Perez';
const DOC       = args.doc || '87678678';
const CAP_KEY   = args.captcha || '';
const HEADLESS  = args.headless === 'true';

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const AUTH_URL     = 'https://prod.bl.api.daviplata.com/auth/v1/token';
const WORKFLOW_URL = 'https://prod.bl.api.daviplata.com/psevnzw/v1/workflow';

function decodeJWT(token) {
    try {
        return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    } catch { return null; }
}

function log(msg) {
    console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);
}

// ─── 2CAPTCHA ────────────────────────────────────────────────────────────────
async function solveCaptcha(apiKey) {
    if (!apiKey) {
        log('⚠️  No captcha key — se usará token vacío');
        return '';
    }
    log('🤖 Resolviendo reCAPTCHA con 2captcha...');
    const submit = await axios.get('https://2captcha.com/in.php', {
        params: { key: apiKey, method: 'userrecaptcha',
            googlekey: '6LdlZsIkAAAAACkTKDN0laXfW_4MRZ7ZPAek54fV',
            pageurl: 'https://recargar.daviplata.com/psevnz/', json: 1 }
    });
    if (submit.data.status !== 1) {
        log(`✗ Error captcha: ${submit.data.request}`);
        return '';
    }
    const id = submit.data.request;
    log(`⏳ Captcha enviado (id: ${id})...`);
    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const res = await axios.get('https://2captcha.com/res.php', {
            params: { key: apiKey, action: 'get', id, json: 1 }
        });
        if (res.data.status === 1) {
            log('✅ Captcha resuelto');
            return res.data.request;
        }
    }
    log('✗ Timeout captcha');
    return '';
}

// ─── API ─────────────────────────────────────────────────────────────────────
async function authWithJwt(jwt) {
    const res = await axios.post(AUTH_URL, {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: jwt
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'Origin': 'https://recargar.daviplata.com',
            'Referer': 'https://recargar.daviplata.com/',
        }
    });
    return res.data;
}

async function submitWorkflow(step, payload, accessToken) {
    const res = await axios.post(WORKFLOW_URL, { step, payload }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
        }
    });
    return res.data;
}

// ─── TRY DIFFERENT FIELD NAMES ──────────────────────────────────────────────
async function trySubmit(accessToken, captchaToken) {
    const fieldVariants = [
        // Variant 1: Mixed names from HTML form
        {
            nombreCompleto: NOMBRE,
            tipoDocumento: 'CC',
            numeroDocumento: DOC,
            numeroDvplata: CELULAR,
            confirmaDvplata: CELULAR,
            valor: MONTO,
            codigoBanco: BANCO,
            emailUsuario: CORREO,
            authData: true,
            recaptcha: captchaToken
        },
        // Variant 2: Using celular/monto
        {
            nombre: NOMBRE,
            tipoDocumento: 'CC',
            numeroDocumento: DOC,
            numeroCelular: CELULAR,
            valorIngresar: MONTO,
            codigoBanco: BANCO,
            correo: CORREO,
            aceptaTerminos: true,
            recaptcha: captchaToken
        },
        // Variant 3: selectBanco
        {
            nombre: NOMBRE,
            tipoDocumento: 'CC',
            numeroDocumento: DOC,
            numeroDvplata: CELULAR,
            valor: MONTO,
            selectBanco: BANCO,
            emailUsuario: CORREO,
            authData: true,
            recaptcha: captchaToken
        },
    ];

    for (let i = 0; i < fieldVariants.length; i++) {
        try {
            log(`📤 Probando variante ${i + 1}...`);
            const result = await submitWorkflow('PSEVNZ010', fieldVariants[i], accessToken);
            log(`✅ Variante ${i + 1} FUNCIONÓ!`);
            log(JSON.stringify(result, null, 2));
            return result;
        } catch (e) {
            log(`✗ Variante ${i + 1} falló: ${e.response?.status} ${JSON.stringify(e.response?.data)}`);
        }
    }
    return null;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    if (!CELULAR || !MONTO || !BANCO || !CORREO) {
        console.log('╔══════════════════════════════════════════╗');
        console.log('║   💰 DaviPlata PSE - FULL AUTO v1       ║');
        console.log('╚══════════════════════════════════════════╝');
        console.log('');
        console.log('Uso: node daviplata_fullauto.js \\');
        console.log('  --celular=3137016591 --monto=50000 --banco=1007 \\');
        console.log('  --correo=email@test.com --captcha=TU_API_KEY');
        console.log('');
        console.log('Bancos: 1007=Bogotá, 1051=Davivienda, 1013=BBVA,');
        console.log('        1001=Bancolombia, 1032=Caja Social, 1507=Nequi');
        console.log('        1062=Banco W, 1066=Lulo Bank, 1151=Rappipay');
        process.exit(1);
    }

    log('🚀 Iniciando automatización completa de DaviPlata PSE...');

    // 1. Abrir navegador y obtener JWT
    log('🌐 Abriendo navegador para obtener JWT...');
    const browser = await chromium.launch({
        headless: HEADLESS,
        args: ['--no-sandbox', '--disable-blink-features=AutomationControlled']
    });

    const context = await browser.newContext({
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
        viewport: { width: 1920, height: 1080 },
        locale: 'es-CO'
    });

    const page = await context.newPage();

    try {
        // Interceptar todas las URLs para capturar el JWT
        let capturedJwt = null;
        page.on('framenavigated', frame => {
            const url = frame.url();
            const m = url.match(/solicitudInicial\/([^/?#]+)/);
            if (m) capturedJwt = m[1];
        });

        // Navegar a la página de DaviPlata
        log('📡 Navegando a www.daviplata.com/recargar-con-pse...');
        await page.goto('https://www.daviplata.com/recargar-con-pse', {
            waitUntil: 'networkidle',
            timeout: 30000
        });

        // Esperar que llegue a la página del formulario PSE
        log('⏳ Esperando carga del formulario PSE...');
        await page.waitForURL(/pse010-web|formulariodatos/, { timeout: 20000 })
            .catch(() => log('⚠️  Timeout esperando URL específica, continuando...'));

        // Intentar obtener JWT de la URL capturada
        let jwt = capturedJwt;

        // Si no se capturó, intentar desde localStorage (refresh token)
        if (!jwt) {
            log('🔍 Buscando token en localStorage...');
            jwt = await page.evaluate(() => 
                localStorage.getItem('refresh-token') || localStorage.getItem('access-token')
            );
        }

        if (!jwt) {
            log('✗ No se encontró ningún token');
            log(`URL actual: ${page.url().substring(0, 150)}`);
            await browser.close();
            process.exit(1);
        }

        const jwtData = decodeJWT(jwt);
        log(`✅ JWT obtenido! Producto: ${jwtData?.product || 'N/A'}`);
        log(`   Expira: ${new Date((jwtData?.exp || 0) * 1000).toLocaleTimeString()}`);

        await browser.close();
        log('🌐 Navegador cerrado');

        // 2. Autenticar con el JWT
        log('🔑 Autenticando con el JWT...');
        const authData = await authWithJwt(jwt);
        const accessToken = authData.access_token;
        const refreshJwt = authData.refresh_token;
        log(`✅ Access token obtenido!`);

        // 3. Resolver captcha
        const captchaToken = await solveCaptcha(CAP_KEY);

        // 4. Enviar formulario
        log('📤 Enviando formulario de recarga...');
        const result = await trySubmit(accessToken, captchaToken);

        if (result) {
            console.log('');
            console.log('╔══════════════════════════════════════════╗');
            console.log('║   ✅ ¡PROCESO COMPLETADO!               ║');
            console.log('╚══════════════════════════════════════════╝');
            if (result.payload?.idTransaccion) {
                console.log(`📋 ID Transacción: ${result.payload.idTransaccion}`);
            }
            if (result.payload?.urlPse) {
                console.log(`🔗 URL PSE: ${result.payload.urlPse}`);
            }
        } else {
            log('✗ No se pudo completar la transacción');
        }

    } catch (e) {
        log(`✗ Error: ${e.message}`);
        try {
            log(`URL actual: ${page.url().substring(0, 150)}`);
        } catch {}
        await browser.close();
    }
}

main().catch(console.error);
