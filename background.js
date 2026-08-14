// background.js — service worker unificado.
//
// Junta as duas extensões:
//  (A) "Etiquetas do Crisp" (crisp-ui.js): badge do ícone por aba + reinjeção
//      após atualizar + aviso de versão.
//  (B) "Tenant Finder" (tenant.js/drawer): abertura do painel lateral,
//      ponte de contexto com o content script e chamadas ao backend local.

// ============================================================
// (B) Backend local + Side Panel
// ============================================================

const API_BASE = 'http://192.168.0.104:3001/api/empresas';
const API_ROOT = 'http://192.168.0.104:3001/api';

// Estado de "o painel lateral nativo está aberto?" — o chrome.sidePanel não
// expõe API nenhuma pra consultar isso, então o próprio drawer.js avisa
// quando carrega (drawerOpened) e sempre que se fecha (drawerClosed, ver
// dismiss() em drawer.js — cobre X, auto-close ao trocar de aba, e o
// fechamento pedido por aqui). Isso é o que permite o atalho Ctrl+\\
// alternar abrir/fechar em vez de só abrir.
let drawerOpen = false;

function openNativeSidePanel(tabId, sendResponse) {
  if (tabId == null) { sendResponse({ ok: false, action: 'open', error: 'sem aba' }); return; }
  chrome.sidePanel.setOptions({ tabId, path: 'drawer.html', enabled: true });
  chrome.sidePanel.open({ tabId })
    .then(() => sendResponse({ ok: true, action: 'open' }))
    .catch((e) => sendResponse({ ok: false, action: 'open', error: e.message }));
}

// Login obrigatório: o backend agora exige "Authorization: Bearer <token>"
// em quase toda rota /api/*. O token fica em chrome.storage.local (não dá
// pra usar localStorage da página — extensão e página web têm storages
// isolados) e é anexado aqui, num só lugar, pra todo fetch que este arquivo
// faz (content scripts nunca chamam o backend direto, sempre passam por
// aqui via chrome.runtime.sendMessage).
async function getToken() {
  const { zt_token } = await chrome.storage.local.get('zt_token');
  return zt_token || null;
}
async function authHeaders(extra) {
  const token = await getToken();
  return { ...(extra || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

// Guarda a sessão (usado tanto pelo login direto na extensão quanto pela
// ponte com o sistema web, ver web-bridge.js) e já deriva myDisplayName/
// myMatchToken pra etiqueta 🚨 do Crisp — um só lugar pras duas origens.
async function applySession(token, attendant) {
  await chrome.storage.local.set({ zt_token: token, zt_attendant: attendant || null });
  const name = (attendant && attendant.name) || '';
  await chrome.storage.sync.set({ myDisplayName: name, myMatchToken: name.split(' ')[0] || '' });
}
async function clearSession() {
  await chrome.storage.local.remove(['zt_token', 'zt_attendant']);
  await chrome.storage.sync.remove(['myDisplayName', 'myMatchToken']);
}

async function apiGet(path) {
  try {
    const res = await fetch(`${API_ROOT}${path}`, { headers: await authHeaders() });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) await chrome.storage.local.remove('zt_token');
    return { ok: res.ok, unauthorized: res.status === 401, data };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}
async function apiPost(path, body) {
  try {
    const res = await fetch(`${API_ROOT}${path}`, {
      method: 'POST',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) await chrome.storage.local.remove('zt_token');
    return { ok: res.ok, unauthorized: res.status === 401, data };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}
async function apiPatch(path, body) {
  try {
    const res = await fetch(`${API_ROOT}${path}`, {
      method: 'PATCH',
      headers: await authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) await chrome.storage.local.remove('zt_token');
    return { ok: res.ok, unauthorized: res.status === 401, data };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;

  // Abre o painel lateral na aba de onde veio o clique (sempre uma aba do
  // Crisp). open() precisa rodar dentro do gesto do usuário: nada de await antes.
  if (request.action === "openSidePanel") {
    openNativeSidePanel(sender && sender.tab && sender.tab.id, sendResponse);
    return true;
  }

  // Atalho de teclado (Ctrl+\, ver tenant.js): abre se estiver fechado,
  // fecha se já estiver aberto.
  if (request.action === "toggleSidePanel") {
    if (drawerOpen) {
      chrome.runtime.sendMessage({ action: 'closeDrawer' }).catch(() => {});
      sendResponse({ ok: true, action: 'close' });
      return true;
    }
    openNativeSidePanel(sender && sender.tab && sender.tab.id, sendResponse);
    return true;
  }

  // O próprio drawer.js avisa seu ciclo de vida (ver comentário acima de
  // drawerOpen) — não precisa de resposta.
  if (request.action === "drawerOpened") {
    drawerOpen = true;
    return false;
  }
  if (request.action === "drawerClosed") {
    drawerOpen = false;
    return false;
  }

  // O painel pede o contexto da conversa: repassa ao content script da aba
  // ativa do Crisp e devolve { ok, found, data, extra }.
  if (request.action === "getContext") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !/app\.crisp\.chat/.test(tab.url || '')) {
        sendResponse({ ok: false, error: 'not-crisp' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action: 'validateCurrent' }, (r) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        sendResponse({
          ok: true,
          found: !!(r && r.found),
          data: r && r.data,
          extra: (r && r.extra) || {},
          websiteId: r && r.websiteId,
          sessionId: r && r.sessionId,
        });
      });
    });
    return true;
  }

  // Pede pra IA (Gemini, no backend) sugerir os campos do ticket a partir das
  // mensagens de HOJE — raspadas do HTML da conversa (tenant.js), não da API
  // do Crisp. O backend só recebe o texto que já está na tela.
  if (request.action === "summarizeCrisp") {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs && tabs[0];
      if (!tab || !/app\.crisp\.chat/.test(tab.url || '')) {
        sendResponse({ ok: false, error: 'not-crisp' });
        return;
      }
      chrome.tabs.sendMessage(tab.id, { action: 'scrapeTodayMessages' }, (r) => {
        if (chrome.runtime.lastError) {
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        const messages = (r && r.success && r.messages) || [];
        if (!messages.length) {
          sendResponse({ ok: true, data: { ok: false, reason: 'nenhuma mensagem de hoje encontrada na tela' } });
          return;
        }
        apiPost('/crisp/summarize', { messages }).then(sendResponse);
      });
    });
    return true;
  }

  // Lista de tickets pro modo "Consultar ticket" do drawer — filtro de
  // "em aberto" (não resolvido/fechado), busca, "atribuídos a mim" e
  // ordenação por prioridade acontecem no drawer.js, aqui só devolve todos
  // com os embeds necessários pra isso.
  if (request.action === "getOpenTickets") {
    apiGet('/tickets?embed=companies,attendant,contact&order_by=created_at&order_dir=desc').then(sendResponse);
    return true;
  }

  // Notas do ticket pro detalhe compacto da aba "Consultar" (ver
  // showTicketDetail em drawer.js).
  if (request.action === "getTicketNotes") {
    const q = new URLSearchParams();
    q.set('eq.ticket_id', request.ticketId);
    q.set('embed', 'attendant');
    q.set('order_by', 'created_at');
    q.set('order_dir', 'asc');
    apiGet(`/ticket_notes?${q.toString()}`).then(sendResponse);
    return true;
  }

  if (request.action === "createTicketNote") {
    apiPost('/ticket_notes', {
      ticket_id: request.ticket_id,
      attendant_id: request.attendant_id,
      note: request.note,
      is_internal: request.is_internal,
    }).then(sendResponse);
    return true;
  }

  // Confirmação de leitura por atendente (estilo WhatsApp, mesmo mecanismo
  // do TicketDetail.tsx) — abrir o detalhe do ticket no drawer marca como
  // visto (markTicketRead) e busca quem já viu (getTicketReads).
  if (request.action === "markTicketRead") {
    apiPost(`/tickets/${request.ticketId}/read`, {}).then(sendResponse);
    return true;
  }

  if (request.action === "getTicketReads") {
    apiGet(`/tickets/${request.ticketId}/reads`).then(sendResponse);
    return true;
  }

  // Aviso (sino + Discord) de quem foi @mencionado numa nota — mesma rota
  // que TicketDetail.tsx usa no site (POST /api/mentions/notify).
  if (request.action === "notifyMentions") {
    apiPost('/mentions/notify', { ticket_id: request.ticket_id, attendant_ids: request.attendant_ids }).then(sendResponse);
    return true;
  }

  // Notificações não lidas de quem está logado — usado por tenant.js pra
  // avisar (toast na página do Crisp) quando alguém comenta num ticket, e
  // por drawer.js pra marcar ticket como "não lido" na aba Consultar.
  if (request.action === "getUnreadNotifications") {
    (async () => {
      const { zt_attendant } = await chrome.storage.local.get('zt_attendant');
      if (!zt_attendant || !zt_attendant.id) { sendResponse({ ok: true, data: { data: [] } }); return; }
      const q = new URLSearchParams();
      q.set('eq.attendant_id', zt_attendant.id);
      q.set('eq.read', 'false');
      q.set('embed', 'ticket');
      q.set('order_by', 'created_at');
      q.set('order_dir', 'desc');
      sendResponse(await apiGet(`/notifications?${q.toString()}`));
    })();
    return true;
  }

  // Marca como lidas todas as notificações de quem está logado pra UM
  // ticket específico — chamado quando o ticket é aberto no drawer (ver
  // showTicketDetail em drawer.js), pra sair do estado "não lido".
  if (request.action === "markTicketNotificationsRead") {
    (async () => {
      const { zt_attendant } = await chrome.storage.local.get('zt_attendant');
      if (!zt_attendant || !zt_attendant.id || !request.ticketId) { sendResponse({ ok: true, count: 0 }); return; }
      const q = new URLSearchParams();
      q.set('eq.attendant_id', zt_attendant.id);
      q.set('eq.ticket_id', request.ticketId);
      q.set('eq.read', 'false');
      const r = await apiGet(`/notifications?${q.toString()}`);
      const list = (r.data && r.data.data) || [];
      for (const n of list) await apiPatch(`/notifications/${n.id}`, { read: true });
      sendResponse({ ok: true, count: list.length });
    })();
    return true;
  }

  // Busca 1 ticket específico por id, com os mesmos embeds da lista — usado
  // quando o drawer precisa abrir direto num ticket que talvez não esteja
  // na lista de "em aberto" já carregada (ex.: veio de um toast de
  // comentário novo, ver tenant.js).
  if (request.action === "getTicketById") {
    (async () => {
      const q = new URLSearchParams();
      q.set('eq.id', request.ticketId);
      q.set('embed', 'companies,attendant,contact,creator');
      const r = await apiGet(`/tickets?${q.toString()}`);
      if (!r || !r.ok) { sendResponse(r); return; }
      sendResponse({ ok: true, data: { data: (r.data.data || [])[0] || null } });
    })();
    return true;
  }

  // Catálogo de módulos/preços pra aba "Módulos" do drawer — busca e
  // agrupamento por categoria acontecem no drawer.js, aqui só devolve tudo.
  if (request.action === "getModules") {
    apiGet('/modules').then(sendResponse);
    return true;
  }

  // Lista de contatos pra aba "Contatos" do drawer (estilo agenda) — busca e
  // filtro por nome/empresa/telefone acontecem no drawer.js, aqui só devolve
  // todos com a empresa vinculada.
  if (request.action === "getContacts") {
    apiGet('/contacts?embed=company&order_by=name&order_dir=asc').then(sendResponse);
    return true;
  }

  if (request.action === "getAttendants") {
    apiGet('/attendants?order_by=name&order_dir=asc').then(sendResponse);
    return true;
  }

  if (request.action === "searchCompany") {
    apiGet(`/lookup/company?q=${encodeURIComponent(request.query || '')}`).then(sendResponse);
    return true;
  }

  // Aba "Histórico" do drawer — lista de tickets da empresa + filiais do
  // mesmo tenant, e total de conversas distintas (recorrência).
  if (request.action === "getCompanyTicketHistory") {
    apiGet(`/companies/${encodeURIComponent(request.companyId)}/ticket-history`).then(sendResponse);
    return true;
  }

  if (request.action === "crispSetPersonData") {
    apiPost('/crisp/person-data', request.payload).then(sendResponse);
    return true;
  }

  // Preenche o e-mail nativo do contato no Crisp com o e-mail da empresa
  // cadastrada no nosso sistema — só chamado quando o conteúdo já confirmou
  // (pelo DOM) que o visitante ainda não tem e-mail (ver tenant.js).
  if (request.action === "crispFillEmail") {
    apiPost('/crisp/fill-email', request.payload).then(sendResponse);
    return true;
  }

  if (request.action === "createTicket") {
    apiPost('/tickets', request.ticket).then(sendResponse);
    return true;
  }

  // Cria o contato do cliente no sistema web a partir dos campos já
  // preenchidos no drawer (ver botão "Criar contato" em drawer.js).
  if (request.action === "createContact") {
    apiPost('/contacts', request.contact).then(sendResponse);
    return true;
  }

  // Acha um contato já existente por e-mail/telefone — chamado ANTES de
  // criar, pra avisar "já existe" em vez de duplicar (ver drawer.js). Passar
  // company_id junto habilita o fallback do backend: mesma empresa + único
  // contato com e-mail real e sem telefone ainda conta como "já existe".
  if (request.action === "findContact") {
    const q = new URLSearchParams();
    if (request.email) q.set('email', request.email);
    if (request.phone) q.set('phone', request.phone);
    if (request.company_id) q.set('company_id', request.company_id);
    apiGet(`/contacts/find?${q.toString()}`).then(sendResponse);
    return true;
  }

  // Completa campos vazios de um contato já existente (ver drawer.js).
  if (request.action === "updateContact") {
    apiPatch(`/contacts/${request.id}`, request.patch).then(sendResponse);
    return true;
  }

  // Assumir/Finalizar/Transferir no detalhe do ticket do drawer (ver
  // buildTicketActions em drawer.js) — mesma rota genérica de PATCH que o
  // site usa.
  if (request.action === "updateTicket") {
    apiPatch(`/tickets/${request.id}`, request.patch).then(sendResponse);
    return true;
  }

  // Aba "Caixa de Entrada" — tickets com notificação não lida (ver
  // GET /api/inbox em backend/index.js).
  if (request.action === "getInbox") {
    apiGet('/inbox').then(sendResponse);
    return true;
  }

  // Registra 1 "visita" ao suporte pra essa conversa do Crisp (ver
  // Navegador/tenant.js, maybeRecordSupportVisitForActiveConversation) — só
  // pra medir recorrência de contato por empresa, sem depender de ticket.
  if (request.action === "recordSupportVisit") {
    apiPost('/support-visits', { session_id: request.sessionId, company_id: request.companyId }).then(sendResponse);
    return true;
  }

  if (request.action === "getTags") {
    apiGet('/tags?order_by=name&order_dir=asc').then(sendResponse);
    return true;
  }

  if (request.action === "createTag") {
    apiPost('/tags', request.tag).then(sendResponse);
    return true;
  }

  if (request.action === "createLog") {
    apiPost('/system_logs', request.log).then(sendResponse);
    return true;
  }

  if (request.action === "getLinearStatus") {
    apiGet('/linear/status').then(sendResponse);
    return true;
  }

  if (request.action === "searchLinearIssues") {
    apiGet(`/linear/issues?q=${encodeURIComponent(request.query || '')}`).then(sendResponse);
    return true;
  }

  if (request.action === "searchDatabase") {
    const candidates = request.query;
    authHeaders({ 'Content-Type': 'application/json' }).then((headers) => {
      fetch(`${API_BASE}/validar`, { method: 'POST', headers, body: JSON.stringify({ candidates }) })
        .then(async (response) => {
          if (response.status === 401) { await chrome.storage.local.remove('zt_token'); throw new Error('não autenticado'); }
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then(data => {
          if (data && data.found) sendResponse({ success: true, data: data.data });
          else sendResponse({ success: false, reason: "NOT_FOUND" });
        })
        .catch(error => sendResponse({ success: false, reason: "API_ERROR", message: error.message }));
    });
    return true;
  }

  if (request.action === "testConnection") {
    authHeaders().then((headers) => {
      fetch(`${API_BASE}?limit=1`, { headers })
        .then(response => {
          if (response.ok) sendResponse({ success: true });
          else throw new Error(`Erro HTTP: ${response.status}`);
        })
        .catch(error => sendResponse({ success: false, message: error.message }));
    });
    return true;
  }

  // ---- Login (obrigatório desde que o backend passou a exigir token) ----
  // Quem está logado também passa a valer como "Quem é você" pra etiqueta
  // 🚨 do Crisp (crisp-ui.js lê myDisplayName/myMatchToken de
  // chrome.storage.sync) — não precisa mais escolher isso manualmente.
  if (request.action === "login") {
    fetch(`${API_ROOT}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: request.email, password: request.password }),
    })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) { sendResponse({ ok: false, error: data.error || 'falha no login' }); return; }
        await applySession(data.token, data.attendant);
        sendResponse({ ok: true, attendant: data.attendant });
      })
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (request.action === "logout") {
    clearSession().then(() => sendResponse({ ok: true }));
    return true;
  }

  // ---- Ponte com o login do sistema web (ver web-bridge.js) ----
  // O content script na aba do sistema web lê o token do próprio localStorage
  // da página e avisa aqui — assim logar (ou deslogar) no sistema web já vale
  // pra extensão, sem digitar senha de novo no drawer/popup.
  if (request.action === "syncWebLogin") {
    (request.token ? applySession(request.token, request.attendant) : clearSession()).then(() => sendResponse({ ok: true }));
    return true;
  }

  if (request.action === "getAuthStatus") {
    chrome.storage.local.get(['zt_token', 'zt_attendant']).then(({ zt_token, zt_attendant }) => {
      sendResponse({ ok: true, authed: Boolean(zt_token), attendant: zt_attendant || null });
    });
    return true;
  }

  // Botão "Atualizar agora" do aviso de extensão desatualizada no sistema web
  // (ver ExtensionUpdateBanner.tsx + web-bridge.js) — reinicia a extensão
  // usando o que já está em disco. onInstalled (mais abaixo) reinjeta os
  // scripts nas abas abertas sozinho depois disso, sem precisar de F5 manual.
  if (request.action === "reloadExtension") {
    chrome.runtime.reload();
    return false;
  }

  return false;
});

// Restringe o painel lateral às abas do Crisp (habilita no Crisp, desabilita
// no resto — assim, ao trocar de aba/site, o painel some fora do Crisp).
const CRISP_RE = /^https:\/\/app\.crisp\.chat\//;
async function syncSidePanel(tabId, url) {
  try {
    if (url && CRISP_RE.test(url)) {
      await chrome.sidePanel.setOptions({ tabId, path: 'drawer.html', enabled: true });
    } else {
      await chrome.sidePanel.setOptions({ tabId, enabled: false });
    }
  } catch (e) { /* aba pode não existir mais */ }
}
chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => {
    if (chrome.runtime.lastError) return;
    syncSidePanel(tabId, tab && tab.url);
  });
});

// onActivated só dispara quando a aba ATIVA de uma janela muda — trocar de
// JANELA (ex.: Alt+Tab para uma janela do Chrome já aberta numa aba que não
// é do Crisp) não gera esse evento, porque a aba ativa daquela janela não
// mudou. Sem isto, o painel continuava aberto ao voltar pra uma janela cuja
// aba ativa é de outro site.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return; // saiu do Chrome inteiro
  chrome.tabs.query({ active: true, windowId }, (tabs) => {
    if (chrome.runtime.lastError) return;
    const tab = tabs && tabs[0];
    if (tab) syncSidePanel(tab.id, tab.url);
  });
});

// Rede de segurança: on{Activated,FocusChanged} deveriam bastar, mas na
// prática o painel ficava aberto em abas que nunca passaram por um desses
// eventos (ex.: aba que já existia e o service worker perdeu o evento
// enquanto estava suspenso). Reconfere a aba realmente ativa a cada 1s e
// corrige — mesmo padrão de "rede de segurança" já usado em crisp-ui.js.
setInterval(() => {
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
    if (chrome.runtime.lastError) return;
    const tab = tabs && tabs[0];
    if (tab) syncSidePanel(tab.id, tab.url);
  });
}, 1000);

// ============================================================
// (A) Badge por aba + reinjeção + aviso de versão
// ============================================================

chrome.runtime.onMessage.addListener((message, sender) => {
  if (!message || message.type !== "CRISP_STATUS") return;
  const tabId = sender.tab && sender.tab.id;
  if (tabId == null) return;

  if (message.detected) {
    const text = message.waitingCount > 0 ? String(message.waitingCount) : "";
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setBadgeBackgroundColor({
      tabId,
      color: message.waitingCount > 0 ? "#FFE066" : "#2ecc71"
    });
    chrome.action.setBadgeTextColor && chrome.action.setBadgeTextColor({ tabId, color: "#3a2e00" });
    chrome.action.setTitle({
      tabId,
      title: `Crisp detectado - ${message.totalRows} conversa(s) na tela, ${message.waitingCount} aguardando resposta`
    });
  } else {
    chrome.action.setBadgeText({ tabId, text: "" });
    chrome.action.setTitle({ tabId, title: "Crisp nao detectado nesta aba" });
  }
});

// onUpdated cobre duas necessidades: (1) sincronizar o painel lateral por
// URL e (2) permitir que o badge/reinjeção da lista funcionem.
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'loading' || typeof info.url === 'string') {
    syncSidePanel(tabId, tab && tab.url);
  }
});

async function reinjectIntoOpenTabs() {
  // Após instalar/atualizar, o Chrome NÃO reinjeta content scripts em abas já
  // abertas. Reinjetamos o crisp-ui (que tem auto-desligamento do script órfão)
  // + o CSS. O tenant.js é reinjetado na sequência apenas se ainda não estiver
  // ativo (guard por window.__ztTenantActive dentro do próprio arquivo evitaria
  // duplicar; como ele não tem esse guard, dependemos do recarregamento da aba
  // para o tenant — o crisp-ui volta sozinho).
  const tabs = await chrome.tabs.query({ url: ["https://app.crisp.chat/*", "https://chat.crisp.chat/*"] });
  for (const tab of tabs) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["crisp-ui.js"] });
      // tenant.js só atua em app.crisp.chat; tem auto-cura (window.__ztTenantShutdown)
      // então reinjetar por cima da instância antiga é seguro.
      if (/^https:\/\/app\.crisp\.chat\//.test(tab.url || "")) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["tenant.js"] });
      }
    } catch (e) {
      // aba protegida ou descartada - ignora
    }
  }

  // Ponte de login com o sistema web (ver web-bridge.js) — mesma lógica,
  // pra pegar o token de quem já estava logado antes desta atualização.
  const webTabs = await chrome.tabs.query({ url: ["http://192.168.0.104:5173/*", "http://localhost:5173/*"] });
  for (const tab of webTabs) {
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["web-bridge.js"] });
    } catch (e) {
      // aba protegida ou descartada - ignora
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const version = chrome.runtime.getManifest().version;
  const { crispLastVersion } = await chrome.storage.local.get("crispLastVersion");
  if (crispLastVersion && crispLastVersion !== version) {
    await chrome.storage.local.set({ crispUpdatedTo: version, crispUpdatedAt: Date.now() });
  }
  await chrome.storage.local.set({ crispLastVersion: version });
  await reinjectIntoOpenTabs();
});
