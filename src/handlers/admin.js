const db = require('../database/db');
require('dotenv').config();

function isAdmin(numero) { return numero === process.env.ADMIN_NUMBER; }

let _enviarParaTodos = null;
function setEnviarParaTodos(fn) { _enviarParaTodos = fn; }

async function processarAdmin(numero, texto, enviarMsg) {
  const partes = texto.trim().split(' ');
  const cmd = partes[0].toLowerCase();

  switch (cmd) {
    case '!saldo': {
      const alvo = partes[1];
      if (!alvo) return enviarMsg(`❌ Use: !saldo NUMERO`);
      return enviarMsg(`💰 Saldo de *${alvo}*: R$${db.getSaldo(alvo).toFixed(2)}`);
    }
    case '!addsaldo': {
      const alvo = partes[1]; const valor = parseFloat(partes[2]);
      if (!alvo || isNaN(valor)) return enviarMsg(`❌ Use: !addsaldo NUMERO VALOR`);
      db.criarUsuario(alvo, 'Cliente');
      db.adicionarSaldo(alvo, valor);
      return enviarMsg(`✅ R$${valor.toFixed(2)} adicionado!\nNovo saldo: R$${db.getSaldo(alvo).toFixed(2)}`);
    }
    case '!removesaldo': {
      const alvo = partes[1]; const valor = parseFloat(partes[2]);
      if (!alvo || isNaN(valor)) return enviarMsg(`❌ Use: !removesaldo NUMERO VALOR`);
      if (db.getSaldo(alvo) < valor) return enviarMsg(`❌ Saldo insuficiente`);
      db.removerSaldo(alvo, valor);
      return enviarMsg(`✅ R$${valor.toFixed(2)} removido!\nNovo saldo: R$${db.getSaldo(alvo).toFixed(2)}`);
    }
    case '!zerasaldo': {
      const alvo = partes[1];
      if (!alvo) return enviarMsg(`❌ Use: !zerasaldo NUMERO`);
      db.removerSaldo(alvo, db.getSaldo(alvo));
      return enviarMsg(`✅ Saldo de *${alvo}* zerado!`);
    }
    case '!usuarios': {
      const lista = db.todosUsuarios();
      if (!lista.length) return enviarMsg(`📋 Nenhum usuário ainda`);
      let msg = `👥 *USUÁRIOS*\n\n`;
      lista.slice(0,20).forEach(u => { msg += `• *${u.nome}* (${u.numero})\n  💰 R$${u.saldo.toFixed(2)}\n\n`; });
      return enviarMsg(msg);
    }
    case '!pedidos': {
      const lista = db.todosPedidos();
      if (!lista.length) return enviarMsg(`📋 Nenhum pedido ainda`);
      let msg = `📦 *PEDIDOS*\n\n`;
      lista.slice(0,15).forEach(p => {
        const ic = p.status==='concluido'?'✅':p.status==='timeout'?'⏰':'⏳';
        msg += `${ic} ${p.servico} — R$${p.valor.toFixed(2)}\n👤 ${p.usuario_numero}\n`;
        if (p.codigo_sms) msg += `🔐 ${p.codigo_sms}\n`;
        msg += `\n`;
      });
      return enviarMsg(msg);
    }
    case '!broadcast': {
      const mensagem = partes.slice(1).join(' ');
      if (!mensagem) return enviarMsg(`❌ Use: !broadcast SUA MENSAGEM`);
      if (!_enviarParaTodos) return enviarMsg(`❌ Broadcast indisponível`);
      const numeros = db.todosNumerosClientes();
      if (!numeros.length) return enviarMsg(`❌ Nenhum cliente ainda`);
      await enviarMsg(`📡 Enviando para *${numeros.length}* clientes...`);
      const id = db.criarBroadcast(mensagem);
      let env=0, err=0;
      for (const n of numeros) {
        if (n===numero) continue;
        try { await _enviarParaTodos(n, mensagem); env++; await new Promise(r=>setTimeout(r,1200)); }
        catch(e) { err++; }
      }
      db.atualizarBroadcast(id, env, err, 'concluido');
      return enviarMsg(`✅ Broadcast concluído!\n📤 Enviados: ${env}\n❌ Erros: ${err}`);
    }
    case '!ajuda':
      return enviarMsg(`🔧 *COMANDOS ADMIN*\n\n!saldo NUMERO\n!addsaldo NUMERO VALOR\n!removesaldo NUMERO VALOR\n!zerasaldo NUMERO\n!usuarios\n!pedidos\n!broadcast MENSAGEM\n!ajuda`);
    default:
      return enviarMsg(`❌ Comando inválido. Digite *!ajuda*`);
  }
}

module.exports = { isAdmin, processarAdmin, setEnviarParaTodos };
