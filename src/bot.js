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
const RECONNECT_DELAY_MS = 5000;

function normalizarNumero(numero) {
  return String(numero || '').replace(/\D/g, '');
}

function numeroParaJid(numero) {
  const raw = String(numero || '').trim();
  if (!raw) throw new Error('Número inválido para envio');
  if (raw.includes('@')) return raw;

  const clean = normalizarNumero(raw);
  if (!clean) throw new Error('Número inválido para envio');
  return `${clean}@s.whatsapp.net`;
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

function nomeRemetente(mensagem) {
  return mensagem.pushName || mensagem.notifyName || mensagem.verifiedBizName || 'Cliente';
}

function deveIgnorarMensagem(mensagem) {
  const remoteJid = mensagem?.key?.remoteJid || '';
  if (!remoteJid) return true;
  if (mensagem.key?.fromMe) return true;
  return remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast';
}

async function iniciarBot() {
  const authFolder = path.join(process.cwd(), 'auth_session');
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  let socketAtual = null;
  let conectando = false;
  let reconnectTimer = null;
  let online = false;

  async function enviarTexto(numero, texto, salvar = true) {
    if (!socketAtual || !online) throw new Error('Bot offline');

    const jid = numeroParaJid(numero);
    await socketAtual.sendMessage(jid, { text: String(texto || '') });

    if (salvar) {
      const numeroDb = normalizarNumero(numero);
      if (numeroDb) db.salvarMensagem(numeroDb, 'Cliente', 'enviada', String(texto || ''));
    }
  }

  async function processarMensagem(mensagem) {
    if (!mensagem || deveIgnorarMensagem(mensagem)) return;

    const texto = textoDaMensagem(mensagem.message);
    if (!texto) return;

    const numero = normalizarNumero((mensagem.key.remoteJid || '').split('@')[0]);
    if (!numero) return;

    const nome = nomeRemetente(mensagem);
    const responder = async (msg) => enviarTexto(numero, msg);

    db.criarUsuario(numero, nome);
    db.salvarMensagem(numero, nome, 'recebida', texto);

    const textoNormalizado = texto.toLowerCase().trim();

    try {
      if (isAdmin(numero) && textoNormalizado.startsWith('!')) {
        await processarAdmin(numero, textoNormalizado, responder);
        return;
      }

      const estado = getEstado(numero);

      if (textoNormalizado === '0' || textoNormalizado === 'menu') {
        limparEstado(numero);
        await responder(menuPrincipal(nome));
        return;
      }

      if (estado.etapa === 'aguardando_confirmacao') {
        if (['sim', 's', 'confirmar', 'ok'].includes(textoNormalizado)) {
          await confirmarCompra(numero, responder);
          return;
        }

        await responder('❌ Confirmação inválida. Digite *sim* para confirmar ou *0* para cancelar.');
        return;
      }

      if (estado.etapa === 'aguardando_recarga') {
        await processarRecarga(numero, textoNormalizado, responder);
        return;
      }

      if (OPCOES_MENU[textoNormalizado]) {
        await processarCompra(numero, OPCOES_MENU[textoNormalizado], responder);
        return;
      }

      if (textoNormalizado === '7') {
        await responder(msgSaldo(numero));
        return;
      }

      if (textoNormalizado === '8') {
        setEstado(numero, { etapa: 'aguardando_recarga' });
        await responder(menuRecarga());
        return;
      }

      if (textoNormalizado === '9') {
        await responder(msgHistorico(numero));
        return;
      }

      await responder(menuPrincipal(nome));
    } catch (error) {
      LOGGER.error({ error, numero }, 'Erro processando mensagem');
      try {
        await responder('❌ Ocorreu um erro inesperado. Digite *0* para voltar ao menu.');
      } catch (sendError) {
        LOGGER.error({ sendError, numero }, 'Falha ao enviar mensagem de erro para usuário');
      }
    }
  }

  function agendarReconexao() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      conectarSocket().catch((error) => LOGGER.error({ error }, 'Erro ao reconectar bot'));
    }, RECONNECT_DELAY_MS);
  }

  async function conectarSocket() {
    if (conectando) return;
    conectando = true;

    try {
      const { version } = await fetchLatestBaileysVersion();

      const socket = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        defaultQueryTimeoutMs: 60_000,
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      socket.ev.on('creds.update', saveCreds);

      socket.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
        if (qr) {
          qrcode.generate(qr, { small: true });
          LOGGER.info('Escaneie o QR code para conectar o WhatsApp');
        }

        if (connection === 'open') {
          socketAtual = socket;
          online = true;
          LOGGER.info('✅ WhatsApp conectado');
          return;
        }

        if (connection === 'close') {
          online = false;
          const statusCode = lastDisconnect?.error?.output?.statusCode;
          const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

          LOGGER.warn({ statusCode }, 'Conexão do WhatsApp fechada');

          if (shouldReconnect) {
            LOGGER.info(`Tentando reconectar em ${RECONNECT_DELAY_MS / 1000}s...`);
            agendarReconexao();
          } else {
            LOGGER.error('Sessão desconectada. Apague auth_session e reconecte.');
          }
        }
      });

      socket.ev.on('messages.upsert', async ({ type, messages }) => {
        if (type !== 'notify' || !Array.isArray(messages)) return;

        for (const mensagem of messages) {
          await processarMensagem(mensagem);
        }
      });

      socketAtual = socket;
    } finally {
      conectando = false;
    }
  }

  setEnviarParaTodos(async (numero, mensagem) => {
    await enviarTexto(numero, mensagem);
  });

  await conectarSocket();

  return {
    enviarParaNumero: async (numero, mensagem) => enviarTexto(numero, mensagem),
    isOnline: () => online,
  };
}

module.exports = { iniciarBot };
