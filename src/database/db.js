const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, '../../loja.json'));
const db = low(adapter);

db.defaults({ usuarios: [], pedidos: [], recargas: [], mensagens: [], broadcasts: [] }).write();

function agora() { return new Date().toISOString(); }
function nextId(col) {
  const items = db.get(col).value();
  if (!items.length) return 1;
  return Math.max(...items.map(i => i.id)) + 1;
}

// USUARIOS
function getUsuario(n) { return db.get('usuarios').find({ numero: n }).value(); }
function criarUsuario(n, nome) {
  if (!getUsuario(n)) db.get('usuarios').push({ id: nextId('usuarios'), numero: n, nome: nome||'Cliente', saldo: 0, criado_em: agora() }).write();
}
function getSaldo(n) { const u = getUsuario(n); return u ? u.saldo : 0; }
function adicionarSaldo(n, v) {
  const u = getUsuario(n);
  if (u) db.get('usuarios').find({ numero: n }).assign({ saldo: Math.round((u.saldo + v) * 100) / 100 }).write();
}
function removerSaldo(n, v) {
  const u = getUsuario(n);
  if (u) db.get('usuarios').find({ numero: n }).assign({ saldo: Math.round((u.saldo - v) * 100) / 100 }).write();
}
function temSaldo(n, v) { return getSaldo(n) >= v; }
function todosUsuarios() { return db.get('usuarios').value().sort((a,b) => b.criado_em > a.criado_em ? 1 : -1); }

// PEDIDOS
function criarPedido(n, s, v) {
  const id = nextId('pedidos');
  db.get('pedidos').push({ id, usuario_numero: n, servico: s, valor: v, numero_virtual: null, codigo_sms: null, activation_id: null, status: 'pendente', criado_em: agora() }).write();
  return id;
}
function atualizarPedido(id, d) { db.get('pedidos').find({ id }).assign(d).write(); }
function getPedido(id) { return db.get('pedidos').find({ id }).value(); }
function getPedidosUsuario(n) {
  return db.get('pedidos').value()
    .filter(p => p.usuario_numero === n)
    .sort((a,b) => b.criado_em > a.criado_em ? 1 : -1)
    .slice(0, 10);
}
function todosPedidos() { return db.get('pedidos').value().sort((a,b) => b.criado_em > a.criado_em ? 1 : -1); }

// RECARGAS
function criarRecarga(n, v, pid) { db.get('recargas').push({ id: nextId('recargas'), usuario_numero: n, valor: v, pix_id: pid, status: 'pendente', criado_em: agora() }).write(); }
function getRecargaPorPix(pid) { return db.get('recargas').find({ pix_id: pid }).value(); }
function confirmarRecarga(pid) {
  const r = getRecargaPorPix(pid);
  if (r && r.status === 'pendente') {
    db.get('recargas').find({ pix_id: pid }).assign({ status: 'pago' }).write();
    adicionarSaldo(r.usuario_numero, r.valor);
    return r;
  }
  return null;
}

// MENSAGENS
function salvarMensagem(n, nome, dir, texto) {
  db.get('mensagens').push({ id: nextId('mensagens'), usuario_numero: n, usuario_nome: nome||'Cliente', direcao: dir, texto, criado_em: agora() }).write();
}
function todasMensagens(lim=200) {
  return db.get('mensagens').value()
    .sort((a,b) => b.criado_em > a.criado_em ? 1 : -1)
    .slice(0, lim);
}
function totalInteracoes() { return db.get('mensagens').value().length; }

// BROADCASTS
function criarBroadcast(msg) {
  const id = nextId('broadcasts');
  db.get('broadcasts').push({ id, mensagem: msg, total_enviados: 0, total_erros: 0, status: 'pendente', criado_em: agora() }).write();
  return id;
}
function atualizarBroadcast(id, env, err, status) { db.get('broadcasts').find({ id }).assign({ total_enviados: env, total_erros: err, status }).write(); }
function todosBroadcasts() { return db.get('broadcasts').value().sort((a,b) => b.criado_em > a.criado_em ? 1 : -1); }
function todosNumerosClientes() { return db.get('usuarios').value().map(u => u.numero); }

module.exports = {
  getUsuario, criarUsuario, getSaldo, adicionarSaldo, removerSaldo, temSaldo, todosUsuarios,
  criarPedido, atualizarPedido, getPedido, getPedidosUsuario, todosPedidos,
  criarRecarga, getRecargaPorPix, confirmarRecarga,
  salvarMensagem, todasMensagens, totalInteracoes,
  criarBroadcast, atualizarBroadcast, todosBroadcasts, todosNumerosClientes
};