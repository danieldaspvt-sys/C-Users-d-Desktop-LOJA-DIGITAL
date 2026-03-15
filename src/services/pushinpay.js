const axios = require('axios');
require('dotenv').config();

async function criarPix(valor, descricao, pixId) {
  if (!process.env.PUSHINPAY_TOKEN) throw new Error('PUSHINPAY_TOKEN não configurado');
  if (!process.env.WEBHOOK_URL) throw new Error('WEBHOOK_URL não configurado');

  const res = await axios.post(
    'https://api.pushinpay.com.br/api/pix/cashIn',
    {
      value: Math.round(valor * 100),
      webhook_url: `${process.env.WEBHOOK_URL}/webhook/pix`,
      external_reference: pixId,
      description: descricao,
    },
    { headers: { Authorization: `Bearer ${process.env.PUSHINPAY_TOKEN}`, 'Content-Type': 'application/json' } }
  );
  const pixCopiaECola = res?.data?.qr_code;
  if (!pixCopiaECola) throw new Error('Resposta inválida ao gerar PIX');
  return { pixCopiaECola, valor };
}

module.exports = { criarPix };
