const db = require('./database/db');
const { menuPrincipal, menuRecarga, msgSaldo, msgHistorico, OPCOES_MENU } = require('./handlers/menu');
const { processarCompra, confirmarCompra, processarRecarga, getEstado, setEstado, limparEstado } = require('./handlers/pedidos');
const { isAdmin, processarAdmin } = require('./handlers/admin');

async function processarMensagem(numero, nome, texto, enviarMsg) {
  const msg = texto.trim().toLowerCase();
  db.criarUsuario(numero, nome);
  db.salvarMensagem(numero, nome, 'recebida', texto);

  const responder = async (r) => {
    db.salvarMensagem(numero, nome, 'enviada', r);
    return enviarMsg(r);
  };

  if (isAdmin(numero) && msg.startsWith('!')) return processarAdmin(numero, texto.trim(), responder);

  if (['0','menu','oi','olá','ola','inicio','início','hi','hello'].includes(msg)) {
    limparEstado(numero);
    return responder(menuPrincipal(nome));
  }

  const estado = getEstado(numero);

  if (estado.etapa === 'aguardando_confirmacao') {
    if (msg==='sim'||msg==='s') return confirmarCompra(numero, responder);
    limparEstado(numero);
    return responder(`❌ Pedido cancelado.\n\nDigite *0* para voltar ao menu`);
  }

  if (estado.etapa === 'aguardando_recarga') return processarRecarga(numero, msg, responder);

  if (OPCOES_MENU[msg]) return processarCompra(numero, OPCOES_MENU[msg], responder);
  if (msg==='7') return responder(msgSaldo(numero));
  if (msg==='8') { setEstado(numero, { etapa:'aguardando_recarga' }); return responder(menuRecarga()); }
  if (msg==='9') return responder(msgHistorico(numero));

  return responder(menuPrincipal(nome));
}

module.exports = { processarMensagem };
