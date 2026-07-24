// popup.js — unificado.
//  - Configurações das etiquetas do Crisp (nome do operador + cores).
//  - Status de detecção do Crisp na aba atual.
//  - Testar conexão com o banco + Atualizar extensão.
// (O "Validar Atendimento" foi removido daqui — agora fica dentro do painel
//  lateral / drawer.)

const DEFAULTS = {
  waitingColor: "#FFC107",
  answeredColor: "#2ecc71",
  myDisplayName: "",
  myMatchToken: ""
};

const OPERATOR_MATCH_TOKENS = {
  "Marcus M": "Marcus",
  "Artur R": "Artur",
  "Nilo": "João",
  "Arthur F": "Arthur",
  "Felipe": "Felipe"
};

const els = {
  status: document.getElementById("status"),
  whoAmI: document.getElementById("whoAmI"),
  waitingColor: document.getElementById("waitingColor"),
  answeredColor: document.getElementById("answeredColor"),
  save: document.getElementById("save"),
  saveStatus: document.getElementById("saveStatus"),
  btnTestConn: document.getElementById("btn-test-conn"),
  testContainer: document.getElementById("test-container"),
  testMessage: document.getElementById("test-message")
};

async function loadSettings() {
  const data = await chrome.storage.sync.get(DEFAULTS);
  els.whoAmI.value = data.myDisplayName || "";
  els.waitingColor.value = data.waitingColor;
  els.answeredColor.value = data.answeredColor;
}

async function saveSettings() {
  const myDisplayName = els.whoAmI.value;
  const myMatchToken = myDisplayName ? (OPERATOR_MATCH_TOKENS[myDisplayName] || myDisplayName.split(" ")[0]) : "";
  const payload = {
    myDisplayName,
    myMatchToken,
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

loadSettings();
checkStatus();
showVersionInfo();
