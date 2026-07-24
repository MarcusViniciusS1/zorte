// Content script — roda dentro do app.crisp.chat.
//
// 1) Responde ao popup (action "extractTenant") e ao Side Panel
//    (action "validateCurrent") lendo o perfil da conversa aberta.
// 2) Injeta um botão flutuante que abre o PAINEL LATERAL (Side Panel) do
//    navegador para registrar o atendimento — o Chrome encolhe a aba do Crisp,
//    então o painel não tampa nenhuma informação.

// Lê o widget de perfil da conversa aberta: candidatos (cnpj/empresa/tenant/tags),
// telefone, nome do contato e a URL atual.

// Auto-cura ao recarregar a extensão: se já existe uma instância anterior neste
// contexto, desliga ela (limpa intervalo e remove o botão/drawer antigos) para
// que a nova assuma o controle com handlers válidos — evita o "Extension context
// invalidated" que deixava o botão morto até um F5.
if (window.__ztTenantShutdown) {
  try { window.__ztTenantShutdown(); } catch (e) { /* instância antiga já morta */ }
}
// Remove também botão/drawer de qualquer instância órfã anterior que não tenha
// o shutdown (ex.: versão antiga reinjetada por cima), para o novo script poder
// recriar o botão com um handler válido.
(function () {
  const b = document.getElementById('zt-launcher'); if (b) b.remove();
  const w = document.getElementById('zt-drawer-wrap'); if (w) w.remove();
})();
let __ztInterval = null;
window.__ztTenantShutdown = function () {
  try { clearInterval(__ztInterval); } catch (e) {}
  const oldBtn = document.getElementById('zt-launcher');
  if (oldBtn) oldBtn.remove();
  const oldDrawer = document.getElementById('zt-drawer-wrap');
  if (oldDrawer) oldDrawer.remove();
  // cnpjScannerInstance é declarado mais abaixo neste mesmo script; esta
  // função só é CHAMADA por uma futura reinjeção (depois que o script todo já
  // rodou), então a referência já está inicializada nesse momento.
  try { if (typeof cnpjScannerInstance !== 'undefined' && cnpjScannerInstance) cnpjScannerInstance.stop(); } catch (e) {}
};

// Detecta o canal/origem da conversa aberta (chat, whatsapp, email, telefone)
// a partir do ícone/tooltip de origem do Crisp. Usa o nome do ícone (independe
// do idioma) e cai para o texto do tooltip como reforço.
function detectChannel() {
  try {
    const activeItem = document.querySelector(
      '[class*="conversation-menu-item"][class*="--active"], [class*="conversation-menu-item"][class*="--selected"], [class*="conversation-menu-item"][aria-selected="true"]'
    );
    const scope = activeItem || document;
    const useEl = scope.querySelector('.c-conversation-menu-item-headline__origin use');
    const href = useEl ? (useEl.getAttribute('xlink:href') || useEl.getAttribute('href') || '') : '';
    const tip = scope.querySelector('.c-conversation-menu-item-headline__origin .c-base-tooltip__default');
    const tipText = tip ? tip.textContent : '';
    const hay = (href + ' ' + tipText).toLowerCase();
    if (/whats/.test(hay)) return 'whatsapp';
    if (/message_bubble|chat/.test(hay)) return 'chat';
    if (/mail|email|envelope/.test(hay)) return 'email';
    if (/phone|telep|call|sms/.test(hay)) return 'telefone';
  } catch { /* ignora */ }
  return '';
}

// Lê o telefone do VISITANTE no widget de perfil nativo do Crisp — cada item
// dessa lista (país, idioma, telefone, canal...) tem um ícone com tooltip e o
// valor num link "tel:". Detecta pelo ícone (#icon-phone, estável e
// independe do idioma da interface) com o texto do tooltip como reforço.
// Isso é DIFERENTE da seção "Dados do perfil" (campos customizados como
// CNPJ/Empresa/Tenant) lida mais abaixo — são dois blocos distintos do Crisp,
// e usar o campo errado aqui é o que fazia salvar o número da empresa (fixo,
// igual em várias conversas) em vez do número de cada visitante.
function extractVisitorPhone() {
  try {
    const items = document.querySelectorAll('.c-conversation-profile-widget-item');
    for (const item of items) {
      const iconUse = item.querySelector('svg use');
      const iconHref = iconUse ? (iconUse.getAttribute('xlink:href') || iconUse.getAttribute('href') || '') : '';
      const tooltip = item.querySelector('.c-base-tooltip__default');
      const tooltipText = tooltip ? tooltip.textContent.toLowerCase() : '';
      const isPhoneItem = /icon-phone/.test(iconHref) || tooltipText.includes('telefone') || tooltipText.includes('phone');
      if (!isPhoneItem) continue;

      const link = item.querySelector('a[href^="tel:"]');
      if (link) {
        const raw = (link.getAttribute('href') || '').replace(/^tel:/i, '').trim();
        return raw || link.textContent.trim();
      }
    }
  } catch (e) { /* ignora falhas de leitura do DOM */ }
  return '';
}

function extractProfile() {
  let candidates = [];
  let phone = extractVisitorPhone();
  let personName = "";
  const currentUrl = window.location.href;

  try {
    const keys = document.querySelectorAll('.c-conversation-profile-widget-data-item__cell--key');
    for (let key of keys) {
      const keyText = key.textContent.toLowerCase().trim();
      const parent = key.closest('.c-conversation-profile-widget-data-item__cell');
      const valueNode = parent ? parent.nextElementSibling : null;

      if (valueNode && valueNode.textContent) {
        let rawText = valueNode.textContent
          .replace(/Dados do perfil/gi, '')
          .replace(/Copiar/gi, '')
          .replace(/Excluir/gi, '')
          .trim();

        if (keyText.includes('cnpj') || keyText.includes('empresa') || keyText.includes('tenant')) {
          if (rawText) candidates.push(rawText);
        }
        // Fallback: só usa esse campo customizado se o widget nativo (acima)
        // não tiver o telefone do visitante.
        if (!phone && (keyText.includes('telefone') || keyText.includes('phone') || keyText.includes('whatsapp') || keyText.includes('celular') || keyText.includes('number'))) {
          if (rawText) phone = rawText;
        }
      }
    }

    const nameNode = document.querySelector('.c-conversation-profile__name');
    if (nameNode) {
      personName = nameNode.textContent.trim();
    }

    const tagNodes = document.querySelectorAll('.c-base-tag__label');
    tagNodes.forEach(tag => {
      if (tag.textContent) candidates.push(tag.textContent.trim());
    });

    const nicknameNode = document.querySelector('.c-conversation-profile__nickname');
    if (nicknameNode) {
      const text = nicknameNode.textContent.trim();
      const parts = text.split('-').map(part => part.trim());

      if (parts.length >= 3) {
        candidates.push(parts[1]);
      } else if (parts.length === 2) {
        candidates.push(parts[1]);
      }
      candidates.push(text);

      if (!personName && parts.length > 0) {
        personName = parts[0];
      }
    }

    // Empresa vinculada exibida no perfil (ex.: "DFA - TRANSPORTES COMERCIO...").
    const employmentNode = document.querySelector('.c-conversation-profile__employment');
    if (employmentNode && employmentNode.textContent) {
      const emp = employmentNode.textContent.trim();
      if (emp) candidates.push(emp);
    }

    candidates = [...new Set(candidates.filter(c => c))];
  } catch (error) {
    /* ignora falhas de leitura do DOM */
  }

  return { candidates, url: currentUrl, phone, name: personName, channel: detectChannel() };
}

// Extrai o perfil e valida a empresa no banco (mesma lógica do popup).
// Retorna { found, data, extra:{name,phone,url} }.
async function validateCurrent() {
  const profile = extractProfile();
  let data = null;
  if (profile.candidates && profile.candidates.length) {
    data = await new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ action: 'searchDatabase', query: profile.candidates }, (r) => {
          if (chrome.runtime.lastError) return resolve(null);
          resolve(r && r.success ? r.data : null);
        });
      } catch { resolve(null); }
    });
  }
  return {
    found: !!data,
    data,
    extra: { name: profile.name, phone: profile.phone, url: profile.url || location.href, channel: profile.channel || '' },
  };
}

// Responde ao popup (extractTenant) e ao Side Panel (validateCurrent).
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "extractTenant") {
    try {
      const p = extractProfile();
      sendResponse({
        success: true,
        data: p.candidates,
        extraData: { url: p.url, phone: p.phone, name: p.name },
      });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  if (request.action === "validateCurrent") {
    validateCurrent().then(sendResponse);
    return true; // resposta assíncrona
  }

  // Não é uma mensagem deste script (ex.: CRISP_GET_STATUS é do crisp-ui.js):
  // não segura o canal de resposta.
  return false;
});

// ---- Botão flutuante que abre o Side Panel ----
function mountLauncher() {
  if (document.getElementById('zt-launcher')) return;
  const btn = document.createElement('button');
  btn.id = 'zt-launcher';
  btn.type = 'button';
  btn.textContent = '+ Registrar atendimento';
  btn.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483645;border:0;cursor:pointer;' +
    'padding:10px 16px;border-radius:999px;color:#fff;font:600 13px/1 -apple-system,Segoe UI,Roboto,sans-serif;' +
    'background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 6px 24px rgba(239,68,68,.4);';
  // O clique é um gesto do usuário: tenta o painel lateral nativo do Chrome.
  // Se o Chrome recusar (gesto perdido/serviço dormindo), abre o drawer na
  // própria página como fallback — assim o botão SEMPRE abre algo.
  btn.addEventListener('click', () => {
    try {
      chrome.runtime.sendMessage({ action: 'openSidePanel' }, (resp) => {
        if (chrome.runtime.lastError) {
          console.warn('[Zorte Crisp] Extensão recarregada — dê F5 na aba do Crisp.', chrome.runtime.lastError.message);
          return;
        }
        if (resp && resp.ok === false) {
          console.warn('[Zorte Crisp] Painel nativo recusado, abrindo na página. Motivo:', resp.error);
          openInPageDrawer();
        }
      });
    } catch (e) {
      console.warn('[Zorte Crisp] Extensão recarregada — dê F5 na aba do Crisp.', e && e.message);
    }
  });
  document.body.appendChild(btn);
}

// ---- Fallback: drawer dentro da própria página (iframe da extensão) ----
// Usado quando o painel lateral nativo do Chrome é recusado. Fica ancorado à
// direita e empurra o conteúdo do Crisp (best-effort) para não tampar.
let ztDrawerWrap = null;
function openInPageDrawer() {
  if (ztDrawerWrap) return;
  let url;
  try { url = chrome.runtime.getURL('drawer.html'); }
  catch (e) { console.warn('[Zorte Crisp] Recarregue a aba do Crisp (F5).'); return; }

  ztDrawerWrap = document.createElement('div');
  ztDrawerWrap.id = 'zt-drawer-wrap';
  ztDrawerWrap.style.cssText =
    'position:fixed;top:0;right:0;height:100vh;width:420px;max-width:100vw;z-index:2147483646;' +
    'box-shadow:-8px 0 32px rgba(0,0,0,.45);background:#18181b;';

  const iframe = document.createElement('iframe');
  iframe.src = url;
  iframe.style.cssText = 'border:0;width:100%;height:100%;display:block;background:#18181b;';
  ztDrawerWrap.appendChild(iframe);
  document.body.appendChild(ztDrawerWrap);

  // Empurra o conteúdo para não tampar (alguns layouts fixos podem ignorar).
  try { document.documentElement.style.setProperty('margin-right', '420px', 'important'); } catch (e) {}
}
function closeInPageDrawer() {
  if (!ztDrawerWrap) return;
  ztDrawerWrap.remove();
  ztDrawerWrap = null;
  try { document.documentElement.style.removeProperty('margin-right'); } catch (e) {}
}
// Mensagens do drawer embutido (fechar / ticket criado).
window.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || d.source !== 'zt-drawer') return;
  if (d.type === 'close' || d.type === 'created') closeInPageDrawer();
});

// ---- CNPJ/CPF automático: pesquisa + aviso ao drawer (se estiver aberto). ----
// Duas buscas convivem, uma não substitui a outra:
//   1) extractProfile() (acima) — já lia segmento/tag/nome-do-perfil atrás de
//      "cnpj"/"empresa"/"tenant" (usado por validateCurrent/extractTenant).
//   2) cnpj-scanner.js (abaixo) — varre o TEXTO da conversa por regex, achando
//      um CNPJ (14 dígitos) ou CPF (11 dígitos) cru ou já mascarado, e dispara
//      só quando aparece um documento NOVO (Set de "já vistos"). CPF cru só
//      conta se passar no dígito verificador (evita confundir com celular).
// Quando o scanner encontra um documento novo, CONSULTA se está cadastrado no
// banco (mesma rota que o resto da extensão usa — a busca funciona por dígitos,
// não importa se é CNPJ ou CPF), loga o resultado no console e — se achou —
// avisa o drawer (chrome.runtime.sendMessage chega tanto no painel lateral
// nativo quanto no iframe injetado, os dois são páginas da extensão).
// Nenhuma escrita no DOM/perfil do Crisp acontece aqui.
async function handleNewDocumento(documento) {
  const tipo = documento.includes('/') ? 'CNPJ' : 'CPF';
  chrome.runtime.sendMessage({ action: 'searchDatabase', query: [documento] }, (r) => {
    if (chrome.runtime.lastError) return;
    if (r && r.success) {
      console.info(`[Zorte Crisp] ${tipo} ${documento} detectado na conversa — CADASTRADO (${r.data && (r.data.name || r.data.nome)}).`);
      // Fire-and-forget: sem drawer aberto, não há listener — lastError é só
      // descartado pra não gerar warning no console.
      chrome.runtime.sendMessage({ action: 'cnpjMatchFound', company: r.data }, () => { void chrome.runtime.lastError; });
    } else {
      console.info(`[Zorte Crisp] ${tipo} ${documento} detectado na conversa — não cadastrado no banco.`);
    }
  });
}

let cnpjScannerInstance = null;
function startCnpjScanner() {
  if (typeof window.CnpjScanner === 'undefined') return; // cnpj-scanner.js não carregou
  if (cnpjScannerInstance) return;
  cnpjScannerInstance = window.CnpjScanner.createCnpjScanner({
    root: () => document.querySelector('.c-conversation-box-content') || document.body,
    onNew: (novos) => { for (const c of novos) handleNewDocumento(c); },
  });
  cnpjScannerInstance.start();
}

// O Crisp é uma SPA e recria o DOM; reinsere o botão periodicamente se sumir.
mountLauncher();
startCnpjScanner();
__ztInterval = setInterval(mountLauncher, 1500);
