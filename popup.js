// popup.js — unificado.
//  - Configurações das etiquetas do Crisp (nome do operador + cores).
//  - Status de detecção do Crisp na aba atual.
//  - Testar conexão com o banco + Atualizar extensão.
// (O "Validar Atendimento" foi removido daqui — agora fica dentro do painel
//  lateral / drawer.)

// myDisplayName/myMatchToken (usados pelo crisp-ui.js pra etiqueta "🚨 Nome")
// não são mais escolhidos aqui — background.js grava eles automaticamente
// a partir de quem loga (ver ação "login").
const DEFAULTS = {
  waitingColor: "#FFC107",
  answeredColor: "#2ecc71",
};

const els = {
  status: document.getElementById("status"),
  waitingColor: document.getElementById("waitingColor"),
  answeredColor: document.getElementById("answeredColor"),
  save: document.getElementById("save"),
  saveStatus: document.getElementById("saveStatus"),
  btnTestConn: document.getElementById("btn-test-conn"),
  testContainer: document.getElementById("test-container"),
  testMessage: document.getElementById("test-message"),
  loginSection: document.getElementById("loginSection"),
  loginEmail: document.getElementById("loginEmail"),
  loginPassword: document.getElementById("loginPassword"),
  loginError: document.getElementById("loginError"),
  loginSubmit: document.getElementById("loginSubmit"),
  loggedBar: document.getElementById("loggedBar"),
  loggedName: document.getElementById("loggedName"),
  logoutLink: document.getElementById("logoutLink"),
  popupContent: document.getElementById("popupContent"),
};

// ---- Login (obrigatório) ----
// Mesmo token que o painel lateral usa (chrome.storage.local, centralizado
// em background.js) — loga uma vez em qualquer um dos dois, vale pro outro.
function send(action, extra) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...(extra || {}) }, (r) => resolve(r || { ok: false }));
  });
}

async function refreshAuthUi() {
  const r = await send("getAuthStatus");
  const authed = Boolean(r && r.ok && r.authed);
  els.loginSection.classList.toggle("hidden", authed);
  els.loggedBar.classList.toggle("hidden", !authed);
  els.popupContent.classList.toggle("hidden", !authed);
  if (authed && r.attendant) els.loggedName.textContent = r.attendant.name || r.attendant.email || "";
  return authed;
}

els.loginSubmit.addEventListener("click", async () => {
  const email = els.loginEmail.value.trim();
  const password = els.loginPassword.value;
  if (!email || !password) return;
  els.loginSubmit.disabled = true;
  els.loginSubmit.textContent = "Entrando...";
  const r = await send("login", { email, password });
  els.loginSubmit.disabled = false;
  els.loginSubmit.textContent = "Entrar";
  if (!r || !r.ok) {
    els.loginError.textContent = (r && r.error) || "Falha no login.";
    return;
  }
  els.loginError.textContent = "";
  await refreshAuthUi();
  loadSettings();
  checkStatus();
});

els.logoutLink.addEventListener("click", async () => {
  await send("logout");
  await refreshAuthUi();
});

async function loadSettings() {
  const data = await chrome.storage.sync.get(DEFAULTS);
  els.waitingColor.value = data.waitingColor;
  els.answeredColor.value = data.answeredColor;
}

async function saveSettings() {
  const payload = {
    waitingColor: els.waitingColor.value || DEFAULTS.waitingColor,
    answeredColor: els.answeredColor.value || DEFAULTS.answeredColor
  };
  await chrome.storage.sync.set(payload);
  els.saveStatus.textContent = "Salvo.";
  els.saveStatus.style.color = "#146c33";
  setTimeout(() => (els.saveStatus.textContent = ""), 2000);
}

async function checkStatus() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/(app|chat)\.crisp\.chat\//.test(tab.url || "")) {
      els.status.textContent = "Abra o painel do Crisp (app.crisp.chat) para ver o status.";
      els.status.className = "status off";
      return;
    }
    const response = await chrome.tabs.sendMessage(tab.id, { type: "CRISP_GET_STATUS" });
    if (response && response.detected) {
      let text = `Crisp detectado — ${response.totalRows} conversa(s) na tela, ${response.waitingCount} aguardando resposta do cliente.`;
      if (response.unparsedTimeTexts && response.unparsedTimeTexts.length) {
        text += ` ATENÇÃO — formatos de horário não reconhecidos: ${response.unparsedTimeTexts.join(", ")}.`;
      }
      els.status.textContent = text;
      els.status.className = "status ok";
    } else {
      els.status.textContent = "Crisp aberto, mas nenhuma conversa foi identificada ainda. Aguarde a lista carregar.";
      els.status.className = "status off";
    }
  } catch (e) {
    els.status.textContent = "Não foi possível confirmar a detecção (recarregue a aba do Crisp).";
    els.status.className = "status off";
  }
}

// Testar conexão com o banco (via backend local).
els.btnTestConn.addEventListener("click", () => {
  els.testContainer.classList.remove("hidden");
  els.testMessage.textContent = "Testando conexão...";
  els.testMessage.className = "message";
  els.btnTestConn.disabled = true;
  chrome.runtime.sendMessage({ action: "testConnection" }, (response) => {
    els.btnTestConn.disabled = false;
    if (response && response.success) {
      els.testMessage.textContent = "✅ Banco conectado e respondendo!";
      els.testMessage.className = "message success-msg";
    } else {
      els.testMessage.textContent = "❌ Falha na conexão: verifique se o backend está rodando.";
      els.testMessage.className = "message error-msg";
    }
  });
});

els.save.addEventListener("click", saveSettings);

document.getElementById("reload").addEventListener("click", () => {
  // Recarrega os arquivos da pasta da extensão (equivale ao "Atualizar" do
  // chrome://extensions). Útil após um "git pull".
  chrome.runtime.reload();
});

async function showVersionInfo() {
  const version = chrome.runtime.getManifest().version;
  const versionEl = document.getElementById("version");
  if (versionEl) versionEl.textContent = "v" + version;

  const { crispUpdatedTo, crispUpdatedAt } = await chrome.storage.local.get(["crispUpdatedTo", "crispUpdatedAt"]);
  if (crispUpdatedTo && crispUpdatedAt && Date.now() - crispUpdatedAt < 10 * 60 * 1000) {
    els.saveStatus.textContent = "Atualizado para a versão " + crispUpdatedTo + " ✔";
    els.saveStatus.style.color = "#146c33";
    await chrome.storage.local.remove(["crispUpdatedTo", "crispUpdatedAt"]);
  }
}

refreshAuthUi();
loadSettings();
checkStatus();
showVersionInfo();
