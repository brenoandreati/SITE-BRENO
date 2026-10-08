// ============ Configuração: edite aqui ============
const CONFIG = {
  // DDI + DDD + número, só dígitos. Ex.: 5511912345678
  whatsapp: '5500000000000',
  instagram: 'brenoandreati',
  // Quantas páginas grátis você abre por mês. Use 0 para esconder o número.
  vagasPorMes: 5,
  mensagemPadrao: 'Oi, Breno! Vim pela sua página e quero minha landing page grátis.',
};

const linkWhats = (texto) =>
  `https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(texto)}`;

// Links de contato
document.querySelectorAll('[data-wa]').forEach((a) => {
  a.href = linkWhats(CONFIG.mensagemPadrao);
  a.target = '_blank';
  a.rel = 'noopener';
});
document.querySelectorAll('[data-insta]').forEach((a) => {
  a.href = `https://instagram.com/${CONFIG.instagram}`;
  a.target = '_blank';
  a.rel = 'noopener';
});

// Vagas do mês corrente
if (CONFIG.vagasPorMes > 0) {
  const mes = new Date().toLocaleString('pt-BR', { month: 'long' });
  document.querySelectorAll('[data-vagas]').forEach((el) => {
    el.textContent = `${CONFIG.vagasPorMes} vagas em ${mes}`;
  });
}

document.querySelectorAll('[data-ano]').forEach((el) => {
  el.textContent = new Date().getFullYear();
});

// Formulário → WhatsApp
const form = document.getElementById('form-pedido');

const validadores = {
  nome: (v) => v.trim().length >= 2,
  whatsapp: (v) => v.replace(/\D/g, '').length >= 10,
  negocio: (v) => v.trim().length >= 2,
};

function campoDe(nome) {
  return form.querySelector(`[data-erro="${nome}"]`).closest('.campo');
}

function validar(nome) {
  const valor = new FormData(form).get(nome) || '';
  const ok = validadores[nome](valor);
  campoDe(nome).classList.toggle('tem-erro', !ok);
  return ok;
}

// Depois de um envio com erro, o aviso some assim que o campo fica válido.
// Revalidar só enquanto a pessoa digita evita que a página pule no meio de um toque.
Object.keys(validadores).forEach((nome) => {
  form.querySelectorAll(`[name="${nome}"]`).forEach((input) => {
    ['input', 'change'].forEach((evento) => {
      input.addEventListener(evento, () => {
        if (campoDe(nome).classList.contains('tem-erro')) validar(nome);
      });
    });
  });
});

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const erros = Object.keys(validadores).filter((nome) => !validar(nome));
  if (erros.length) {
    const primeiro = form.querySelector(`[name="${erros[0]}"]`);
    primeiro.focus();
    return;
  }

  const d = new FormData(form);
  const insta = (d.get('instagram') || '').trim();
  const linhas = [
    'Oi, Breno! Quero minha landing page grátis.',
    '',
    `Nome: ${d.get('nome').trim()}`,
    `WhatsApp: ${d.get('whatsapp').trim()}`,
    `Negócio: ${d.get('negocio').trim()}`,
    insta ? `Instagram: ${insta}` : null,
  ].filter((l) => l !== null);

  const url = linkWhats(linhas.join('\n'));
  const janela = window.open(url, '_blank');
  if (janela) janela.opener = null;
  else window.location.href = url;
});
