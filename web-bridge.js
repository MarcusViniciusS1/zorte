// web-bridge.js — roda DENTRO da aba do sistema web (Zticket), não do Crisp.
//
// Motivo de existir: o login do sistema web fica em localStorage da própria
// página; o login da extensão fica em chrome.storage.local — são
// armazenamentos isolados, um não vê o outro por padrão. Este content script
// é a ponte: lê o token que o app React já salvou (ver frontend/src/lib/
// auth.ts) e avisa o background.js, que guarda a mesma sessão pro drawer/
// popup também usarem. Login (ou logout) no sistema web passa a valer pra
// extensão também, sem digitar senha de novo.
//
// Também é a ponte de "versão da extensão instalada" pro aviso de atualização
// do sistema web (ver ExtensionUpdateBanner.tsx): avisa via postMessage qual
// versão está rodando aqui, e escuta o pedido de "recarregar a extensão"
// vindo do botão daquele aviso.
//
// Só LÊ localStorage — nunca escreve nada na página.

// Se a extensão for recarregada com esta aba já aberta, uma nova instância
// deste script pode ser reinjetada por cima (ver reinjectIntoOpenTabs em
// background.js) — desliga a instância antiga em vez de deixar duas rodando.
if (window.__ztWebBridgeShutdown) {
  try { window.__ztWebBridgeShutdown(); } catch { /* instância antiga já morta */ }
}

const TOKEN_KEY = 'zticket:token';
const ATTENDANT_KEY = 'zticket:attendant';
const POLL_MS = 1500;

let lastSentToken;
let __ztWebBridgeInterval;
let __ztVersionInterval;
let __ztReloadRequestHandler;
window.__ztWebBridgeShutdown = function () {
  try { clearInterval(__ztWebBridgeInterval); } catch { /* já limpo */ }
  try { clearInterval(__ztVersionInterval); } catch { /* já limpo */ }
  try { if (__ztReloadRequestHandler) window.removeEventListener('message', __ztReloadRequestHandler); } catch { /* já limpo */ }
};

// Avisa a página qual versão da extensão está rodando agora — o React
// escuta isso (ExtensionUpdateBanner.tsx) e compara com a versão mais
// recente que o backend conhece (GET /api/extension/version). Repete no
// mesmo intervalo do login pra um listener que montou um pouco depois
// (ex.: F5 na página) não perder o aviso.
function broadcastVersion() {
  try {
    window.postMessage({ source: 'zt-extension', type: 'version', version: chrome.runtime.getManifest().version }, window.location.origin);
  } catch {
    // extensão recarregada — instância nova assume no próximo load
  }
}

// Botão "Atualizar agora" do aviso manda essa mensagem; repassa pro
// background.js recarregar a extensão (chrome.runtime.reload()), que já
// reinjeta os scripts sozinha nas abas abertas (ver reinjectIntoOpenTabs).
__ztReloadRequestHandler = function (e) {
  if (e.source !== window || e.origin !== window.location.origin) return;
  const d = e.data;
  if (!d || d.source !== 'zticket-web' || d.type !== 'reloadExtension') return;
  chrome.runtime.sendMessage({ action: 'reloadExtension' }).catch(() => {
    // o próprio reload já derruba esse canal de mensagem no meio do caminho — esperado.
  });
};
window.addEventListener('message', __ztReloadRequestHandler);

function readWebSession() {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const attendantRaw = localStorage.getItem(ATTENDANT_KEY);
    return { token, attendant: attendantRaw ? JSON.parse(attendantRaw) : null };
  } catch {
    return { token: null, attendant: null };
  }
}

async function syncOnce() {
  const { token, attendant } = readWebSession();
  if (token === lastSentToken) return; // nada mudou desde a última checagem
  lastSentToken = token;
  try {
    await chrome.runtime.sendMessage({ action: 'syncWebLogin', token, attendant });
  } catch {
    // extensão recarregada — a própria injeção deste content script já foi
    // renovada num load futuro da página, não precisa de auto-cura aqui.
  }
}

syncOnce();
__ztWebBridgeInterval = setInterval(syncOnce, POLL_MS);

broadcastVersion();
__ztVersionInterval = setInterval(broadcastVersion, POLL_MS);
