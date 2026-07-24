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

const API_BASE = 'http://localhost:3001/api/empresas';
const API_ROOT = 'http://localhost:3001/api';

async function apiGet(path) {
  try {
    const res = await fetch(`${API_ROOT}${path}`);
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}
async function apiPost(path, body) {
  try {
    const res = await fetch(`${API_ROOT}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, data };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (!request || !request.action) return false;

  // Abre o painel lateral na aba de onde veio o clique (sempre uma aba do
  // Crisp). open() precisa rodar dentro do gesto do usuário: nada de await antes.
  if (request.action === "openSidePanel") {
    const tabId = sender && sender.tab && sender.tab.id;
    if (tabId == null) { sendResponse({ ok: false, error: 'sem aba' }); return true; }
    chrome.sidePanel.setOptions({ tabId, path: 'drawer.html', enabled: true });
    chrome.sidePanel.open({ tabId })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
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
        sendResponse({ ok: true, found: !!(r && r.found), data: r && r.data, extra: (r && r.extra) || {} });
      });
    });
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

  if (request.action === "createTicket") {
    apiPost('/tickets', request.ticket).then(sendResponse);
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
    fetch(`${API_BASE}/validar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ candidates })
    })
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => {
        if (data && data.found) {
          sendResponse({ success: true, data: data.data });
        } else {
          sendResponse({ success: false, reason: "NOT_FOUND" });
        }
      })
      .catch(error => {
        sendResponse({ success: false, reason: "API_ERROR", message: error.message });
      });
    return true;
  }

  if (request.action === "testConnection") {
    fetch(`${API_BASE}?limit=1`)
      .then(response => {
        if (response.ok) sendResponse({ success: true });
        else throw new Error(`Erro HTTP: ${response.status}`);
      })
      .catch(error => {
        sendResponse({ success: false, message: error.message });
      });
    return true;
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
