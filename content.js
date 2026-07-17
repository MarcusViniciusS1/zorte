// content.js - injetado em app.crisp.chat / chat.crisp.chat
// 1) Recolore o circulo de acao de cada linha: cor personalizavel quando o
//    cliente ainda esta sem retorno do suporte, verde quando o suporte ja
//    respondeu.
// 2) Quando a conversa esta atribuida ao operador selecionado no popup,
//    esconde o texto nativo do Crisp (".c-conversation-menu-item-headline__assignee")
//    e insere no lugar uma etiqueta azul clarinha "🤚🏻 Nome".
// 3) Mostra quantas horas faltam (ou um X vermelho se ja expirou) da
//    janela de 24h para responder.
//
// Deteccao de "cliente sem retorno" usa a classe real do Crisp
// (c-conversation-menu-item-headline__waiting-since), confirmada via
// DevTools - o Crisp so renderiza esse elemento quando a conversa esta
// mesmo aguardando resposta, com um tooltip "Aguardando desde: Xh" e um
// span com esse mesmo valor. Isso e muito mais confiavel do que tentar
// adivinhar por icones/setas no texto.

// Evita rodar duas vezes no mesmo "mundo" (ex: manifest + reinjecao)
if (window.__crispTagActive) {
  throw new Error("crisp-tag ja ativo neste contexto");
}
window.__crispTagActive = true;

const DEFAULTS = {
  waitingColor: "#FFC107",
  answeredColor: "#2ecc71",
  myDisplayName: "",
  myMatchToken: ""
};

let settings = { ...DEFAULTS };

const HAND_EMOJI = "\u{1F6A8}"; // 🚨 (sirene - conversa atribuida a voce)
// Seletores reais do Crisp (confirmados no HTML da pagina fornecido pelo
// usuario) - cada conversa da lista e um .c-conversation-menu-item-root
// com data-session-id.
const ROW_SELECTOR = ".c-conversation-menu-item-root";
const ASSIGNEE_SELECTOR = ".c-conversation-menu-item-headline__assignee";
const WAITING_SINCE_SELECTOR = ".c-conversation-menu-item-headline__waiting-since";
const WAITING_SINCE_DATE_SELECTOR = ".c-conversation-menu-item-headline__waiting-since-date";
// Quando a lista esta ordenada por "Mais Recentes", o Crisp mostra o tempo
// de atualizacao (sem relogio) em vez do bloco "aguardando desde":
const UPDATED_AT_SELECTOR = ".c-conversation-menu-item-headline__updated-at";

// Caracteres invisiveis que o Crisp usa para preencher o texto truncado
// (soft hyphen, zero-width space/joiner, Braille pattern blank, BOM).
const INVISIBLE_CHARS_RE = /[­​‌‍⠀﻿]/g;

const WINDOW_HOURS = 24;
const URGENT_THRESHOLD_HOURS = 5; // contagem so aparece faltando menos de 5h

function debounce(fn, wait) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

function findConversationRows() {
  return Array.from(document.querySelectorAll(ROW_SELECTOR));
}

// "Cliente sem retorno": o bloco "aguardando desde" do Crisp aparece em
// quase toda conversa nao-resolvida (mesmo ja respondida), entao NAO serve
// como sinal de quem falou por ultimo. O sinal certo (confirmado pelo
// usuario e presente no HTML) e a setinha antes da previa da mensagem:
// .c-conversation-menu-item-context__last-message-icon so existe quando o
// SUPORTE respondeu por ultimo. Notas internas tambem nao contam como
// mensagem do cliente.
const REPLY_ICON_SELECTOR = ".c-conversation-menu-item-context__last-message-icon";
const NOTE_SELECTOR = ".c-conversation-menu-item-context__meta--note";

function isWaitingRow(row) {
  if (row.querySelector(NOTE_SELECTOR)) return false; // ultima entrada e nota interna
  if (row.querySelector(REPLY_ICON_SELECTOR)) return false; // suporte respondeu por ultimo
  return true;
}

// Circulo de estado da conversa - classe real do Crisp (confirmada no HTML
// da pagina): c-conversation-menu-item-context__state. Antes usavamos uma
// heuristica geometrica que, em algumas linhas, acabava pintando a nossa
// propria etiqueta de contagem por engano.
const STATE_CIRCLE_SELECTOR = ".c-conversation-menu-item-context__state";

function findActionCircle(row) {
  return row.querySelector(STATE_CIRCLE_SELECTOR);
}

function applyActionColor(row, waiting) {
  const circle = findActionCircle(row);
  if (!circle) return;
  const color = waiting ? settings.waitingColor : settings.answeredColor;
  circle.style.setProperty("background-color", color, "important");
  circle.style.setProperty("background", color, "important");
}

// ---------- Etiqueta "atribuido a mim" ----------

function normalizeAssigneeText(raw) {
  return (raw || "")
    .replace(INVISIBLE_CHARS_RE, "")
    .replace(/[.\s]+$/g, "")
    .trim();
}

function applyMineBadges() {
  const assigneeEls = document.querySelectorAll(ASSIGNEE_SELECTOR);

  for (const assigneeEl of assigneeEls) {
    const container = assigneeEl.parentElement || assigneeEl;
    const existingBadge = container.querySelector(":scope > .crisp-mine-badge");

    if (!settings.myMatchToken) {
      assigneeEl.style.removeProperty("display");
      if (existingBadge) existingBadge.remove();
      continue;
    }

    const token = normalizeAssigneeText(assigneeEl.textContent);
    const mine = token.toLowerCase().startsWith(settings.myMatchToken.toLowerCase());

    if (!mine) {
      assigneeEl.style.removeProperty("display");
      if (existingBadge) existingBadge.remove();
      continue;
    }

    assigneeEl.style.setProperty("display", "none", "important");
    if (existingBadge) continue;

    const badge = document.createElement("span");
    badge.className = "crisp-mine-badge";
    badge.textContent = `${HAND_EMOJI}${settings.myDisplayName}`;
    assigneeEl.insertAdjacentElement("afterend", badge);
  }
}

// ---------- Etiqueta de janela de 24h ----------
// Le o valor exato que o Crisp mostra no proprio bloco de "aguardando
// desde" (c-conversation-menu-item-headline__waiting-since-date), que so
// existe quando a conversa esta de fato sem retorno.

// Interpreta o horario relativo mostrado pelo Crisp. Suporta o Crisp em
// portugues E em ingles (o texto varia conforme o idioma da interface de
// cada operador - motivo pelo qual a contagem funcionava em uma maquina e
// nao em outra).
const RE_NOW = /^(agora|now|just now|ahora|maintenant|jetzt)$/i;
const RE_TODAY = /^(hoje|today|hoy|aujourd'hui|heute)$/i;
const RE_YESTERDAY = /^(ontem|yesterday|ayer|hier|gestern)$/i;
const RE_WEEKDAY = /^((segunda|ter[cç]a|quarta|quinta|sexta|s[aá]bado|domingo)(-feira)?|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|montag|dienstag|mittwoch|donnerstag|freitag|samstag|sonntag)$/i;
const RE_DATE = /^\d{1,2}\.?\s(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez|feb|apr|may|aug|sep|oct|nov|dec|ene|dic|f[eé]vr?|avr|juin|juil|ao[uû]t|d[eé]c|m[aä]r|okt|dez)/i;

function parseElapsedHours(rawText) {
  const t = (rawText || "").trim();

  if (RE_NOW.test(t)) return 0;

  let m = t.match(/^(\d{1,2})\s?(h|hs|hr|hrs)$/i);
  if (m) return parseInt(m[1], 10);

  m = t.match(/^(\d{1,2})\s?(min|mins|m)$/i);
  if (m) return parseInt(m[1], 10) / 60;

  if (RE_TODAY.test(t)) return WINDOW_HOURS / 2;

  if (RE_YESTERDAY.test(t)) return WINDOW_HOURS + 6;

  if (RE_WEEKDAY.test(t)) return WINDOW_HOURS + 24;

  if (RE_DATE.test(t)) return WINDOW_HOURS + 24;

  // formato desconhecido: registra para o diagnostico do popup
  if (t) {
    window.__crispTagUnparsed = window.__crispTagUnparsed || new Set();
    window.__crispTagUnparsed.add(t);
  }
  return null;
}

function applyCountdownBadge(row, waiting) {
  // Fonte do horario: bloco "aguardando desde" (ordenacao por tempo de
  // espera) OU o horario simples "atualizado ha" (ordenacao por mais
  // recentes). Nos dois casos, quando o cliente falou por ultimo, o valor
  // corresponde ao momento da ultima mensagem dele; e um valor de 24h+
  // significa janela expirada em qualquer cenario.
  let container = row.querySelector(WAITING_SINCE_SELECTOR);
  let dateEl = row.querySelector(WAITING_SINCE_DATE_SELECTOR);
  if (!container || !dateEl) {
    const updatedEl = row.querySelector(UPDATED_AT_SELECTOR);
    if (updatedEl) {
      container = updatedEl;
      dateEl = updatedEl;
    }
  }
  const existing = row.querySelector(".crisp-countdown-badge");

  if (!container || !dateEl) {
    if (existing) existing.remove();
    return;
  }

  const elapsed = parseElapsedHours(dateEl.textContent);
  if (elapsed === null) {
    if (existing) existing.remove();
    return;
  }

  const remaining = WINDOW_HOURS - elapsed;

  // Regras:
  // - X vermelho: conversa parada ha 24h+ (independente de quem falou por
  //   ultimo - se a ultima atividade tem mais de 24h, a ultima mensagem do
  //   cliente e mais antiga ainda, entao a janela com certeza expirou).
  // - Contagem "Xh": so quando o cliente esta aguardando E falta menos de
  //   5h. Com folga (ou conversa ja respondida e dentro do prazo), nada
  //   aparece.
  const expired = remaining <= 0;
  const urgent = waiting && remaining > 0 && remaining < URGENT_THRESHOLD_HOURS;

  if (!expired && !urgent) {
    if (existing) existing.remove();
    return;
  }

  let badge = existing;
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "crisp-countdown-badge";
    container.insertAdjacentElement("afterend", badge);
  }

  badge.classList.remove("crisp-countdown-ok", "crisp-countdown-warn", "crisp-countdown-expired");
  badge.removeAttribute("title");
  // remove qualquer cor inline gravada por engano em versoes anteriores
  badge.style.removeProperty("background");
  badge.style.removeProperty("background-color");

  if (remaining <= 0) {
    badge.textContent = "✕";
    badge.title = "Janela de 24h para responder ja expirou";
    badge.classList.add("crisp-countdown-expired");
  } else {
    const hoursLeft = Math.max(1, Math.round(remaining));
    badge.textContent = `${hoursLeft}h`;
    badge.title = `${hoursLeft}h restantes da janela de 24h para responder`;
    badge.classList.add("crisp-countdown-warn");
  }
}

// ---------- Barra de resumo (topo da lista) ----------

function isMineRow(row) {
  if (!settings.myMatchToken) return false;
  const assigneeEl = row.querySelector(ASSIGNEE_SELECTOR);
  if (!assigneeEl) return false;
  const token = normalizeAssigneeText(assigneeEl.textContent);
  return token.toLowerCase().startsWith(settings.myMatchToken.toLowerCase());
}

function updateSummaryBar(total, mine, waiting) {
  const listEl = document.querySelector(".c-conversation-menu__conversations");
  let bar = document.getElementById("crisp-summary-bar");

  if (!listEl) {
    if (bar) bar.remove();
    return;
  }

  if (!bar) {
    bar = document.createElement("div");
    bar.id = "crisp-summary-bar";
    listEl.parentElement.insertBefore(bar, listEl);
  }

  bar.innerHTML = "";

  const items = [
    { label: "Total", value: total, cls: "crisp-summary-total", tip: "Total de conversas na lista" },
    { label: HAND_EMOJI + " Minhas", value: mine, cls: "crisp-summary-mine", tip: "Conversas atribuidas a voce" },
    { label: "Aguardando", value: waiting, cls: "crisp-summary-waiting", tip: "Conversas aguardando retorno do suporte" }
  ];

  for (const item of items) {
    const chip = document.createElement("span");
    chip.className = "crisp-summary-chip " + item.cls;
    chip.title = item.tip;
    chip.textContent = item.label + ": " + item.value;
    bar.appendChild(chip);
  }
}

// ---------- Bloqueio de finalizacao com atendente atribuido ----------
// Ao clicar no circulo de estado para finalizar uma conversa NAO resolvida
// que tem atendente atribuido, a extensao segura o clique e mostra um aviso
// pedindo para remover a atribuicao primeiro. Conversas sem atendente (ou
// ja resolvidas, quando o clique reabre) passam normalmente.

function getRowAssigneeName(row) {
  const el = row.querySelector(ASSIGNEE_SELECTOR);
  if (!el) return null;
  const name = normalizeAssigneeText(el.textContent);
  return name || null;
}

function closeResolveBlockModal() {
  const el = document.getElementById("crisp-resolve-block");
  if (el) el.remove();
}

function showResolveBlockModal(name) {
  closeResolveBlockModal();

  const overlay = document.createElement("div");
  overlay.id = "crisp-resolve-block";

  const box = document.createElement("div");
  box.className = "crisp-resolve-block__box";

  const title = document.createElement("h3");
  title.textContent = "Conversa com atendente atribuido";

  const msg = document.createElement("p");
  msg.appendChild(document.createTextNode("Esta conversa esta atribuida a "));
  const strong = document.createElement("strong");
  strong.textContent = name;
  msg.appendChild(strong);
  msg.appendChild(document.createTextNode("."));

  const msg2 = document.createElement("p");
  msg2.textContent = "Remova a atribuicao do atendente para poder finaliza-la.";

  const btn = document.createElement("button");
  btn.textContent = "Entendi";
  btn.addEventListener("click", closeResolveBlockModal);

  box.appendChild(title);
  box.appendChild(msg);
  box.appendChild(msg2);
  box.appendChild(btn);
  overlay.appendChild(box);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeResolveBlockModal();
  });

  document.body.appendChild(overlay);
}

// Existem DOIS controles de finalizar conversa no Crisp:
// 1) o circulo de estado na linha da lista (STATE_CIRCLE_SELECTOR)
// 2) o botao "Nao resolvida"/"Resolver" no topo da conversa aberta
//    (.c-conversation-box-topbar__state-button) - foi por esse segundo que
//    o bloqueio escapou na v4.0.4, pois so cobriamos o primeiro.
// O Crisp tambem pode executar a acao em mousedown/pointerdown (nao so no
// click), entao interceptamos a cadeia inteira de eventos do mouse em fase
// de captura.
const TOPBAR_STATE_BUTTON_SELECTOR = ".c-conversation-box-topbar__state-button";

function getActiveConversationRow() {
  // A linha da conversa aberta no momento fica marcada como "--active" na
  // lista lateral.
  return document.querySelector(ROW_SELECTOR + " a.c-conversation-menu-item--active")
    ?.closest(ROW_SELECTOR) || null;
}

function getOpenConversationAssigneeName() {
  const row = getActiveConversationRow();
  if (row) {
    const name = getRowAssigneeName(row);
    if (name) return name;
  }
  return null;
}

function handleResolveAttempt(ev) {
  if (!ev.target || !ev.target.closest) return;

  // Caso 1: circulo de estado na lista
  const circle = ev.target.closest(STATE_CIRCLE_SELECTOR);
  if (circle) {
    const row = circle.closest(ROW_SELECTOR);
    if (!row) return;
    const anchor = row.querySelector("a.c-conversation-menu-item");
    const isUnresolved = !!(anchor && anchor.className.indexOf("--unresolved") !== -1);
    if (!isUnresolved) return;
    const name = getRowAssigneeName(row);
    if (!name) return;
    blockAndWarn(ev, name);
    return;
  }

  // Caso 2: botao "Nao resolvida" no topo da conversa aberta - so bloqueia
  // quando o botao esta no estado vermelho (nao resolvida -> clicar
  // finalizaria). Quando a conversa ja esta resolvida, o botao fica verde
  // e o clique reabre, o que nunca deve ser bloqueado.
  const topbarBtn = ev.target.closest(TOPBAR_STATE_BUTTON_SELECTOR);
  if (topbarBtn) {
    const isRed = topbarBtn.className.indexOf("c-base-button--red") !== -1;
    if (!isRed) return;
    const name = getOpenConversationAssigneeName();
    if (!name) return;
    blockAndWarn(ev, name);
    return;
  }
}

function blockAndWarn(ev, name) {
  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation();
  if (!document.getElementById("crisp-resolve-block")) {
    showResolveBlockModal(name);
  }
}

for (const evType of ["pointerdown", "mousedown", "mouseup", "click", "touchstart"]) {
  document.addEventListener(evType, handleResolveAttempt, true);
}

// ---------- Etiqueta de empresa (segmento) + botao de copiar ----------
// O Crisp guarda a "empresa" como um segmento/tag (.c-base-tag__label) e ja
// atribui uma cor consistente por nome. So deixamos mais destacada (borda
// na propria cor do segmento + icone) e, fora da lista (conversa aberta),
// adicionamos um botao para copiar o nome. A personalizacao por clique foi
// removida a pedido do usuario (ficou confusa/quebrou o layout).
//
// IMPORTANTE (bug corrigido na v4.0.9): ".c-base-tag__label" e uma classe
// GENERICA usada pelo Crisp em varios lugares (inclusive dentro da caixa de
// resposta/editor de mensagem), nao so nas etiquetas de empresa. Usar esse
// seletor sozinho fazia o botao de copiar aparecer em lugares errados e,
// como o navegador reexecuta o loop periodicamente, ate duplicar botoes.
// Agora so procuramos labels DENTRO dos dois containers reais confirmados:
// - Lista:           .c-conversation-menu-item-context__segments
// - Conversa aberta: .c-conversation-profile-widget-segments (bloco
//   "Segmentos de conversa" na barra lateral direita)
const LIST_SEGMENTS_WRAPPER_SELECTOR = ".c-conversation-menu-item-context__segments";
const CHAT_SEGMENTS_WRAPPER_SELECTOR = ".c-conversation-profile-widget-segments";
const SEGMENT_LABEL_SELECTOR =
  LIST_SEGMENTS_WRAPPER_SELECTOR + " .c-base-tag__label, " +
  CHAT_SEGMENTS_WRAPPER_SELECTOR + " .c-base-tag__label";

function isInsideListRow(el) {
  return !!el.closest(LIST_SEGMENTS_WRAPPER_SELECTOR);
}

// Icones fixos em SVG (nao dependem de fonte de emoji do sistema - em
// alguns Windows o emoji de prancheta/copiar renderiza como um icone de
// documento generico em preto e branco, entao usamos SVG proprio).
const COPY_ICON_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const CHECK_ICON_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>';

async function copyCompanyName(name, btn) {
  try {
    await navigator.clipboard.writeText(name);
  } catch (e) {
    // fallback para paginas sem foco/permissao de clipboard
    const ta = document.createElement("textarea");
    ta.value = name;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e2) {}
    ta.remove();
  }
  btn.innerHTML = CHECK_ICON_SVG;
  btn.classList.add("crisp-copy-company-btn--done");
  setTimeout(() => {
    btn.innerHTML = COPY_ICON_SVG;
    btn.classList.remove("crisp-copy-company-btn--done");
  }, 1200);
}

function enhanceSegmentTags() {
  const labels = document.querySelectorAll(SEGMENT_LABEL_SELECTOR);
  const validButtons = new Set();

  for (const label of labels) {
    const raw = (label.textContent || "").replace(INVISIBLE_CHARS_RE, "").trim();
    if (!raw) continue;

    const tagEl = label.closest(".c-base-tag");
    const inList = isInsideListRow(label);

    if (tagEl) {
      tagEl.classList.add(inList ? "crisp-company-tag--list" : "crisp-company-tag--chat");
    }

    if (inList || !tagEl) continue;

    // Fora da lista = conversa aberta: botao de copiar. Inserido como
    // IRMAO da propria etiqueta (.c-base-tag), fora do wrapper interno, para
    // nao disputar espaco com o "x" nativo de remover segmento (que aparece
    // por cima ao passar o mouse quando o botao fica dentro da etiqueta).
    let btn = tagEl.nextElementSibling && tagEl.nextElementSibling.classList.contains("crisp-copy-company-btn")
      ? tagEl.nextElementSibling
      : null;
    if (!btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "crisp-copy-company-btn";
      btn.innerHTML = COPY_ICON_SVG;
      btn.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        copyCompanyName(btn.dataset.copyValue || raw, btn);
      });
      tagEl.insertAdjacentElement("afterend", btn);
    }
    btn.dataset.copyValue = raw;
    btn.title = "Copiar \"" + raw + "\"";
    validButtons.add(btn);
  }

  // Limpeza: remove qualquer botao de copiar duplicado ou que tenha parado
  // em lugar errado (ex: dentro da caixa de resposta) - seja por bug de uma
  // versao anterior, seja por sobra de reexecucoes do loop.
  document.querySelectorAll(".crisp-copy-company-btn").forEach((btn) => {
    if (!validButtons.has(btn)) btn.remove();
  });

  // Remove tambem qualquer classe de destaque que tenha ficado presa em
  // etiquetas fora dos dois lugares certos.
  document.querySelectorAll(".crisp-company-tag--list, .crisp-company-tag--chat").forEach((tagEl) => {
    const insideList = !!tagEl.closest(LIST_SEGMENTS_WRAPPER_SELECTOR);
    const insideChat = !!tagEl.closest(CHAT_SEGMENTS_WRAPPER_SELECTOR);
    if (!insideList && !insideChat) {
      tagEl.classList.remove("crisp-company-tag--list", "crisp-company-tag--chat");
    }
  });
}

// ---------- Loop principal ----------

function shutdownSelf() {
  // Extensao foi recarregada/atualizada: este script virou orfao. Para de
  // rodar para dar lugar ao script novo (reinjetado pelo background).
  try { observer.disconnect(); } catch (e) {}
  try { clearInterval(window.__crispTagInterval); } catch (e) {}
  window.__crispTagActive = false;
}

function applyAll() {
  if (!extensionAlive()) {
    shutdownSelf();
    return;
  }
  const rows = findConversationRows();
  let waitingCount = 0;
  let mineCount = 0;

  for (const row of rows) {
    const waiting = isWaitingRow(row);
    if (waiting) waitingCount++;
    if (isMineRow(row)) mineCount++;
    applyActionColor(row, waiting);
    applyCountdownBadge(row, waiting);
  }

  applyMineBadges();
  enhanceSegmentTags();
  updateSummaryBar(rows.length, mineCount, waitingCount);

  reportStatus(rows.length, waitingCount);
}

function extensionAlive() {
  // Quando a extensao e recarregada/atualizada, o content script antigo
  // continua vivo na aba, mas chrome.runtime deixa de existir - qualquer
  // chamada gera "Extension context invalidated". Este guard evita isso.
  try {
    return !!(chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

function reportStatus(totalRows, waitingCount) {
  const detected = totalRows > 0;
  if (extensionAlive()) {
    try {
      chrome.runtime.sendMessage({
        type: "CRISP_STATUS",
        detected,
        totalRows,
        waitingCount
      }).catch(() => {});
    } catch (e) {
      // contexto invalidado entre o check e a chamada - ignora
    }
  }
  window.__crispTagLastStatus = { detected, totalRows, waitingCount, updatedAt: Date.now() };
}

// ---------- Bootstrap ----------

async function loadSettings() {
  if (!extensionAlive()) return;
  try {
    const stored = await chrome.storage.sync.get(DEFAULTS);
    settings = { ...DEFAULTS, ...stored };
  } catch (e) {
    // contexto invalidado - mantem configuracoes atuais em memoria
  }
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  loadSettings().then(applyAll);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message && message.type === "CRISP_GET_STATUS") {
    const status = window.__crispTagLastStatus || { detected: false, totalRows: 0, waitingCount: 0 };
    status.unparsedTimeTexts = Array.from(window.__crispTagUnparsed || []);
    status.version = (extensionAlive() && chrome.runtime.getManifest().version) || "?";
    sendResponse(status);
  }
});

const debouncedApply = debounce(applyAll, 700);
const observer = new MutationObserver(debouncedApply);
observer.observe(document.body, { childList: true, subtree: true, characterData: true });

loadSettings().then(applyAll);
window.__crispTagInterval = setInterval(applyAll, 15000); // rede de seguranca, caso o MutationObserver perca alguma atualizacao
