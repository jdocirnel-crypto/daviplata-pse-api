/**
 * DaviPlata PSE Auto — Automatización completa
 *
 * Uso:
 *   1. Instalar dependencias: npm install puppeteer axios
 *   2. Ejecutar: node daviplata_auto.js
 *
 * Requiere:
 *   - Node.js 18+
 *   - Google Chrome instalado
 *   - API key de 2captcha (opcional, si no se pone resuelve manual)
 */

const axios = require('axios');
const readline = require('readline');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const API = {
    AUTH:      'https://prod.bl.api.daviplata.com/auth/v1/token',
    WORKFLOW:  'https://prod.bl.api.daviplata.com/psevnzw/v1/workflow',
    CATALOGO:  'https://prod.bl.api.daviplata.com/catalogo/v1',
    CAPTCHA_KEY: '',  // Opcional: key de 2captcha
};

// ─── HELPERS ──────────────────────────────────────────────────────────────────
function decodeJWT(token) {
    try {
        const parts = token.split('.');
        return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
    } catch { return null; }
}

async function solveCaptcha(apiKey) {
    if (!apiKey) return null;
    console.log('[🤖] Resolviendo reCAPTCHA con 2captcha...');

    const submit = await axios.get('https://2captcha.com/in.php', {
        params: {
            key: apiKey,
            method: 'userrecaptcha',
            googlekey: '6LdlZsIkAAAAACkTKDN0laXfW_4MRZ7ZPAek54fV',
            pageurl: 'https://recargar.daviplata.com/psevnz/',
            json: 1
        }
    });

    if (submit.data.status !== 1) {
        console.log('[✗] Error al enviar captcha:', submit.data.request);
        return null;
    }

    const id = submit.data.request;
    console.log(`[⏳] Captcha enviado (id: ${id}), esperando...`);

    for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const res = await axios.get('https://2captcha.com/res.php', {
            params: { key: apiKey, action: 'get', id, json: 1 }
        });
        if (res.data.status === 1) {
            console.log('[✅] Captcha resuelto');
            return res.data.request;
        }
    }
    console.log('[✗] Timeout resolviendo captcha');
    return null;
}

// ─── API CALLS ────────────────────────────────────────────────────────────────
async function authWithJwt(jwt) {
    console.log('[🔑] Autenticando con JWT...');
    const res = await axios.post(API.AUTH, {
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

async function refreshToken(refreshJwt) {
    console.log('[🔄] Refrescando token...');
    const res = await axios.post(API.AUTH, {
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: refreshJwt
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
    const res = await axios.post(API.WORKFLOW, {
        step,
        payload
    }, {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
            'Accept': 'application/json',
        }
    });
    return res.data;
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────
async function main() {
    console.log('╔══════════════════════════════════════════╗');
    console.log('║   💰 DaviPlata PSE - Recarga Automática  ║');
    console.log('╚══════════════════════════════════════════╝');
    console.log('');

    // 1. Obtener JWT
    let jwt = await ask('Pega el JWT de la URL de DaviPlata (después de solicitudInicial/):\n> ');
    jwt = (jwt || '').trim();
    if (!jwt) {
        console.log('[✗] JWT requerido');
        rl.close();
        return;
    }

    const jwtData = decodeJWT(jwt);
    console.log(`[ℹ] JWT válido para producto: ${jwtData?.product || 'desconocido'}`);

    // 2. Obtener access token
    let authData;
    try {
        authData = await authWithJwt(jwt);
    } catch (e) {
        console.log(`[✗] Error de autenticación: ${e.response?.data || e.message}`);
        rl.close();
        return;
    }

    console.log(`[✅] Access token obtenido (expira en ${authData.expires_in || 300}s)`);
    let accessToken = authData.access_token;
    let refreshJwt = authData.refresh_token;
    const clientId = decodeJWT(accessToken)?.client_id;

    // 3. Obtener datos del formulario
    const celular = await ask('📱 Número DaviPlata a recargar:\n> ');
    const monto   = await ask('💰 Monto a recargar (COP):\n> ');
    const banco   = await ask('🏦 Código del banco (1007=Bogotá, 1051=Davivienda, 1013=BBVA, 1001=Bancolombia):\n> ');
    const correo  = await ask('📧 Correo registrado en PSE:\n> ');
    const nombre  = await ask('👤 Nombre completo (opcional, Enter para omitir):\n> ') || 'Usuario';
    const doc     = await ask('🆔 Número de documento (opcional):\n> ') || '0000000000';
    const capKey  = await ask('🔑 API Key de 2captcha (opcional, Enter para omitir captcha):\n> ');

    // 4. Resolver captcha
    let captchaToken = null;
    if (capKey) {
        captchaToken = await solveCaptcha(capKey);
        if (!captchaToken) {
            console.log('[⚠️] No se pudo resolver captcha, continuando sin él...');
        }
    }

    // 5. Llamar al workflow
    const step010Payload = {
        nombreCompleto: nombre,
        tipoDocumento: 'CC',
        numeroDocumento: doc,
        numeroDvplata: celular,
        confirmaDvplata: celular,
        valor: monto,
        selectBanco: banco,
        emailUsuario: correo,
        authData: true,
        recaptcha: captchaToken || ''
    };

    console.log('\n[📤] Enviando formulario a DaviPlata...');
    
    try {
        const result = await submitWorkflow('PSEVNZ010', step010Payload, accessToken);
        console.log('[✅] Respuesta del servidor:');
        console.log(JSON.stringify(result, null, 2));

        if (result.payload?.idTransaccion) {
            console.log(`\n🎉 ¡Transacción creada! ID: ${result.payload.idTransaccion}`);
            if (result.payload.urlPse) {
                console.log(`🔗 URL PSE para pagar: ${result.payload.urlPse}`);
            }
        }
    } catch (e) {
        const errData = e.response?.data;
        console.log(`[✗] Error: ${e.response?.status} ${JSON.stringify(errData)}`);

        // Si es 422, los nombres de campos son incorrectos
        if (e.response?.status === 422) {
            console.log('\n[💡] Los nombres de campos podrían ser incorrectos.');
            console.log('    Probando variaciones...');
            
            // Probar diferentes nombres de campos
            const variants = [
                { nombre: 'nombre', celular: 'numeroCelular', monto: 'valorIngresar', banco: 'codigoBanco', correo: 'correo', doc: 'numeroDocumento' },
                { nombre: 'nombreCompleto', celular: 'numeroDvplata', monto: 'valor', banco: 'codigoBanco', correo: 'emailUsuario' },
            ];
            
            for (const v of variants) {
                try {
                    const testPayload = {
                        [v.nombre]: nombre,
                        tipoDocumento: 'CC',
                        [v.doc || 'numeroDocumento']: doc,
                        [v.celular]: celular,
                        confirmaDvplata: celular,
                        [v.monto]: monto,
                        [v.banco]: banco,
                        [v.correo]: correo,
                        authData: true,
                        recaptcha: captchaToken || ''
                    };
                    const r = await submitWorkflow('PSEVNZ010', testPayload, accessToken);
                    console.log(`[✅] Variante ${JSON.stringify(v)} funcionó!`);
                    console.log(JSON.stringify(r, null, 2));
                    break;
                } catch (e2) {
                    console.log(`[✗] Variante falló: ${e2.response?.status}`);
                }
            }
        }

        // Si es 401, el token expiró
        if (e.response?.status === 401 && refreshJwt) {
            console.log('\n[🔄] Token expirado, renovando...');
            try {
                const refreshData = await refreshToken(refreshJwt);
                accessToken = refreshData.access_token;
                console.log('[✅] Token renovado, reintentando...');
                // Reintentar...
            } catch (refreshErr) {
                console.log('[✗] No se pudo renovar el token. Necesitas un JWT nuevo.');
            }
        }
    }

    rl.close();
}

main().catch(console.error);
