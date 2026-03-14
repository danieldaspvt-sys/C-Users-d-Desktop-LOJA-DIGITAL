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

async function enviarMensagem(numero, texto) {
  if (!sock) { console.log('❌ sock null'); return; }
  try {
    const jid = `${numero}@s.whatsapp.net`;
    await sock.presenceSubscribe(jid);
    await delay(500);
    await sock.sendPresenceUpdate('composing', jid);
    await delay(1000);
    await sock.sendPresenceUpdate('paused', jid);
    await sock.sendMessage(jid, { text: texto });
    console.log(`✅ Enviado para ${numero}`);
  } catch (err) {
    console.error(`❌ Erro ao enviar para ${numero}:`, err.message);
  }
}

// WEBHOOK PIX
app.post('/webhook/pix', async (req, res) => {
  try {
    const { external_reference, status } = req.body;
    if (status === 'paid' || status === 'approved') {
      const recarga = db.confirmarRecarga(external_reference);
      if (recarga) {
        const saldo = db.getSaldo(recarga.usuario_numero);
        await enviarMensagem(recarga.usuario_numero,
          `✅ *PAGAMENTO CONFIRMADO!*\n\n💰 Valor: *R$${recarga.valor.toFixed(2)}*\n💳 Saldo: *R$${saldo.toFixed(2)}*\n\nDigite *0* para o menu 🛒`
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
  db.criarUsuario(numero, 'Cliente');
  db.adicionarSaldo(numero, valor);
  res.json({ saldo: db.getSaldo(numero) });
});
app.post('/admin/saldo/remove', (req, res) => {
  const { numero, valor } = req.body;
  db.removerSaldo(numero, valor);
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
      if (msg.key.fromMe || !msg.message || msg.key.remoteJid.includes('@g.us')) continue;
      const numero = msg.key.remoteJid.replace('@s.whatsapp.net', '');
      const nome = msg.pushName || 'Cliente';
      const texto =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        '';
      if (!texto) continue;
      console.log(`📩 [${numero}] ${nome}: ${texto}`);
      try {
        await processarMensagem(numero, nome, texto, (r) => enviarMensagem(numero, r));
      } catch (err) {
        console.error(`❌ Erro [${numero}]:`, err.message);
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