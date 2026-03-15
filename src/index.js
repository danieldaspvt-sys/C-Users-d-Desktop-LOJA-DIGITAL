require('dotenv').config();
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, delay } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const express = require('express');
const cors = require('cors');
const qrcode = require('qrcode-terminal');
const pino = require('pino');
const db = require('./database/db');
const { processarMensagem } = require('./bot');
const { setEnviarParaTodos } = require('./handlers/admin');

const app = express();
app.use(express.json());
app.use(cors());

let sock = null;

function normalizarNumero(numeroOuJid) {
  return String(numeroOuJid || '').replace(/\D/g, '');
}

function construirJid(numeroOuJid) {
  const valor = String(numeroOuJid || '');
  if (valor.includes('@')) return valor;
  const numero = normalizarNumero(valor);
  return numero ? `${numero}@s.whatsapp.net` : null;
}

function extrairDestinoMensagem(msg) {
  const key = msg?.key || {};
  const contextInfo = msg?.message?.extendedTextMessage?.contextInfo || {};

  const formatar = (valor) => {
    const jid = construirJid(valor);
    if (!jid) return null;
    const numero = normalizarNumero(jid.split('@')[0]);
    if (!numero) return null;
    return { jid, numero };
  };

  const remoteJid = String(key.remoteJid || '');
  if (remoteJid.endsWith('@s.whatsapp.net')) {
    const principal = formatar(remoteJid);
    if (principal) return principal;
  }

  const candidatosFallback = [
    key.remoteJidPn,
    key.participantPn,
    contextInfo.participantPn,
    contextInfo.participant,
    key.participant,
    key.remoteJid,
    key.remoteJidAlt,
    key.participantAlt
  ].filter(Boolean);

  for (const candidato of candidatosFallback) {
    const destino = formatar(candidato);
    if (destino && destino.numero.length >= 10 && destino.numero.length <= 13) {
      return destino;
    }
  }

  return null;
}

async function enviarMensagem(numeroOuJid, texto) {
  if (!sock) { console.log('❌ sock null'); return; }
  try {
    const jid = construirJid(numeroOuJid);
    if (!jid) throw new Error('destinatário inválido');
    await sock.presenceSubscribe(jid);
    await delay(500);
    await sock.sendPresenceUpdate('composing', jid);
    await delay(1000);
    await sock.sendPresenceUpdate('paused', jid);
    await sock.sendMessage(jid, { text: texto });
    console.log(`✅ Enviado para ${jid}`);
  } catch (err) {
    console.error(`❌ Erro ao enviar para ${numeroOuJid}:`, err.message);
  }
}

// WEBHOOK PIX
app.post('/webhook/pix', async (req, res) => {
  try {
    const { external_reference, status } = req.body;
    if (!external_reference || !status) {
      return res.status(400).json({ error: 'external_reference e status são obrigatórios' });
    }

    const statusPago = String(status).toLowerCase();
    if (statusPago === 'paid' || statusPago === 'approved') {
      const recarga = db.confirmarRecarga(external_reference);
      if (recarga) {
        const saldo = db.getSaldo(recarga.usuario_numero);
        await enviarMensagem(recarga.usuario_numero,
          `✅ *PAGAMENTO CONFIRMADO!*

💰 Valor: *R$${recarga.valor.toFixed(2)}*
💳 Saldo: *R$${saldo.toFixed(2)}*

Digite *0* para o menu 🛒`
        );
      }
    }
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// API ADMIN
app.get('/admin/stats', (req, res) => {
  const usuarios = db.todosUsuarios();
  const pedidos = db.todosPedidos();
  const concluidos = pedidos.filter(p => p.status==='concluido');
  res.json({
    totalUsuarios: usuarios.length,
    totalPedidos: pedidos.length,
    totalConcluidos: concluidos.length,
    receitaTotal: concluidos.reduce((s,p)=>s+p.valor,0),
    totalInteracoes: db.totalInteracoes(),
  });
});
app.get('/admin/usuarios', (req, res) => res.json(db.todosUsuarios()));
app.get('/admin/pedidos', (req, res) => res.json(db.todosPedidos()));
app.get('/admin/mensagens', (req, res) => res.json(db.todasMensagens()));
app.get('/admin/broadcasts', (req, res) => res.json(db.todosBroadcasts()));
app.post('/admin/saldo/add', (req, res) => {
  const { numero, valor } = req.body;
  const valorNumerico = Number(valor);
  if (!numero || !Number.isFinite(valorNumerico) || valorNumerico <= 0) {
    return res.status(400).json({ error: 'numero e valor positivo são obrigatórios' });
  }
  db.criarUsuario(numero, 'Cliente');
  db.adicionarSaldo(numero, valorNumerico);
  res.json({ saldo: db.getSaldo(numero) });
});
app.post('/admin/saldo/remove', (req, res) => {
  const { numero, valor } = req.body;
  const valorNumerico = Number(valor);
  if (!numero || !Number.isFinite(valorNumerico) || valorNumerico <= 0) {
    return res.status(400).json({ error: 'numero e valor positivo são obrigatórios' });
  }
  if (db.getSaldo(numero) < valorNumerico) {
    return res.status(400).json({ error: 'saldo insuficiente' });
  }
  db.removerSaldo(numero, valorNumerico);
  res.json({ saldo: db.getSaldo(numero) });
});
app.post('/admin/broadcast', async (req, res) => {
  const { mensagem } = req.body;
  if (!mensagem) return res.status(400).json({ error: 'Mensagem obrigatória' });
  const numeros = db.todosNumerosClientes();
  const id = db.criarBroadcast(mensagem);
  res.json({ ok: true, total: numeros.length });
  let env=0, err=0;
  for (const n of numeros) {
    try { await enviarMensagem(n, mensagem); env++; await new Promise(r=>setTimeout(r,1200)); }
    catch(e) { err++; }
  }
  db.atualizarBroadcast(id, env, err, 'concluido');
});

// WHATSAPP
async function conectarWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_session');

  sock = makeWASocket({
    auth: state,
    logger: pino({ level: 'silent' }),
    printQRInTerminal: false,
    generateHighQualityLinkPreview: false,
    getMessage: async () => { return { conversation: '' }; }
  });

  setEnviarParaTodos(enviarMensagem);
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      console.clear();
      console.log('\n================================================');
      console.log('📱  ESCANEIE O QR CODE ABAIXO NO WHATSAPP');
      console.log('================================================\n');
      qrcode.generate(qr, { small: true });
      console.log('\n================================================');
      console.log('No WhatsApp: ⋮ → Dispositivos conectados → Conectar');
      console.log('================================================\n');
    }
    if (connection === 'close') {
      const reconectar = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut : true;
      if (reconectar) { console.log('🔄 Reconectando...'); conectarWhatsApp(); }
      else { console.log('🔴 Sessão encerrada.'); }
    } else if (connection === 'open') {
      console.log('\n✅ WhatsApp conectado!');
      console.log('🛒 DigiStore online!\n');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;
    for (const msg of messages) {
      const remoteJid = msg?.key?.remoteJid || '';
      if (msg?.key?.fromMe || !msg?.message || remoteJid.includes('@g.us')) continue;

      const destino = extrairDestinoMensagem(msg);
      if (!destino || !destino.jid) {
        console.log('⚠️ Mensagem ignorada: não foi possível identificar destinatário');
        continue;
      }

      const nome = msg.pushName || 'Cliente';
      const texto =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';
      if (!texto) continue;

      console.log(`📩 [${destino.numero}] ${nome}: ${texto}`);
      try {
        await processarMensagem(destino.numero, nome, texto, (r) => enviarMensagem(destino.jid, r));
      } catch (err) {
        console.error(`❌ Erro [${destino.numero}]:`, err.message);
        console.error(err.stack);
      }
    }
  });
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🚀 DigiStore Bot porta ${PORT}`);
  console.log(`📡 Webhook: ${process.env.WEBHOOK_URL}/webhook/pix\n`);
});
conectarWhatsApp();