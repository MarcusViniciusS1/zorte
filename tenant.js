// Content script — roda dentro do app.crisp.chat.
//
// 1) Responde ao popup (action "extractTenant") e ao Side Panel
//    (action "validateCurrent") lendo o perfil da conversa aberta.
<<<<<<< HEAD
// 2) Injeta um botão flutuante que abre o PAINEL LATERAL (Side Panel) do
//    navegador para registrar o atendimento — o Chrome encolhe a aba do Crisp,
//    então o painel não tampa nenhuma informação.
=======
// 2) Injeta um botão ao lado do perfil do contato (painel da direita) que
//    abre o PAINEL LATERAL (Side Panel) do navegador para registrar o
//    atendimento — o Chrome encolhe a aba do Crisp, então o painel não tampa
//    nenhuma informação.
>>>>>>> a65ab4e (Ajuste geral)

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
<<<<<<< HEAD
=======
let __ztWidgetClickHandler = null;
let __ztKeydownHandler = null;
>>>>>>> a65ab4e (Ajuste geral)
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
<<<<<<< HEAD
=======
  try { if (__ztWidgetClickHandler) document.removeEventListener('click', __ztWidgetClickHandler, true); } catch (e) {}
  try { if (__ztKeydownHandler) document.removeEventListener('keydown', __ztKeydownHandler); } catch (e) {}
>>>>>>> a65ab4e (Ajuste geral)
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
<<<<<<< HEAD
=======
  let email = "";
>>>>>>> a65ab4e (Ajuste geral)
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

<<<<<<< HEAD
=======
    // E-mail do contato (quando o Crisp já tem um cadastrado) também entra
    // como candidato de busca — bate contra empresas.email no backend (ver
    // /api/empresas/validar), então um contato cujo e-mail já foi vinculado a
    // uma empresa acha essa empresa mesmo sem CNPJ/tenant na conversa.
    const emailNode = document.querySelector('.c-conversation-profile__email');
    if (emailNode && !emailNode.classList.contains('c-conversation-profile__email--not-set') && emailNode.textContent) {
      const found = emailNode.textContent.trim();
      if (found.includes('@')) {
        email = found;
        candidates.push(found);
      }
    }

>>>>>>> a65ab4e (Ajuste geral)
    candidates = [...new Set(candidates.filter(c => c))];
  } catch (error) {
    /* ignora falhas de leitura do DOM */
  }

<<<<<<< HEAD
  return { candidates, url: currentUrl, phone, name: personName, channel: detectChannel() };
=======
  return { candidates, url: currentUrl, phone, name: personName, email, channel: detectChannel() };
}

// Extrai o website_id da URL do Crisp (.../website/{id}/inbox/session_...).
function extractWebsiteId() {
  const m = location.pathname.match(/\/website\/([0-9a-f-]{36})/i);
  return m ? m[1] : null;
}

// Extrai o session_id da conversa aberta (.../inbox/session_xxxxx/...).
function extractSessionId() {
  const m = location.pathname.match(/\/inbox\/(session_[^/]+)/i);
  return m ? m[1] : null;
}

// ---- Resumo com IA: mensagens raspadas direto do HTML da conversa ----
// Não fala com a API do Crisp (nem website_id/session_id são usados pra
// isso) — só lê o que já está renderizado na tela. Mesmo padrão de
// seletores robustos do resto do arquivo (classe/ícone confirmado no HTML
// real, não chutado).
//
// Estrutura confirmada: .c-conversation-box-content > .c-conversation-box-
// content__group (um por dia, com o divisor "Hoje"/"Ontem"/data) > várias
// .c-conversation-box-content-message (--user = cliente, --operator =
// atendente). O nome de quem falou só vem no tooltip do avatar, que só
// aparece na ÚLTIMA mensagem de cada sequência do mesmo remetente — por
// isso carrega o último nome visto pra frente dentro do mesmo grupo de dia.
const RE_TODAY_LABEL = /^(hoje|today|hoy|aujourd'hui|heute)$/i;

function extractGroupSenderName(msgEl) {
  const tip = msgEl.querySelector('.c-conversation-box-content-message__avatar-tooltip .c-base-tooltip__default');
  return tip ? tip.textContent.trim() : '';
}

function extractTodayMessagesFromDom() {
  // Busca no document inteiro (não restrito a filho direto de nenhum
  // container) - a lista de mensagens é virtualizada e o wrapper real entre
  // ".c-conversation-box-content" e cada grupo de dia pode variar.
  const groups = Array.from(document.querySelectorAll('.c-conversation-box-content__group'));
  const messages = [];

  for (const group of groups) {
    // Remove espaços/caracteres invisíveis que o Crisp às vezes injeta no
    // texto (soft hyphen, zero-width space, NBSP) — sem isso o regex ^...$
    // falha silenciosamente mesmo com o texto "parecendo" igual a "Hoje".
    const dateLabel = (group.querySelector('.c-conversation-box-content__date')?.textContent || '')
      .replace(/[\s ​‌‍﻿]+/g, ' ')
      .trim();
    if (!RE_TODAY_LABEL.test(dateLabel)) continue; // só nos interessa o grupo de hoje

    let lastOperatorName = '';
    let lastVisitorName = '';
    const msgEls = Array.from(group.querySelectorAll('.c-conversation-box-content-message'));
    for (const el of msgEls) {
      const isOperator = el.classList.contains('c-conversation-box-content-message--operator');
      const isVisitor = el.classList.contains('c-conversation-box-content-message--user');
      if (!isOperator && !isVisitor) continue; // evento de sistema etc.

      const name = extractGroupSenderName(el);
      if (isOperator && name) lastOperatorName = name;
      if (isVisitor && name) lastVisitorName = name;

      const contentEl = el.querySelector('.c-conversation-box-content-message-bubble__content');
      if (!contentEl) continue; // mensagem sem texto (imagem/arquivo) — ignora

      const text = (contentEl.innerText || contentEl.textContent || '').trim();
      if (!text) continue;

      messages.push({
        from: isOperator ? 'operator' : 'user',
        author: isOperator ? lastOperatorName : lastVisitorName,
        content: text,
      });
    }
  }

  return messages;
}

// Se a empresa foi identificada (tem CNPJ) e o "Dados do visitante" do Crisp
// ainda não tem esse CNPJ gravado (ou tem outro), grava — fica no PERFIL da
// pessoa, não só nesta conversa, pra próxima vez já vir pronto. Fire-and-
// forget: não trava a UI nem precisa do drawer aberto pra funcionar.
function syncCnpjToVisitorData(profile, data) {
  if (!data || !data.document) return;
  const websiteId = extractWebsiteId();
  if (!websiteId) return;
  chrome.runtime
    .sendMessage({
      action: 'crispSetPersonData',
      payload: { website_id: websiteId, name: profile.name, phone: profile.phone, cnpj: data.document },
    })
    .catch(() => {});
}

// O Crisp sempre renderiza .c-conversation-profile__email (endereço de
// verdade quando tem um cadastrado); sem e-mail, o próprio Crisp adiciona o
// modificador --not-set nessa mesma div e troca o texto por um convite
// ("definir e-mail") — confirmado no HTML real do painel de perfil. Usa a
// classe (estável, não depende do idioma/rótulo do Crisp) em vez de checar
// texto. Sempre reconsulta o DOM na hora (não guarda estado), porque o Crisp
// é uma SPA e o painel de perfil troca a cada conversa aberta.
function visitorHasEmailInCrisp() {
  const emailLine = document.querySelector('.c-conversation-profile__email');
  if (!emailLine) return false; // painel ainda não carregou — trata como "sem e-mail", tenta de novo depois
  return !emailLine.classList.contains('c-conversation-profile__email--not-set');
}

// Se a empresa identificada tiver e-mail cadastrado no nosso sistema E o
// visitante ainda não tiver e-mail no Crisp, preenche sozinho — evita o
// atendente ter que perguntar/digitar o e-mail do zero toda vez. Só GRAVA
// (nunca sobrescreve um e-mail já existente) e só quando o Crisp confirma,
// pelo próprio DOM, que a linha de e-mail está vazia. Fire-and-forget, mesmo
// padrão de syncCnpjToVisitorData.
function fillEmailIfMissing(profile, data) {
  if (!data || !data.email) {
    console.info('[Zorte Crisp] fillEmailIfMissing: empresa identificada não tem e-mail cadastrado no sistema — nada a fazer.');
    return;
  }
  if (visitorHasEmailInCrisp()) {
    console.info('[Zorte Crisp] fillEmailIfMissing: visitante já tem e-mail no Crisp — não sobrescreve.');
    return;
  }
  const websiteId = extractWebsiteId();
  if (!websiteId) {
    console.warn('[Zorte Crisp] fillEmailIfMissing: não consegui extrair o website_id da URL.');
    return;
  }
  console.info(`[Zorte Crisp] fillEmailIfMissing: tentando preencher ${data.email} (telefone: ${profile.phone || '(nenhum)'})...`);
  chrome.runtime
    .sendMessage({
      action: 'crispFillEmail',
      payload: { website_id: websiteId, phone: profile.phone, email: data.email },
    })
    .then((r) => {
      if (r && r.ok && r.updated) {
        console.info(`[Zorte Crisp] E-mail preenchido automaticamente a partir da empresa cadastrada: ${data.email}`);
      } else if (r && r.ok && r.updated === false) {
        console.warn('[Zorte Crisp] fillEmailIfMissing: backend não gravou.', r.reason || r);
      } else if (r && r.error) {
        console.warn('[Zorte Crisp] fillEmailIfMissing: erro do backend/Crisp:', r.error);
      } else {
        console.warn('[Zorte Crisp] fillEmailIfMissing: resposta inesperada.', r);
      }
    })
    .catch((e) => console.warn('[Zorte Crisp] fillEmailIfMissing: falha na chamada.', e && e.message));
>>>>>>> a65ab4e (Ajuste geral)
}

// Extrai o perfil e valida a empresa no banco (mesma lógica do popup).
// Retorna { found, data, extra:{name,phone,url} }.
async function validateCurrent() {
  const profile = extractProfile();
  let data = null;
  if (profile.candidates && profile.candidates.length) {
<<<<<<< HEAD
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
=======
    try {
      const r = await chrome.runtime.sendMessage({ action: 'searchDatabase', query: profile.candidates });
      data = r && r.success ? r.data : null;
    } catch {
      data = null; // extensão recarregada — F5 na aba resolve
    }
  }
  syncCnpjToVisitorData(profile, data);
  fillEmailIfMissing(profile, data);
  return {
    found: !!data,
    data,
    extra: { name: profile.name, phone: profile.phone, email: profile.email, url: profile.url || location.href, channel: profile.channel || '' },
    websiteId: extractWebsiteId(),
    sessionId: extractSessionId(),
>>>>>>> a65ab4e (Ajuste geral)
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

<<<<<<< HEAD
=======
  // Pedido do background (botão "Resumir com IA" do drawer): raspa as
  // mensagens de hoje direto do HTML, sem tocar na API do Crisp.
  if (request.action === "scrapeTodayMessages") {
    try {
      sendResponse({ success: true, messages: extractTodayMessagesFromDom() });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

>>>>>>> a65ab4e (Ajuste geral)
  // Não é uma mensagem deste script (ex.: CRISP_GET_STATUS é do crisp-ui.js):
  // não segura o canal de resposta.
  return false;
});

<<<<<<< HEAD
// ---- Botão flutuante que abre o Side Panel ----
function mountLauncher() {
  if (document.getElementById('zt-launcher')) return;
=======
// Abre o painel (nativo do Chrome; se recusar, cai pro drawer embutido na
// página) — usado tanto pelo clique no botão flutuante quanto pelo atalho
// de teclado Ctrl+\ (ver listener mais abaixo). Chamado sempre a partir de
// um gesto do usuário (clique ou tecla), exigido pelo chrome.sidePanel.open().
async function openDrawer() {
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ action: 'openSidePanel' });
  } catch (e) {
    console.warn('[Zorte Crisp] Extensão recarregada — dê F5 na aba do Crisp.', e && e.message);
    return;
  }
  if (resp && resp.ok === false) {
    console.warn('[Zorte Crisp] Painel nativo recusado, abrindo na página. Motivo:', resp.error);
    openInPageDrawer();
  }
}

// Alterna abrir/fechar (usado só pelo atalho de teclado — o botão flutuante
// continua só abrindo, igual sempre foi). O fallback embutido (iframe) já
// controla seu próprio estado aqui mesmo (ztDrawerWrap), então fecha direto
// sem envolver o background; o painel nativo não tem essa informação do
// lado do content script, por isso pergunta ("toggleSidePanel") — ver
// background.js/drawer.js pra como esse estado é rastreado.
async function toggleDrawer() {
  if (ztDrawerWrap) { closeInPageDrawer(); return; }
  let resp;
  try {
    resp = await chrome.runtime.sendMessage({ action: 'toggleSidePanel' });
  } catch (e) {
    console.warn('[Zorte Crisp] Extensão recarregada — dê F5 na aba do Crisp.', e && e.message);
    return;
  }
  if (resp && resp.action === 'open' && resp.ok === false) {
    console.warn('[Zorte Crisp] Painel nativo recusado, abrindo na página. Motivo:', resp.error);
    openInPageDrawer();
  }
}

// Atalho de teclado Ctrl+\ — abre/fecha o painel sem precisar clicar no
// botão flutuante. Não usa a Commands API do manifest.json porque ela só
// aceita um conjunto fixo de teclas (letras, números, setas...) e "\" não
// está nessa lista; um listener de teclado no content script não tem essa
// restrição. preventDefault pra não deixar o "\" vazar pra dentro de algum
// campo de texto focado no Crisp (ex.: caixa de resposta).
__ztKeydownHandler = function (ev) {
  if (ev.ctrlKey && !ev.shiftKey && !ev.altKey && ev.key === '\\') {
    ev.preventDefault();
    toggleDrawer();
  }
};
document.addEventListener('keydown', __ztKeydownHandler);

// ---- Botão que abre o Side Panel, ao lado do perfil do contato ----
// Antes era flutuante (canto inferior direito da página); agora fica
// encaixado dentro do bloco de perfil do contato (avatar + nome + e-mail, no
// painel da direita), como pedido — só aparece quando esse painel está
// carregado (conversa aberta), que é justamente quando faz sentido registrar
// o atendimento. margin-left:auto empurra o botão pro final da linha (a
// pedido: mesma altura do avatar/nome, mas encostado na borda direita).
const PROFILE_INFO_SELECTOR = '.c-conversation-profile__information';
function mountLauncher() {
  if (document.getElementById('zt-launcher')) return;
  const profileInfo = document.querySelector(PROFILE_INFO_SELECTOR);
  if (!profileInfo) return; // painel de perfil ainda não carregado — tenta de novo no próximo tick

>>>>>>> a65ab4e (Ajuste geral)
  const btn = document.createElement('button');
  btn.id = 'zt-launcher';
  btn.type = 'button';
  btn.textContent = '+ Registrar atendimento';
  btn.style.cssText =
<<<<<<< HEAD
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
=======
    'margin-left:auto;border:0;cursor:pointer;flex-shrink:0;white-space:nowrap;align-self:center;' +
    'padding:6px 14px;border-radius:999px;color:#fff;font:600 12px/1 -apple-system,Segoe UI,Roboto,sans-serif;' +
    'background:linear-gradient(135deg,#ef4444,#dc2626);box-shadow:0 2px 10px rgba(239,68,68,.35);';
  // O clique é um gesto do usuário: tenta o painel lateral nativo do Chrome.
  // Se o Chrome recusar (gesto perdido/serviço dormindo), abre o drawer na
  // própria página como fallback — assim o botão SEMPRE abre algo.
  btn.addEventListener('click', openDrawer);
  profileInfo.appendChild(btn);
>>>>>>> a65ab4e (Ajuste geral)
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

<<<<<<< HEAD
=======
// ---- Ponte: botão "Criar Ticket" do painel nativo do Crisp ----
// Se o Generic Widget "Zorte Integration" ainda estiver instalado no
// Marketplace do Crisp (o backend que o suportava foi removido — só restou
// esse botão do lado de lá), ele é renderizado pelo próprio Crisp: não é um
// iframe nosso, não tem JS nosso rodando ali dentro, então não existe
// postMessage disponível. A única forma de reagir ao clique é vigiar o DOM
// (mesma técnica que crisp-ui.js já usa pro bloqueio de finalização),
// procurando pelo texto exato do botão.
__ztWidgetClickHandler = function (ev) {
  const target = ev.target && ev.target.closest ? ev.target.closest('button, [role="button"], a') : null;
  if (!target || target.textContent.trim() !== 'Criar Ticket') return;
  chrome.runtime.sendMessage({ action: 'openSidePanel' })
    .then((resp) => { if (resp && resp.ok === false) openInPageDrawer(); })
    .catch(() => openInPageDrawer());
};
document.addEventListener('click', __ztWidgetClickHandler, true);

>>>>>>> a65ab4e (Ajuste geral)
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
<<<<<<< HEAD
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
=======
// não importa se é CNPJ ou CPF), loga o resultado no console, avisa o drawer
// (chrome.runtime.sendMessage chega tanto no painel lateral nativo quanto no
// iframe injetado) e grava o CNPJ no "Dados do visitante" do Crisp (ver
// syncCnpjToVisitorData) — nenhuma escrita no DOM da página acontece aqui.
async function handleNewDocumento(documento) {
  const tipo = documento.includes('/') ? 'CNPJ' : 'CPF';
  // Forma baseada em Promise + .catch (não callback) — é a única que de fato
  // suprime o "Uncaught (in promise) Extension context invalidated" quando a
  // extensão é recarregada com esta aba já aberta. O callback-style dispara
  // essa promise internamente mesmo com try/catch e checagem de lastError
  // por fora; só resolve tratando a promise que o Chrome já devolve.
  let r;
  try {
    r = await chrome.runtime.sendMessage({ action: 'searchDatabase', query: [documento] });
  } catch {
    return; // extensão recarregada — só uma aba nova (F5) resolve
  }
  if (r && r.success) {
    console.info(`[Zorte Crisp] ${tipo} ${documento} detectado na conversa — CADASTRADO (${r.data && (r.data.name || r.data.nome)}).`);
    // Fire-and-forget: sem drawer aberto, não há listener do outro lado —
    // ignora tanto rejeição de promise quanto lastError.
    chrome.runtime.sendMessage({ action: 'cnpjMatchFound', company: r.data }).catch(() => {});
    const profileNow = extractProfile();
    syncCnpjToVisitorData(profileNow, r.data);
    fillEmailIfMissing(profileNow, r.data);
  } else {
    console.info(`[Zorte Crisp] ${tipo} ${documento} detectado na conversa — não cadastrado no banco.`);
  }
>>>>>>> a65ab4e (Ajuste geral)
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

<<<<<<< HEAD
// O Crisp é uma SPA e recria o DOM; reinsere o botão periodicamente se sumir.
mountLauncher();
startCnpjScanner();
__ztInterval = setInterval(mountLauncher, 1500);
=======
// Mesmo placeholder usado pelo botão manual "Criar contato" do drawer (ver
// drawer.js) — precisa ser o MESMO valor literal nos dois lugares (não dá
// pra importar entre content scripts/extension pages), senão a lógica de
// "veio um e-mail de verdade, substitui o placeholder" para de bater.
const WHATSAPP_PLACEHOLDER_EMAIL = 'whatsapp@zorte.com';

// Mesma máscara de telefone do drawer.js (ver maskPhone lá) — duplicada aqui
// pelo mesmo motivo (não dá pra importar entre contextos da extensão). O
// telefone capturado da conversa do Crisp às vezes vem em formato
// internacional ("+554191965788"); 55 é o código do país (DDI), não um DDD
// — sem remover ANTES de salvar, o contato ia pro banco com o telefone cru e
// ficava incorreto tanto na busca quanto na exibição no sistema web.
function onlyDigits(v) {
  return (v || '').replace(/\D/g, '');
}
function maskPhone(v) {
  let d = onlyDigits(v);
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (!d) return '';
  if (d.length <= 10) {
    return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  }
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}

// Cria ou atualiza automaticamente o cadastro do contato no sistema web pra
// CADA conversa do Crisp — espelha o botão manual "Criar contato" do drawer,
// mas dispara sozinho, sem precisar o atendente clicar em nada.
// Retorna true quando já resolveu (criou, atualizou, ou confirmou que não há
// nada a fazer) e false quando ainda falta dado pra decidir (ex.: nome do
// visitante ainda não renderizou no Crisp) — quem chama usa isso pra saber
// se vale tentar de novo no próximo tick (ver maybeAutoUpsertContactForActiveConversation).
async function autoUpsertContact(profile, data) {
  const name = (profile.name || '').trim();
  const phone = maskPhone(profile.phone || '');
  const email = (profile.email || '').trim(); // e-mail de verdade já visível no Crisp, se houver
  const canal = profile.channel || '';
  const companyId = data && data.id ? data.id : null;
  const conversationUrl = profile.url || location.href;

  if (!phone && !email) {
    console.info('[Zorte Crisp] autoUpsertContact: ainda sem telefone/e-mail pra identificar o contato — tento de novo no próximo tick.');
    return false;
  }
  const emailForRecord = email || (canal === 'whatsapp' ? WHATSAPP_PLACEHOLDER_EMAIL : '');

  let found;
  try {
    found = await chrome.runtime.sendMessage({ action: 'findContact', email: email || undefined, phone: phone || undefined, company_id: companyId || undefined });
  } catch (e) {
    console.warn('[Zorte Crisp] autoUpsertContact: falha ao consultar o sistema (extensão recarregada?).', e && e.message);
    return false;
  }
  if (!found || found.ok === false) {
    console.warn('[Zorte Crisp] autoUpsertContact: backend recusou a busca do contato.', found && (found.error || found));
    return false;
  }
  const existing = found.data && found.data.data;

  if (existing) {
    const patch = {};
    if (!existing.phone && phone) patch.phone = phone;
    if (!existing.email && emailForRecord) {
      patch.email = emailForRecord;
    } else if (existing.email === WHATSAPP_PLACEHOLDER_EMAIL && email && email.toLowerCase() !== WHATSAPP_PLACEHOLDER_EMAIL) {
      patch.email = email;
    }
    if (!existing.company_id && companyId) patch.company_id = companyId;
    // Link da conversa: sempre atualiza pro atendimento atual (diferente dos
    // campos acima, que só completam se estiverem faltando).
    if (conversationUrl && existing.conversation_url !== conversationUrl) patch.conversation_url = conversationUrl;

    if (Object.keys(patch).length === 0) {
      console.info('[Zorte Crisp] autoUpsertContact: contato já existente e completo — nada a atualizar.');
      return true;
    }
    const r = await chrome.runtime.sendMessage({ action: 'updateContact', id: existing.id, patch }).catch((e) => {
      console.warn('[Zorte Crisp] autoUpsertContact: falha na chamada de atualização.', e && e.message);
      return null;
    });
    if (r && r.ok) console.info('[Zorte Crisp] autoUpsertContact: contato atualizado automaticamente.', patch);
    else console.warn('[Zorte Crisp] autoUpsertContact: falha ao atualizar contato.', r && (r.error || r));
    return true; // já tentou — não repete mesmo se falhou (evita martelar o backend)
  }

  // contatos.nome é NOT NULL no banco — sem nome extraído do Crisp não dá
  // pra criar ainda. O nome pode renderizar num tick seguinte (painel de
  // perfil do Crisp carrega em partes), então vale tentar de novo depois.
  if (!name) {
    console.info('[Zorte Crisp] autoUpsertContact: ainda sem nome do visitante — tento de novo no próximo tick.');
    return false;
  }
  const r = await chrome.runtime.sendMessage({
    action: 'createContact',
    contact: { name, phone: phone || null, email: emailForRecord || null, company_id: companyId || null, conversation_url: conversationUrl },
  }).catch((e) => {
    console.warn('[Zorte Crisp] autoUpsertContact: falha na chamada de criação.', e && e.message);
    return null;
  });
  if (r && r.ok) console.info('[Zorte Crisp] autoUpsertContact: contato criado automaticamente no sistema.');
  else console.warn('[Zorte Crisp] autoUpsertContact: falha ao criar contato.', r && (r.error || r));
  return true;
}

// Guarda o último resultado de busca de empresa por sessão (ver
// maybeAutoFillEmailForActiveConversation, que já faz essa busca uma vez por
// conversa) pra maybeAutoUpsertContactForActiveConversation reaproveitar sem
// repetir a consulta ao backend.
let __ztLastCompanyMatch = { sessionId: null, data: null };

// Roda em TODO tick do intervalo de 1,5s (ao contrário do e-mail/empresa,
// que é uma tentativa só) até resolver — porque o nome do visitante
// (obrigatório pra criar um contato novo) pode aparecer no DOM alguns ticks
// depois do resto do painel de perfil já estar montado; travar numa
// tentativa única (como o e-mail faz) deixava o contato sem ser criado
// sempre que esse nome chegasse um pouco atrasado. Limita as tentativas pra
// não martelar o backend indefinidamente numa conversa sem telefone/e-mail/
// nome utilizável.
let __ztContactUpsertState = { sessionId: null, attempts: 0, done: false };
const ZT_CONTACT_UPSERT_MAX_ATTEMPTS = 20; // ~30s de tentativas a cada 1,5s
async function maybeAutoUpsertContactForActiveConversation() {
  const sessionId = extractSessionId();
  if (!sessionId) return;
  if (__ztContactUpsertState.sessionId !== sessionId) {
    __ztContactUpsertState = { sessionId, attempts: 0, done: false };
  }
  if (__ztContactUpsertState.done || __ztContactUpsertState.attempts >= ZT_CONTACT_UPSERT_MAX_ATTEMPTS) return;
  const profileInfo = document.querySelector(PROFILE_INFO_SELECTOR);
  if (!profileInfo) return; // painel de perfil ainda não carregou — tenta de novo no próximo tick
  __ztContactUpsertState.attempts++;

  const profile = extractProfile();
  const data = __ztLastCompanyMatch.sessionId === sessionId ? __ztLastCompanyMatch.data : null;
  const resolved = await autoUpsertContact(profile, data);
  if (resolved) __ztContactUpsertState.done = true;
}

// Preenche o e-mail sozinho pra QUALQUER conversa aberta (não só quando o
// atendente abre o drawer ou digita "Buscar") — é o caso de uso real: o
// cliente manda mensagem pelo WhatsApp e ninguém necessariamente abre o
// painel lateral pra isso. Roda no mesmo intervalo de 1,5s que já reinsere o
// botão; __ztLastEmailCheckSession garante no máximo UMA tentativa por
// conversa (mesmo se falhar), pra não ficar chamando a API do Crisp/nosso
// backend a cada 1,5s enquanto a conversa continuar aberta. Também guarda o
// resultado da busca de empresa em __ztLastCompanyMatch, reaproveitado pelo
// auto-upsert de contato (que tem seu próprio ritmo de tentativas, ver acima).
let __ztLastEmailCheckSession = null;
async function maybeAutoFillEmailForActiveConversation() {
  const sessionId = extractSessionId();
  if (!sessionId || sessionId === __ztLastEmailCheckSession) return;
  const profileInfo = document.querySelector(PROFILE_INFO_SELECTOR);
  if (!profileInfo) return; // painel de perfil ainda não carregou — tenta de novo no próximo tick
  __ztLastEmailCheckSession = sessionId;

  const profile = extractProfile();
  if (!profile.candidates || !profile.candidates.length) {
    console.info('[Zorte Crisp] maybeAutoFillEmail: sem CNPJ/nome/tenant pra identificar a empresa nesta conversa.');
    __ztLastCompanyMatch = { sessionId, data: null };
    return;
  }
  let data = null;
  try {
    const r = await chrome.runtime.sendMessage({ action: 'searchDatabase', query: profile.candidates });
    data = r && r.success ? r.data : null;
  } catch (e) {
    console.warn('[Zorte Crisp] maybeAutoFillEmail: falha ao consultar o sistema.', e && e.message);
    data = null;
  }
  __ztLastCompanyMatch = { sessionId, data };
  fillEmailIfMissing(profile, data);
}

// Avisa o drawer sempre que o atendente troca de conversa no Crisp — sem
// isso, o formulário de "Criar ticket" ficava com os dados do cliente
// ANTERIOR (nome/telefone/e-mail/empresa antigos), podendo gerar um ticket
// com informação errada se o atendente esquecesse de limpar na mão. Dispara
// toda vez que o session_id muda de verdade (mesmo voltando a uma conversa
// já vista antes) — diferente do __ztLastEmailCheckSession acima, que é
// "uma tentativa só, pra sempre" por conversa.
let __ztLastNotifiedSession = extractSessionId(); // conversa já aberta ao carregar o script não conta como "troca"
function notifyIfConversationChanged() {
  const sessionId = extractSessionId();
  if (!sessionId || sessionId === __ztLastNotifiedSession) return;
  __ztLastNotifiedSession = sessionId;
  chrome.runtime.sendMessage({ action: 'conversationChanged', sessionId }).catch(() => {});
}

// O Crisp é uma SPA e recria o DOM; reinsere o botão periodicamente se sumir.
mountLauncher();
startCnpjScanner();
__ztInterval = setInterval(async () => {
  mountLauncher();
  // Espera a busca de empresa (assíncrona) terminar antes do auto-upsert —
  // senão, na primeira vez que a conversa abre, o upsert roda antes do
  // resultado chegar e cria/atualiza o contato sem vincular a empresa (ver
  // __ztLastCompanyMatch, preenchido só ao final de maybeAutoFillEmail...).
  await maybeAutoFillEmailForActiveConversation();
  maybeAutoUpsertContactForActiveConversation();
  notifyIfConversationChanged();
}, 1500);
>>>>>>> a65ab4e (Ajuste geral)
