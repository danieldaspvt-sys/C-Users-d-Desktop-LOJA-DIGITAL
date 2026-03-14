const { getSaldo, getPedidosUsuario } = require('../database/db');
const { SERVICOS } = require('../services/herosms');

function menuPrincipal(nome) {
  return `👋 Olá, *${nome}*! Bem-vindo à *DigiStore* 🛒

Escolha uma opção:

📱 *NÚMEROS VIRTUAIS*
1️⃣ Número WhatsApp BR — R$7,00
2️⃣ Número Telegram BR — R$7,00
3️⃣ Número Gmail/Google — R$7,00
4️⃣ Número Instagram — R$7,00
5️⃣ Número Facebook — R$7,00
6️⃣ Número USA/Europa — R$10,00

💳 *MINHA CONTA*
7️⃣ Ver meu saldo
8️⃣ Recarregar créditos
9️⃣ Histórico de pedidos

Digite o número da opção 👇`;
}

function menuRecarga() {
  return `💳 *RECARREGAR CRÉDITOS*

1️⃣ R$10,00
2️⃣ R$20,00
3️⃣ R$50,00
4️⃣ R$100,00

Digite *0* para voltar`;
}

function msgSaldo(numero) {
  const saldo = getSaldo(numero);
  return `💰 *SEU SALDO*\n\nSaldo disponível: *R$${saldo.toFixed(2)}*\n\nDigite *8* para recarregar ou *0* para voltar`;
}

function msgHistorico(numero) {
  const pedidos = getPedidosUsuario(numero);
  if (!pedidos.length) return `📋 *HISTÓRICO*\n\nVocê ainda não fez pedidos.\n\nDigite *0* para voltar`;
  let msg = `📋 *HISTÓRICO DE PEDIDOS*\n\n`;
  pedidos.forEach(p => {
    const icon = p.status==='concluido'?'✅':p.status==='pendente'?'⏳':'❌';
    msg += `${icon} *${p.servico}* — R$${p.valor.toFixed(2)}\n`;
    if (p.numero_virtual) msg += `   📱 ${p.numero_virtual}\n`;
    if (p.codigo_sms) msg += `   🔐 ${p.codigo_sms}\n`;
    msg += `   📅 ${new Date(p.criado_em).toLocaleDateString('pt-BR')}\n\n`;
  });
  return msg + `Digite *0* para voltar`;
}

function msgSaldoInsuficiente(saldo, valor) {
  return `❌ *SALDO INSUFICIENTE*\n\nSeu saldo: *R$${saldo.toFixed(2)}*\nValor necessário: *R$${valor.toFixed(2)}*\n\nDigite *8* para recarregar ou *0* para voltar`;
}

function msgConfirmarServico(servico) {
  const s = SERVICOS[servico];
  return `🛒 *CONFIRMAR PEDIDO*\n\nServiço: *${s.nome}*\nValor: *R$${s.preco.toFixed(2)}*\n\n✅ Digite *sim* para confirmar\n❌ Digite *0* para cancelar`;
}

function msgNumeroGerado(numero, servico) {
  return `✅ *PEDIDO CONFIRMADO!*\n\nServiço: *${servico}*\n📱 Seu número: *+${numero}*\n\n⏳ Aguardando o código SMS...\n_(Expira em 20 minutos)_\n\nAbra o app e insira esse número para receber o código`;
}

function msgCodigoRecebido(codigo) {
  return `🎉 *CÓDIGO RECEBIDO!*\n\n🔐 Código: *${codigo}*\n\n⚡ Use rápido, expira em breve!\n\nDigite *0* para voltar ao menu`;
}

function msgTimeout() {
  return `⏰ *TEMPO ESGOTADO*\n\nNão recebemos o SMS.\nSeu crédito foi *reembolsado automaticamente* ✅\n\nDigite *0* para tentar novamente`;
}

function msgPix(pix, valor) {
  return `💳 *PIX GERADO!*\n\nValor: *R$${valor.toFixed(2)}*\n\n📋 *Pix Copia e Cola:*\n\`${pix}\`\n\n⏳ Aguardando pagamento...\n_Saldo adicionado automaticamente após confirmação_`;
}

const OPCOES_MENU = { '1':'whatsapp','2':'telegram','3':'gmail','4':'instagram','5':'facebook','6':'usa' };
const OPCOES_RECARGA = { '1':10,'2':20,'3':50,'4':100 };

module.exports = {
  menuPrincipal, menuRecarga, msgSaldo, msgHistorico,
  msgSaldoInsuficiente, msgConfirmarServico, msgNumeroGerado,
  msgCodigoRecebido, msgTimeout, msgPix,
  OPCOES_MENU, OPCOES_RECARGA
};
