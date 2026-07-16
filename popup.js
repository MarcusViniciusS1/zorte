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
  saveStatus: document.getElementById("saveStatus")
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
  els.saveStatus.style.color = "#1c7c3a";
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
      let text = `Crisp detectado - ${response.totalRows} conversa(s) na tela, ${response.waitingCount} aguardando resposta do cliente.`;
      if (response.unparsedTimeTexts && response.unparsedTimeTexts.length) {
        text += ` ATENCAO - formatos de horario nao reconhecidos: ${response.unparsedTimeTexts.join(", ")}. Envie esses textos para o desenvolvedor.`;
      }
      els.status.textContent = text;
      els.status.className = "status ok";
    } else {
      els.status.textContent = "Crisp aberto, mas nenhuma conversa foi identificada ainda. Aguarde a lista carregar.";
      els.status.className = "status off";
    }
  } catch (e) {
    els.status.textContent = "Nao foi possivel confirmar a deteccao (recarregue a aba do Crisp).";
    els.status.className = "status off";
  }
}

els.save.addEventListener("click", saveSettings);

document.getElementById("reload").addEventListener("click", () => {
  // Rele os arquivos da pasta da extensao (equivale ao botao "Atualizar"
  // do chrome://extensions). Util apos um "git pull" na pasta.
  chrome.runtime.reload();
});

async function showVersionInfo() {
  const version = chrome.runtime.getManifest().version;
  const versionEl = document.getElementById("version");
  if (versionEl) versionEl.textContent = "v" + version;

  const { crispUpdatedTo, crispUpdatedAt } = await chrome.storage.local.get(["crispUpdatedTo", "crispUpdatedAt"]);
  if (crispUpdatedTo && crispUpdatedAt && Date.now() - crispUpdatedAt < 10 * 60 * 1000) {
    els.saveStatus.textContent = "Atualizado para a versao " + crispUpdatedTo + " \u2714";
    els.saveStatus.style.color = "#1c7c3a";
    await chrome.storage.local.remove(["crispUpdatedTo", "crispUpdatedAt"]);
  }
}

loadSettings();
checkStatus();
showVersionInfo();
