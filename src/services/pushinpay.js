const axios = require('axios');
require('dotenv').config();

async function criarPix(valor, descricao, pixId) {
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
  return { pixCopiaECola: res.data.qr_code, valor };
}

module.exports = { criarPix };
