const path = require('path');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

const db = require('./database/db');
const {
  menuPrincipal,
  menuRecarga,
  msgSaldo,
  msgHistorico,
  OPCOES_MENU,
} = require('./handlers/menu');
const {
  processarCompra,
  confirmarCompra,
  processarRecarga,
  getEstado,
  setEstado,
  limparEstado,
} = require('./handlers/pedidos');
const { isAdmin, processarAdmin, setEnviarParaTodos } = require('./handlers/admin');

const LOGGER = pino({ level: process.env.LOG_LEVEL || 'info' });

function numeroParaJid(numero) {
  const clean = String(numero || '').replace(/\D/g, '');
  return clean.includes('@') ? clean : `${clean}@s.whatsapp.net`;
}

function textoDaMensagem(msg) {
  return (
    msg?.conversation ||
    msg?.extendedTextMessage?.text ||
    msg?.imageMessage?.caption ||
    msg?.videoMessage?.caption ||
    msg?.buttonsResponseMessage?.selectedButtonId ||
    msg?.listResponseMessage?.singleSelectReply?.selectedRowId ||
    ''
  ).trim();
}

function nomeRemetente(m) {
  return m.pushName || m.notifyName || m.verifiedBizName || 'Cliente';
}

function deveIgnorarMensagem(msg) {
  const remoteJid = msg?.key?.remoteJid || '';
  if (!remoteJid) return true;
  if (msg.key?.fromMe) return true;
  return remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast';
}

async function iniciarBot() {
  const authFolder = path.join(process.cwd(), 'auth_session');
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    auth: state,
    version,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
    defaultQueryTimeoutMs: 60_000,
    syncFullHistory: false,
    markOnlineOnConnect: false,
  });

  async function enviarTexto(numero, texto, salvar = true) {
    const jid = numeroParaJid(numero);
    await sock.sendMessage(jid, { text: texto });
    if (salvar) db.salvarMensagem(String(numero).replace(/\D/g, ''), 'Cliente', 'enviada', texto);
  }

  setEnviarParaTodos(async (numero, mensagem) => {
    await enviarTexto(numero, mensagem);
  });

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      qrcode.generate(qr, { small: true });
      LOGGER.info('Escaneie o QR code para conectar o WhatsApp');
    }

    if (connection === 'open') LOGGER.info('✅ WhatsApp conectado');

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      LOGGER.warn({ statusCode }, 'Conexão do WhatsApp fechada');
      if (shouldReconnect) {
        LOGGER.info('Tentando reconectar em 5s...');
        setTimeout(() => {
          iniciarBot().catch((error) => LOGGER.error({ error }, 'Erro ao reconectar bot'));
        }, 5000);
      } else {
        LOGGER.error('Sessão desconectada. Apague auth_session e reconecte.');
      }
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ type, messages }) => {
    if (type !== 'notify') return;
    const m = messages?.[0];
    if (!m || deveIgnorarMensagem(m)) return;

    const texto = textoDaMensagem(m.message);
    if (!texto) return;

    const numero = (m.key.remoteJid || '').split('@')[0];
    const nome = nomeRemetente(m);

    db.criarUsuario(numero, nome);
    db.salvarMensagem(numero, nome, 'recebida', texto);

    try {
      if (isAdmin(numero) && texto.startsWith('!')) {
        await processarAdmin(numero, texto, (msg) => enviarTexto(numero, msg));
        return;
      }

      const estado = getEstado(numero);
      const textoNormalizado = texto.toLowerCase();

      if (textoNormalizado === '0' || textoNormalizado === 'menu') {
        limparEstado(numero);
        await enviarTexto(numero, menuPrincipal(nome));
        return;
      }

      if (estado.etapa === 'aguardando_confirmacao') {
        if (['sim', 's', 'confirmar', 'ok'].includes(textoNormalizado)) {
          await confirmarCompra(numero, (msg) => enviarTexto(numero, msg));
          return;
        }
        await enviarTexto(numero, '❌ Confirmação inválida. Digite *sim* para confirmar ou *0* para cancelar.');
        return;
      }

      if (estado.etapa === 'aguardando_recarga') {
        await processarRecarga(numero, textoNormalizado, (msg) => enviarTexto(numero, msg));
        return;
      }

      if (OPCOES_MENU[textoNormalizado]) {
        await processarCompra(numero, OPCOES_MENU[textoNormalizado], (msg) => enviarTexto(numero, msg));
        return;
      }

      if (textoNormalizado === '7') {
        await enviarTexto(numero, msgSaldo(numero));
        return;
      }

      if (textoNormalizado === '8') {
        setEstado(numero, { etapa: 'aguardando_recarga' });
        await enviarTexto(numero, menuRecarga());
        return;
      }

      if (textoNormalizado === '9') {
        await enviarTexto(numero, msgHistorico(numero));
        return;
      }

      await enviarTexto(numero, menuPrincipal(nome));
    } catch (error) {
      LOGGER.error({ error, numero }, 'Erro processando mensagem');
      await enviarTexto(numero, '❌ Ocorreu um erro inesperado. Digite *0* para voltar ao menu.');
    }
  });

  return {
    sock,
    enviarParaNumero: async (numero, mensagem) => enviarTexto(numero, mensagem),
  };
}

module.exports = { iniciarBot };
