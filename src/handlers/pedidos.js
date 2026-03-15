const db = require('../database/db');
const { pedirNumero, aguardarSMS, SERVICOS } = require('../services/herosms');
const { criarPix } = require('../services/pushinpay');
const { msgSaldoInsuficiente, msgConfirmarServico, msgNumeroGerado, msgCodigoRecebido, msgTimeout, msgPix, OPCOES_RECARGA } = require('./menu');

const estados = {};
function setEstado(n, e) { estados[n] = e; }
function getEstado(n) { return estados[n] || { etapa: 'menu' }; }
function limparEstado(n) { delete estados[n]; }

async function processarCompra(numero, servico, enviarMsg) {
  const s = SERVICOS[servico];
  if (!db.temSaldo(numero, s.preco)) {
    limparEstado(numero);
    return enviarMsg(msgSaldoInsuficiente(db.getSaldo(numero), s.preco));
  }
  setEstado(numero, { etapa: 'aguardando_confirmacao', servico });
  return enviarMsg(msgConfirmarServico(servico));
}

async function confirmarCompra(numero, enviarMsg) {
  const { servico } = getEstado(numero);
  const s = SERVICOS[servico];
  db.removerSaldo(numero, s.preco);
  const pedidoId = db.criarPedido(numero, s.nome, s.preco);
  try {
    const { activationId, numero: numVirtual } = await pedirNumero(servico);
    db.atualizarPedido(pedidoId, { numero_virtual: numVirtual, activation_id: activationId, status: 'aguardando_sms', codigo_sms: null });
    await enviarMsg(msgNumeroGerado(numVirtual, s.nome));
    limparEstado(numero);
    aguardarSMS(activationId, async (codigo) => {
      db.atualizarPedido(pedidoId, { numero_virtual: numVirtual, activation_id: activationId, status: 'concluido', codigo_sms: codigo });
      await enviarMsg(msgCodigoRecebido(codigo));
    }).catch(async (err) => {
      db.adicionarSaldo(numero, s.preco);
      if (err.message === 'timeout') {
        db.atualizarPedido(pedidoId, { numero_virtual: numVirtual, activation_id: activationId, status: 'timeout', codigo_sms: null });
        await enviarMsg(msgTimeout());
        return;
      }
      db.atualizarPedido(pedidoId, { numero_virtual: numVirtual, activation_id: activationId, status: 'falha', codigo_sms: null });
      await enviarMsg(`❌ Não foi possível concluir a ativação (${err.message}).
Seu crédito foi reembolsado ✅

Digite *0* para voltar ao menu.`);
    });
  } catch (err) {
    db.adicionarSaldo(numero, s.preco);
    limparEstado(numero);
    await enviarMsg(`❌ Erro ao gerar número. Saldo reembolsado.\n\nDigite *0* para tentar novamente.`);
  }
}

async function processarRecarga(numero, opcao, enviarMsg) {
  const valor = OPCOES_RECARGA[opcao];
  if (!valor) return enviarMsg(`❌ Opção inválida. Digite *0* para voltar.`);
  try {
    const pixId = `recarga_${numero}_${Date.now()}`;
    const pix = await criarPix(valor, `Recarga DigiStore`, pixId);
    db.criarRecarga(numero, valor, pixId);
    limparEstado(numero);
    await enviarMsg(msgPix(pix.pixCopiaECola, valor));
  } catch (err) {
    limparEstado(numero);
    await enviarMsg(`❌ Erro ao gerar PIX. Tente novamente.`);
  }
}

module.exports = { processarCompra, confirmarCompra, processarRecarga, getEstado, setEstado, limparEstado };
