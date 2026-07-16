// background.js - service worker
// Nao faz nenhuma chamada de rede. So recebe o status de deteccao enviado
// pelo content script e atualiza o badge do icone da extensao por aba, como
// indicador visual de que o Crisp foi identificado na pagina.

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

async function reinjectIntoOpenTabs() {
  // Apos instalar/atualizar, o Chrome NAO reinjeta content scripts em abas
  // ja abertas. Fazemos isso manualmente para o usuario nao precisar de F5.
  const tabs = await chrome.tabs.query({ url: ["https://app.crisp.chat/*", "https://chat.crisp.chat/*"] });
  for (const tab of tabs) {
    try {
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ["content.css"] });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["content.js"] });
    } catch (e) {
      // aba protegida ou descartada - ignora
    }
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  const version = chrome.runtime.getManifest().version;
  const { crispLastVersion } = await chrome.storage.local.get("crispLastVersion");
  if (crispLastVersion && crispLastVersion !== version) {
    // marca a atualizacao para o popup exibir uma unica vez
    await chrome.storage.local.set({
      crispUpdatedTo: version,
      crispUpdatedAt: Date.now()
    });
  }
  await chrome.storage.local.set({ crispLastVersion: version });
  await reinjectIntoOpenTabs();
});
