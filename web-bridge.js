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
window.__ztWebBridgeShutdown = function () {
  try { clearInterval(__ztWebBridgeInterval); } catch { /* já limpo */ }
};

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
