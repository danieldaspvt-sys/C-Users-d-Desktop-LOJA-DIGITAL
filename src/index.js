require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const db = require('./database/db');
const { iniciarBot } = require('./bot');

const app = express();
const PORT = Number(process.env.PORT) || 3001;

app.use(cors());
app.use(express.json({ limit: '1mb' }));

let botInstance = null;

function statsResumo() {
  const usuarios = db.todosUsuarios();
  const pedidos = db.todosPedidos();
  const concluidos = pedidos.filter((p) => p.status === 'concluido');

  return {
    totalUsuarios: usuarios.length,
    totalPedidos: pedidos.length,
    totalConcluidos: concluidos.length,
    receitaTotal: concluidos.reduce((acc, p) => acc + (Number(p.valor) || 0), 0),
    totalInteracoes: db.totalInteracoes(),
  };
}

function parsePixPayload(payload) {
  const data = payload?.data || payload?.event || payload || {};
  return {
    referencia:
      data.external_reference ||
      data.externalReference ||
      payload?.external_reference ||
      payload?.externalReference ||
      null,
    status: String(data.status || payload?.status || data.event || payload?.event || '').toLowerCase(),
  };
}

app.get('/', (_req, res) => {
  res.json({ ok: true, service: 'digistore-bot', online: !!botInstance });
});

app.post('/webhook/pix', async (req, res) => {
  try {
    const { referencia, status } = parsePixPayload(req.body);
    const statusPago = ['paid', 'approved', 'completed', 'succeeded', 'pix_paid'];

    if (!referencia || !statusPago.some((s) => status.includes(s))) {
      return res.status(200).json({ ok: true, ignored: true });
    }

    const recarga = db.confirmarRecarga(referencia);
    if (!recarga) return res.status(200).json({ ok: true, alreadyProcessed: true });

    if (botInstance) {
      await botInstance.enviarParaNumero(
        recarga.usuario_numero,
        `✅ *Pagamento confirmado!*\n\nValor: *R$${recarga.valor.toFixed(2)}*\nSeu novo saldo já está disponível.`
      );
    }

    return res.status(200).json({ ok: true, credited: true });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/admin/stats', (_req, res) => res.json(statsResumo()));
app.get('/admin/usuarios', (_req, res) => res.json(db.todosUsuarios()));
app.get('/admin/pedidos', (_req, res) => res.json(db.todosPedidos()));
app.get('/admin/mensagens', (_req, res) => res.json(db.todasMensagens()));
app.get('/admin/broadcasts', (_req, res) => res.json(db.todosBroadcasts()));

app.post('/admin/saldo/add', (req, res) => {
  const { numero, valor } = req.body || {};
  const valorNum = Number(valor);

  if (!numero || !Number.isFinite(valorNum) || valorNum <= 0) {
    return res.status(400).json({ ok: false, error: 'numero e valor positivo são obrigatórios' });
  }

  db.criarUsuario(String(numero), 'Cliente');
  db.adicionarSaldo(String(numero), valorNum);
  return res.json({ ok: true, saldo: db.getSaldo(String(numero)) });
});

app.post('/admin/saldo/remove', (req, res) => {
  const { numero, valor } = req.body || {};
  const valorNum = Number(valor);

  if (!numero || !Number.isFinite(valorNum) || valorNum <= 0) {
    return res.status(400).json({ ok: false, error: 'numero e valor positivo são obrigatórios' });
  }

  const saldoAtual = db.getSaldo(String(numero));
  if (saldoAtual <= 0) return res.status(400).json({ ok: false, error: 'saldo insuficiente' });

  db.removerSaldo(String(numero), Math.min(saldoAtual, valorNum));
  return res.json({ ok: true, saldo: db.getSaldo(String(numero)) });
});

app.post('/admin/broadcast', async (req, res) => {
  try {
    const mensagem = String(req.body?.mensagem || '').trim();
    if (!mensagem) return res.status(400).json({ ok: false, error: 'mensagem obrigatória' });
    if (!botInstance) return res.status(503).json({ ok: false, error: 'bot offline' });

    const numeros = db.todosNumerosClientes();
    const id = db.criarBroadcast(mensagem);
    let enviados = 0;
    let erros = 0;

    for (const numero of numeros) {
      try {
        await botInstance.enviarParaNumero(numero, mensagem);
        enviados += 1;
      } catch (_error) {
        erros += 1;
      }
      await new Promise((resolve) => setTimeout(resolve, 600));
    }

    db.atualizarBroadcast(id, enviados, erros, 'concluido');
    return res.json({ ok: true, enviados, erros, total: numeros.length });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error.message });
  }
});

app.use('/painel', express.static(path.join(process.cwd(), 'painel')));

app.listen(PORT, async () => {
  console.log(`✅ API online em http://localhost:${PORT}`);
  console.log(`✅ Painel em http://localhost:${PORT}/painel`);

  try {
    botInstance = await iniciarBot();
  } catch (error) {
    console.error('⚠️ Bot não iniciou, API segue ativa:', error.message);
  }
});
