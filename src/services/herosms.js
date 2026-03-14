const axios = require('axios');
require('dotenv').config();

const API_KEY = process.env.HEROSMS_API_KEY;
const BASE_URL = 'https://hero-sms.com/stubs/handler_api.php';

const SERVICOS = {
  whatsapp:  { nome: '📱 WhatsApp BR',        produto: 'wa', pais: 'br', preco: 7.00 },
  telegram:  { nome: '✈️ Telegram BR',         produto: 'tg', pais: 'br', preco: 7.00 },
  gmail:     { nome: '📧 Gmail/Google',        produto: 'go', pais: 'br', preco: 7.00 },
  instagram: { nome: '📸 Instagram',           produto: 'ig', pais: 'br', preco: 7.00 },
  facebook:  { nome: '👤 Facebook',            produto: 'fb', pais: 'br', preco: 7.00 },
  usa:       { nome: '🇺🇸 Número USA/Europa',  produto: 'wa', pais: 'us', preco: 10.00 },
};

async function pedirNumero(servico) {
  const s = SERVICOS[servico];
  if (!s) throw new Error('Serviço inválido');
  const res = await axios.get(BASE_URL, { params: { api_key: API_KEY, action: 'getNumber', service: s.produto, country: s.pais } });
  const partes = res.data.split(':');
  if (partes[0] !== 'ACCESS_NUMBER') throw new Error('Erro ao obter número: ' + res.data);
  return { activationId: partes[1], numero: partes[2] };
}

async function verificarSMS(activationId) {
  const res = await axios.get(BASE_URL, { params: { api_key: API_KEY, action: 'getStatus', id: activationId } });
  const data = res.data;
  if (data.startsWith('STATUS_OK:')) return { status: 'recebido', codigo: data.split(':')[1] };
  if (data === 'STATUS_WAIT_CODE') return { status: 'aguardando' };
  if (data === 'STATUS_CANCEL') return { status: 'cancelado' };
  return { status: 'aguardando' };
}

async function cancelarNumero(activationId) {
  await axios.get(BASE_URL, { params: { api_key: API_KEY, action: 'setStatus', id: activationId, status: 8 } });
}

async function confirmarNumero(activationId) {
  await axios.get(BASE_URL, { params: { api_key: API_KEY, action: 'setStatus', id: activationId, status: 6 } });
}

async function aguardarSMS(activationId, callback, timeoutMs = 20 * 60 * 1000) {
  const inicio = Date.now();
  return new Promise((resolve, reject) => {
    const verificar = async () => {
      if (Date.now() - inicio > timeoutMs) {
        await cancelarNumero(activationId);
        return reject(new Error('timeout'));
      }
      const resultado = await verificarSMS(activationId);
      if (resultado.status === 'recebido') {
        await confirmarNumero(activationId);
        callback(resultado.codigo);
        return resolve(resultado.codigo);
      }
      setTimeout(verificar, 5000);
    };
    verificar();
  });
}

module.exports = { SERVICOS, pedirNumero, aguardarSMS };
