// Lógica do drawer de registro — roda como página do Side Panel (painel lateral
// do navegador). Não enxerga o DOM do Crisp; obtém o contexto da conversa e
// grava o ticket através do service worker (background.js), que aponta para
// http://localhost:3001 e conversa com o content script da aba ativa.

const $ = (id) => document.getElementById(id);

// Este drawer roda em dois contextos: painel lateral nativo (top-level) OU
// dentro de um iframe injetado na página do Crisp (fallback). Fechar/concluir
// precisa agir conforme o caso.
const EMBEDDED = window.self !== window.top;
function dismiss(type, extra) {
  // Avisa o background que o painel NATIVO fechou (ver "drawerOpen" em
  // background.js) — é o que permite o atalho Ctrl+\ saber se deve abrir ou
  // fechar. O fallback embutido (iframe) não entra nessa contagem: quem
  // controla ele é o próprio tenant.js (ztDrawerWrap), sem envolver o
  // background.
  if (!EMBEDDED) {
    try { chrome.runtime.sendMessage({ action: 'drawerClosed' }).catch(() => {}); } catch (e) {}
  }
  if (EMBEDDED) {
    try { window.parent.postMessage({ source: 'zt-drawer', type: type || 'close', ...(extra || {}) }, '*'); } catch (e) {}
  } else {
    window.close();
  }
}
if (!EMBEDDED) {
  try { chrome.runtime.sendMessage({ action: 'drawerOpened' }).catch(() => {}); } catch (e) {}
}

// ---- Fecha sozinho se a aba ativa deixar de ser o Crisp ----
// chrome.sidePanel.setOptions({enabled:false}) (ver background.js) não força
// o fechamento de um painel que já está aberto — na prática, testado ao
// vivo, o painel simplesmente ficava aberto pra sempre em qualquer outra
// aba. Como o painel É uma página de extensão como outra qualquer, ele pode
// se fechar sozinho (window.close()) assim que perceber que a aba ativa não
// é mais uma conversa do Crisp — isso sim fecha de verdade.
const CRISP_RE = /^https:\/\/app\.crisp\.chat\//;
function isCrispUrl(url) {
  return typeof url === 'string' && CRISP_RE.test(url);
}
async function closeIfTabIsNotCrisp() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs && tabs[0];
    if (!tab || !isCrispUrl(tab.url)) dismiss('close');
  } catch (e) { /* extensão recarregada — ignora */ }
}
if (chrome.tabs && chrome.tabs.onActivated) {
  chrome.tabs.onActivated.addListener(closeIfTabIsNotCrisp);
  chrome.tabs.onUpdated.addListener((tabId, info) => { if (info.url) closeIfTabIsNotCrisp(); });
  chrome.windows.onFocusChanged.addListener((windowId) => {
    if (windowId !== chrome.windows.WINDOW_ID_NONE) closeIfTabIsNotCrisp();
  });
}
closeIfTabIsNotCrisp(); // checagem já na abertura (ex.: aberto via fallback numa aba errada)

// ---- Ponte com o background ----
function send(action, extra) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...extra }, (r) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(r || { ok: false, error: 'sem resposta' });
    });
  });
}

// ---- Login (obrigatório) ----
// Gate simples: enquanto não autenticado, mostra só o form de login e
// esconde o resto (#appContent) — o resto do arquivo continua carregando
// normalmente por baixo (getTags/getAttendants etc.), só não fica visível
// nem alcançável até logar. Após logar com sucesso, recarrega a página pra
// tudo (inclusive os listeners de baixo) rodar já com o token disponível.
send('getAuthStatus', {}).then((r) => {
  const authed = Boolean(r && r.ok && r.authed);
  $('loginGate').style.display = authed ? 'none' : 'flex';
  $('appContent').style.display = authed ? 'flex' : 'none';
  // modeSwitch mora no <header> (fica visível em qualquer tela) mas só faz
  // sentido depois de logado — mesma regra do appContent.
  $('modeSwitch').style.display = authed ? 'flex' : 'none';
});

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('loginEmail').value.trim();
  const password = $('loginPassword').value;
  if (!email || !password) return;
  const btn = $('loginSubmit');
  btn.disabled = true;
  btn.textContent = 'Entrando...';
  const r = await send('login', { email, password });
  btn.disabled = false;
  btn.textContent = 'Entrar';
  if (!r || !r.ok) {
    const err = $('loginError');
    err.textContent = (r && r.error) || 'Falha no login.';
    err.style.display = 'block';
    return;
  }
  window.location.reload();
});

const logoutBtn = $('logout');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await send('logout', {});
    window.location.reload();
  });
}

// ---- Alternar entre "Criar ticket" e "Consultar ticket" ----
const STATUS_LABELS = { novo: 'Novo', assumido: 'Assumido', em_andamento: 'Em Andamento', aguardando: 'Aguardando', resolvido: 'Resolvido', fechado: 'Fechado' };
const STATUS_COLORS = { novo: '#60a5fa', assumido: '#22d3ee', em_andamento: '#fbbf24', aguardando: '#c084fc', resolvido: '#34d399', fechado: '#9ca3af' };
const PRIORITY_LABELS = { baixa: 'Baixa', media: 'Média', alta: 'Alta', urgente: 'Urgente' };
const PRIORITY_COLORS = { baixa: '#9ca3af', media: '#60a5fa', alta: '#fbbf24', urgente: '#f87171' };
// Maior prioridade primeiro na listagem (urgente = "crítica" no vocabulário
// do pedido — o sistema não tem um 5º nível separado, urgente já é o topo).
const PRIORITY_ORDER = { urgente: 0, alta: 1, media: 2, baixa: 3 };
const CLOSED_STATUSES = new Set(['resolvido', 'fechado']);
const CHANNEL_LABELS = { telefone: 'Telefone', email: 'E-mail', chat: 'Chat', whatsapp: 'WhatsApp', presencial: 'Presencial', api: 'API' };

let ticketsLoaded = false;
let openTickets = []; // último resultado carregado do backend, antes de busca/filtro
let mineOnly = false;
let myAttendantId = null;
chrome.storage.local.get({ zt_attendant: null }).then(({ zt_attendant }) => {
  myAttendantId = (zt_attendant && zt_attendant.id) || null;
});

// Tickets com comentário novo ainda não visto (ver tenant.js, que escreve
// nessa mesma chave ao detectar notificação nova) — cache local pra
// renderTicketRow não precisar ler o storage a cada re-render.
let unreadTicketIds = new Set();
// unreadVersion sobe a cada mutação (leitura do storage OU marcação direta
// de lido) — sem isso, um refreshUnreadTicketIds() que começou a ler o
// storage ANTES de um clique em "marcar como lido" pode terminar de ler
// DEPOIS e sobrescrever unreadTicketIds com o valor antigo (a leitura foi
// disparada antes, mas resolve depois — corrida clássica). Descartando o
// resultado de qualquer leitura cuja versão não é mais a mais recente,
// a mutação direta (mais recente por definição) sempre vence.
let unreadVersion = 0;
async function refreshUnreadTicketIds() {
  const versionBefore = unreadVersion;
  const { zt_unread_ticket_ids } = await chrome.storage.local.get({ zt_unread_ticket_ids: [] });
  if (unreadVersion !== versionBefore) return; // mudou no meio tempo — descarta, já tem algo mais novo
  unreadTicketIds = new Set(zt_unread_ticket_ids || []);
}
// Fire-and-forget: grava no storage e avisa o backend, mas quem chama não
// espera isso pra atualizar a tela (ver showTicketDetail) — a mutação em
// memória (delete + unreadVersion++) já aconteceu antes, síncrona.
async function persistTicketRead(ticketId) {
  const { zt_unread_ticket_ids } = await chrome.storage.local.get({ zt_unread_ticket_ids: [] });
  await chrome.storage.local.set({ zt_unread_ticket_ids: (zt_unread_ticket_ids || []).filter((id) => id !== ticketId) });
  chrome.runtime.sendMessage({ action: 'markTicketNotificationsRead', ticketId }).catch(() => {});
}

// Abre o detalhe de UM ticket específico direto na aba Consultar — usado ao
// clicar no toast de comentário novo (tenant.js) ou ao abrir o drawer com
// um "pendente" salvo (ver openPendingTicketIfAny). Busca no que já está
// carregado antes de bater no backend, pra não esperar sem necessidade.
async function openTicketById(ticketId) {
  setMode('consult');
  const existing = openTickets.find((t) => t.id === ticketId);
  if (existing) { showTicketDetail(existing); return; }
  const r = await send('getTicketById', { ticketId });
  const t = r && r.ok && r.data && r.data.data;
  if (t) showTicketDetail(t);
}
// Hand-off entre tenant.js (clique no toast) e o drawer: quando o painel
// nativo estava FECHADO, chrome.sidePanel.open() recarrega esta página do
// zero, então a mensagem direta (ver onMessage abaixo) já foi perdida — o
// valor salvo no storage é o que sobrevive pra esse caso.
async function openPendingTicketIfAny() {
  const { zt_pending_open_ticket } = await chrome.storage.local.get({ zt_pending_open_ticket: null });
  if (!zt_pending_open_ticket) return;
  await chrome.storage.local.remove('zt_pending_open_ticket');
  await openTicketById(zt_pending_open_ticket);
}
openPendingTicketIfAny();

function setMode(mode) {
  const consult = mode === 'consult';
  const modules = mode === 'modules';
  const contacts = mode === 'contacts';
  const history = mode === 'history';
  $('modeSwitch').classList.toggle('mode-switch--consult', consult);
  $('modeSwitch').classList.toggle('mode-switch--modules', modules);
  $('modeSwitch').classList.toggle('mode-switch--contacts', contacts);
  $('modeSwitch').classList.toggle('mode-switch--history', history);
  $('modeCreate').classList.toggle('active', mode === 'create');
  $('modeConsult').classList.toggle('active', consult);
  $('modeModules').classList.toggle('active', modules);
  $('modeContacts').classList.toggle('active', contacts);
  $('modeHistory').classList.toggle('active', history);
  $('createPanel').style.display = mode === 'create' ? 'contents' : 'none';
  $('consultPanel').style.display = consult ? 'flex' : 'none';
  $('modulesPanel').style.display = modules ? 'flex' : 'none';
  $('contactsPanel').style.display = contacts ? 'flex' : 'none';
  $('historyPanel').style.display = history ? 'flex' : 'none';
  // Sempre volta pra lista ao entrar em "Consultar" — não deixa preso numa
  // visualização compacta de um ticket de uma visita anterior.
  $('ticketDetailView').style.display = 'none';
  $('ticketsListView').style.display = 'flex';
  if (consult && !ticketsLoaded) loadOpenTickets();

  if (modules) {
    if (!modulesLoaded) loadModules();
    autoFillModuleCompany();
  }

  if (contacts) {
    // Mesma regra da lista de tickets: sempre volta pra lista ao entrar na
    // aba, nunca preso no detalhe de um contato de uma visita anterior.
    $('contactDetailView').style.display = 'none';
    $('contactsListView').style.display = 'flex';
    if (!contactsLoaded) loadContacts();
  }

  if (history) autoFillHistoryCompany();
}
$('modeCreate').addEventListener('click', () => setMode('create'));
$('modeConsult').addEventListener('click', () => setMode('consult'));
$('modeModules').addEventListener('click', () => setMode('modules'));
$('modeContacts').addEventListener('click', () => setMode('contacts'));
$('modeHistory').addEventListener('click', () => setMode('history'));

// Badges de prioridade/status/issue do Linear — usado tanto na linha da
// lista quanto no topo da visualização compacta de 1 ticket.
// Um ticket pode ter mais de uma empresa vinculada (ver TicketDetail.tsx no
// sistema web) — o embed do backend é "companies" (array), não "company".
function ticketCompanyLabel(t) {
  if (!Array.isArray(t.companies) || !t.companies.length) return '';
  return t.companies.map((c) => c.name).filter(Boolean).join(', ');
}

function buildTicketBadges(t) {
  const meta = document.createElement('div');
  meta.className = 'ticket-row__meta';

  const priority = document.createElement('span');
  priority.className = 'status-pill';
  const pColor = PRIORITY_COLORS[t.priority] || PRIORITY_COLORS.media;
  priority.style.color = pColor;
  priority.style.background = `${pColor}22`;
  priority.textContent = PRIORITY_LABELS[t.priority] || t.priority || '—';
  meta.appendChild(priority);

  const status = document.createElement('span');
  status.className = 'status-pill';
  const color = STATUS_COLORS[t.status] || STATUS_COLORS.novo;
  status.style.color = color;
  status.style.background = `${color}22`;
  status.textContent = STATUS_LABELS[t.status] || t.status || '—';
  meta.appendChild(status);

  if (Array.isArray(t.linear_issue_ids) && t.linear_issue_ids.length) {
    const issue = document.createElement('span');
    issue.className = 'linear-chip';
    issue.style.padding = '2px 8px';
    issue.textContent = t.linear_issue_ids.join(', ');
    meta.appendChild(issue);
  }

  return meta;
}

function renderTicketRow(t) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = unreadTicketIds.has(t.id) ? 'ticket-row ticket-row--unread' : 'ticket-row';
  row.style.width = '100%';
  row.style.font = 'inherit';
  row.addEventListener('click', () => showTicketDetail(t));

  const top = document.createElement('div');
  top.className = 'ticket-row__top';
  if (unreadTicketIds.has(t.id)) {
    const dot = document.createElement('span');
    dot.className = 'unread-dot';
    dot.title = 'Comentário novo, ainda não visto';
    top.appendChild(dot);
  }
  const subject = document.createElement('span');
  subject.className = 'ticket-row__subject';
  subject.textContent = t.subject || '(sem assunto)';
  const number = document.createElement('span');
  number.className = 'ticket-row__number';
  number.textContent = t.ticket_number ? `#${t.ticket_number}` : '';
  top.appendChild(subject);
  top.appendChild(number);

  const meta = buildTicketBadges(t);
  const companyLabel = ticketCompanyLabel(t);
  if (companyLabel) {
    const company = document.createElement('span');
    company.textContent = companyLabel;
    meta.appendChild(company);
  }
  if (t.attendant && t.attendant.name) {
    const attendant = document.createElement('span');
    attendant.textContent = t.attendant.name;
    meta.appendChild(attendant);
  }

  row.appendChild(top);
  row.appendChild(meta);
  return row;
}

// Transforma URLs dentro de um texto solto em links clicáveis — usado onde
// texto livre (descrição do ticket, nota) pode conter um link colado pelo
// atendente. Espelha components/Linkified.tsx do sistema web (não dá pra
// importar entre os dois codebases).
const URL_REGEX = /(https?:\/\/[^\s<>"']+)/g;
function renderLinkifiedText(el, text) {
  el.innerHTML = '';
  const parts = String(text || '').split(URL_REGEX);
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const a = document.createElement('a');
      a.href = part;
      a.target = '_blank';
      a.rel = 'noreferrer';
      a.textContent = part;
      a.style.color = '#f87171';
      a.addEventListener('click', (e) => e.stopPropagation());
      el.appendChild(a);
    } else if (part) {
      el.appendChild(document.createTextNode(part));
    }
  });
}

function detailRow(label, value) {
  const row = document.createElement('div');
  row.className = 'detail-row';
  const dt = document.createElement('span');
  dt.className = 'detail-row__label';
  dt.textContent = label;
  const dd = document.createElement('span');
  dd.className = 'detail-row__value';
  dd.textContent = value || '—';
  row.appendChild(dt);
  row.appendChild(dd);
  return row;
}

// Visualização compacta e somente-leitura de 1 ticket: só dados, nenhuma
// ação (nem editar, nem abrir link externo) — a única navegação daqui é o
// botão "Voltar" (pra lista) ou o "Fechar" do drawer, no cabeçalho.
function showTicketDetail(t) {
  // Abrir o ticket é o que conta como "visto" pro destaque de comentário
  // novo — tira o negrito/bolinha da lista na hora (síncrono, não espera
  // storage/backend) e persiste em segundo plano.
  if (unreadTicketIds.has(t.id)) {
    unreadTicketIds.delete(t.id);
    unreadVersion++;
    renderTicketsList();
    persistTicketRead(t.id);
  }

  const content = $('ticketDetailContent');
  content.innerHTML = '';

  const title = document.createElement('h3');
  title.className = 'detail-title';
  title.textContent = t.subject || '(sem assunto)';
  content.appendChild(title);

  const badges = buildTicketBadges(t);
  badges.style.marginTop = '8px';
  content.appendChild(badges);

  const fields = document.createElement('div');
  fields.style.marginTop = '10px';
  fields.appendChild(detailRow('Ticket', t.ticket_number ? `#${t.ticket_number}` : null));
  fields.appendChild(detailRow('Empresa', ticketCompanyLabel(t)));
  fields.appendChild(detailRow('Contato', t.nome_contato || (t.contact && t.contact.name)));
  fields.appendChild(detailRow('Telefone', t.telefone_contato));
  fields.appendChild(detailRow('Atendente', t.attendant && t.attendant.name));
  fields.appendChild(detailRow('Canal', CHANNEL_LABELS[t.channel] || t.channel));
  fields.appendChild(detailRow('Criado em', t.created_at ? new Date(t.created_at).toLocaleString('pt-BR') : null));
  fields.appendChild(detailRow('Prazo', t.due_date ? new Date(t.due_date).toLocaleString('pt-BR') : null));
  content.appendChild(fields);

  // Confirmação de leitura (estilo WhatsApp, mesmo mecanismo do sistema web)
  // — abrir o detalhe aqui já marca como visto por quem está logado.
  const readsRow = document.createElement('p');
  readsRow.className = 'muted';
  readsRow.style.cssText = 'font-size:11px; margin:6px 0 0;';
  content.appendChild(readsRow);
  markAndLoadTicketReads(t.id, readsRow);

  if (t.description) {
    const descLabel = document.createElement('div');
    descLabel.className = 'detail-row__label';
    descLabel.style.marginTop = '10px';
    descLabel.textContent = 'Descrição';
    const desc = document.createElement('p');
    desc.className = 'detail-description';
    renderLinkifiedText(desc, t.description);
    content.appendChild(descLabel);
    content.appendChild(desc);
  }

  if (Array.isArray(t.tags) && t.tags.length) {
    const tagsLabel = document.createElement('div');
    tagsLabel.className = 'detail-row__label';
    tagsLabel.style.marginTop = '10px';
    tagsLabel.textContent = 'Tags';
    content.appendChild(tagsLabel);
    const tagsWrap = document.createElement('div');
    tagsWrap.style.cssText = 'display:flex; flex-wrap:wrap; gap:6px; margin-top:6px;';
    for (const tag of t.tags) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.textContent = tag;
      tagsWrap.appendChild(chip);
    }
    content.appendChild(tagsWrap);
  }

  // ---- Notas — único ponto de escrita desse detalhe (o resto é só
  // leitura). Autor é sempre o atendente logado nesta extensão
  // (myAttendantId, mesmo mecanismo do resto do drawer).
  const notesLabel = document.createElement('div');
  notesLabel.className = 'detail-row__label';
  notesLabel.style.marginTop = '14px';
  notesLabel.textContent = 'Notas';
  content.appendChild(notesLabel);

  const notesList = document.createElement('div');
  notesList.style.marginTop = '8px';
  content.appendChild(notesList);
  loadTicketNotes(t.id, notesList);

  const noteInput = document.createElement('textarea');
  noteInput.placeholder = 'Adicionar nota...';
  noteInput.style.cssText = 'margin-top:10px; min-height:60px;';
  content.appendChild(noteInput);

  const noteMsg = document.createElement('div');
  noteMsg.className = 'validate-msg';
  content.appendChild(noteMsg);

  const noteBtn = document.createElement('button');
  noteBtn.type = 'button';
  noteBtn.className = 'btn-validate';
  noteBtn.style.marginTop = '0';
  noteBtn.textContent = '+ Adicionar nota';
  noteBtn.addEventListener('click', async () => {
    const text = noteInput.value.trim();
    if (!text) return;
    noteBtn.disabled = true;
    noteMsg.textContent = '';
    noteMsg.className = 'validate-msg';
    const r = await send('createTicketNote', {
      ticket_id: t.id,
      attendant_id: myAttendantId || null,
      note: text,
      is_internal: true,
    });
    noteBtn.disabled = false;
    if (r && r.ok) {
      noteInput.value = '';
      loadTicketNotes(t.id, notesList);
    } else {
      noteMsg.textContent = (r && r.error) || 'Não foi possível salvar a nota.';
      noteMsg.className = 'validate-msg warn';
    }
  });
  content.appendChild(noteBtn);

  $('ticketsListView').style.display = 'none';
  $('ticketDetailView').style.display = 'flex';
}

// Marca o ticket como visto por quem está logado e depois busca+desenha
// quem já viu — mesma ordem do TicketDetail.tsx (marca antes de listar, pra
// a própria visita atual já aparecer na lista).
async function markAndLoadTicketReads(ticketId, container) {
  await send('markTicketRead', { ticketId });
  const r = await send('getTicketReads', { ticketId });
  container.textContent = '';
  if (!r || !r.ok) return;
  const reads = (r.data && r.data.data) || [];
  if (!reads.length) return;
  const names = reads.map((rd) => rd.name).join(', ');
  container.textContent = `👁 Visto por ${names}`;
  container.title = reads.map((rd) => `${rd.name}: ${new Date(rd.read_at).toLocaleString('pt-BR')}`).join('\n');
}

// Busca as notas do ticket e desenha na lista (chamado ao abrir o detalhe e
// de novo depois de adicionar uma nova, pra já aparecer na hora).
async function loadTicketNotes(ticketId, container) {
  container.innerHTML = '';
  const loading = document.createElement('p');
  loading.className = 'muted';
  loading.style.fontSize = '12.5px';
  loading.textContent = 'Carregando notas...';
  container.appendChild(loading);

  const r = await send('getTicketNotes', { ticketId });
  container.innerHTML = '';

  if (!r || !r.ok) {
    const msg = document.createElement('p');
    msg.className = 'validate-msg warn';
    msg.textContent = (r && r.error) || 'Não foi possível carregar as notas.';
    container.appendChild(msg);
    return;
  }

  const notes = (r.data && r.data.data) || [];
  if (!notes.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.style.fontSize = '12.5px';
    empty.textContent = 'Nenhuma nota ainda.';
    container.appendChild(empty);
    return;
  }

  for (const n of notes) {
    const item = document.createElement('div');
    item.style.cssText = 'padding:8px 10px; border:1px solid var(--border); border-radius:8px; background:var(--card); margin-bottom:6px;';

    const head = document.createElement('div');
    head.style.cssText = 'display:flex; justify-content:space-between; gap:8px; font-size:11px; color:var(--muted); margin-bottom:4px;';
    const author = document.createElement('span');
    author.textContent = (n.attendant && n.attendant.name) || 'Sistema';
    const when = document.createElement('span');
    when.textContent = n.created_at ? new Date(n.created_at).toLocaleString('pt-BR') : '';
    head.appendChild(author);
    head.appendChild(when);

    const text = document.createElement('p');
    text.style.cssText = 'margin:0; font-size:13px; white-space:pre-wrap; word-break:break-word;';
    renderLinkifiedText(text, n.note);

    item.appendChild(head);
    item.appendChild(text);
    container.appendChild(item);
  }
}

$('ticketDetailBack').addEventListener('click', () => {
  $('ticketDetailView').style.display = 'none';
  $('ticketsListView').style.display = 'flex';
});

// Busca por #, título, cliente (empresa/contato) ou palavra-chave na
// descrição — tudo client-side, em cima do que já foi carregado.
function matchesSearch(t, q) {
  if (!q) return true;
  const haystack = [
    t.ticket_number != null ? String(t.ticket_number) : '',
    t.subject || '',
    t.description || '',
    ticketCompanyLabel(t),
    t.nome_contato || '',
    t.contact && t.contact.name,
  ].filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(q);
}

function renderTicketsList() {
  const list = $('ticketsList');
  const msg = $('ticketsMsg');
  list.innerHTML = '';

  const q = $('ticketSearch').value.trim().toLowerCase();
  let filtered = openTickets.filter((t) => matchesSearch(t, q));
  if (mineOnly) filtered = filtered.filter((t) => t.attendant_id === myAttendantId);

  // Maior prioridade primeiro; empate desempata por mais recente.
  filtered.sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority] ?? 99;
    const pb = PRIORITY_ORDER[b.priority] ?? 99;
    if (pa !== pb) return pa - pb;
    return new Date(b.created_at || 0) - new Date(a.created_at || 0);
  });

  if (!filtered.length) {
    msg.textContent = openTickets.length ? 'Nenhum ticket encontrado com esse filtro.' : 'Nenhum ticket em aberto.';
    msg.className = 'validate-msg';
    return;
  }
  msg.textContent = '';
  for (const t of filtered) list.appendChild(renderTicketRow(t));
}
$('ticketSearch').addEventListener('input', renderTicketsList);
$('filterMine').addEventListener('click', () => {
  mineOnly = !mineOnly;
  $('filterMine').classList.toggle('active', mineOnly);
  renderTicketsList();
});

async function loadOpenTickets() {
  const msg = $('ticketsMsg');
  const list = $('ticketsList');
  const btn = $('refreshTickets');
  msg.textContent = '';
  msg.className = 'validate-msg';
  btn.disabled = true;
  list.innerHTML = '';

  const [r] = await Promise.all([send('getOpenTickets', {}), refreshUnreadTicketIds()]);
  btn.disabled = false;

  if (!r || !r.ok) {
    msg.textContent = (r && r.error) || 'Não foi possível carregar os tickets.';
    msg.className = 'validate-msg warn';
    return;
  }

  const all = (r.data && r.data.data) || [];
  openTickets = all.filter((t) => !CLOSED_STATUSES.has(t.status));
  ticketsLoaded = true;
  renderTicketsList();
}
$('refreshTickets').addEventListener('click', loadOpenTickets);

// ---- Contatos (aba "Contatos" — agenda: busca por nome, empresa ou
// telefone entre todos os contatos cadastrados no sistema web). Mesmo padrão
// de lista+detalhe da aba Consultar. Endereço do sistema web usado pelo
// botão "Editar no sistema" — mesmo host dos content_scripts/host_permissions
// do manifest (ver web-bridge.js).
const WEB_APP_URL = 'http://192.168.0.104:5173';

let contactsLoaded = false;
let allContacts = [];

function matchesContactSearch(c, q, qDigits) {
  if (!q) return true;
  const haystack = [c.name || '', (c.company && c.company.name) || '', c.email || '']
    .filter(Boolean).join(' ').toLowerCase();
  if (haystack.includes(q)) return true;
  if (qDigits) {
    const phoneDigits = onlyDigits(c.phone || '');
    if (phoneDigits && phoneDigits.includes(qDigits)) return true;
  }
  return false;
}

function renderContactRow(c) {
  // <div> (não <button>) porque o botão de chat no canto precisa ser um
  // elemento clicável próprio — botão dentro de botão não é válido em HTML e
  // o clique do filho vazaria pro pai mesmo com stopPropagation em alguns
  // navegadores.
  const row = document.createElement('div');
  row.className = 'ticket-row';
  row.style.width = '100%';
  row.style.position = 'relative';
  row.style.cursor = 'pointer';

  const clickArea = document.createElement('div');
  if (c.conversation_url) clickArea.style.paddingRight = '30px';
  clickArea.addEventListener('click', () => showContactDetail(c));

  const top = document.createElement('div');
  top.className = 'ticket-row__top';
  const name = document.createElement('span');
  name.className = 'ticket-row__subject';
  name.textContent = c.name || '(sem nome)';
  top.appendChild(name);

  const meta = document.createElement('div');
  meta.className = 'ticket-row__meta';
  if (c.company && c.company.name) {
    const company = document.createElement('span');
    company.textContent = c.company.name;
    meta.appendChild(company);
  }
  if (c.phone) {
    const phone = document.createElement('span');
    phone.textContent = c.phone;
    meta.appendChild(phone);
  }
  clickArea.appendChild(top);
  clickArea.appendChild(meta);
  row.appendChild(clickArea);

  // Botão de chat no canto — só aparece pra quem tem link de conversa
  // salvo, atalho pra ir direto sem precisar abrir o detalhe do contato.
  if (c.conversation_url) {
    const chatBtn = document.createElement('button');
    chatBtn.type = 'button';
    chatBtn.title = 'Ir até a conversa';
    chatBtn.textContent = '💬';
    chatBtn.style.cssText =
      'position:absolute; top:8px; right:8px; width:26px; height:26px; padding:0;' +
      'display:flex; align-items:center; justify-content:center; font-size:13px; line-height:1;' +
      'background:rgba(239,68,68,.15); border:1px solid rgba(239,68,68,.35); color:#f87171;' +
      'border-radius:7px; cursor:pointer;';
    chatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openConversationInSameTab(c.conversation_url);
    });
    row.appendChild(chatBtn);
  }

  return row;
}

function renderContactsList() {
  const list = $('contactsList');
  const msg = $('contactsMsg');
  const count = $('contactsCount');
  list.innerHTML = '';

  const q = $('contactSearch').value.trim().toLowerCase();
  const qDigits = onlyDigits($('contactSearch').value);
  const filtered = allContacts.filter((c) => matchesContactSearch(c, q, qDigits));

  count.textContent = `${filtered.length} de ${allContacts.length} contato(s)`;

  if (!filtered.length) {
    msg.textContent = allContacts.length ? 'Nenhum contato encontrado com essa busca.' : 'Nenhum contato cadastrado.';
    msg.className = 'validate-msg';
    return;
  }
  msg.textContent = '';
  for (const c of filtered) list.appendChild(renderContactRow(c));
}
$('contactSearch').addEventListener('input', renderContactsList);

async function loadContacts() {
  const msg = $('contactsMsg');
  const list = $('contactsList');
  const btn = $('refreshContacts');
  msg.textContent = '';
  msg.className = 'validate-msg';
  btn.disabled = true;
  list.innerHTML = '';

  const r = await send('getContacts', {});
  btn.disabled = false;

  if (!r || !r.ok) {
    msg.textContent = (r && r.error) || 'Não foi possível carregar os contatos.';
    msg.className = 'validate-msg warn';
    return;
  }

  allContacts = (r.data && r.data.data) || [];
  contactsLoaded = true;
  renderContactsList();
}
$('refreshContacts').addEventListener('click', loadContacts);

// Troca a URL da própria aba do Crisp pra ir direto pra conversa salva —
// "mesma guia" pedido: não abre aba nova, só navega a aba ativa/focada (é
// justamente a aba do Crisp de onde o painel foi aberto).
async function openConversationInSameTab(url) {
  if (!url) return;
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    const tab = tabs && tabs[0];
    if (tab && tab.id != null) {
      await chrome.tabs.update(tab.id, { url });
      return;
    }
  } catch (e) {
    console.warn('[Zorte Crisp] Não consegui trocar a aba ativa pra conversa.', e && e.message);
  }
  window.open(url, '_blank'); // fallback: nenhuma aba ativa encontrada
}

function showContactDetail(c) {
  const content = $('contactDetailContent');
  content.innerHTML = '';

  const title = document.createElement('h3');
  title.className = 'detail-title';
  title.textContent = c.name || '(sem nome)';
  content.appendChild(title);

  const fields = document.createElement('div');
  fields.style.marginTop = '10px';
  fields.appendChild(detailRow('E-mail', c.email));
  fields.appendChild(detailRow('Telefone', c.phone));
  fields.appendChild(detailRow('Cargo', c.position));
  fields.appendChild(detailRow('Empresa', c.company && c.company.name));
  fields.appendChild(detailRow('Cadastrado em', c.created_at ? new Date(c.created_at).toLocaleDateString('pt-BR') : null));
  content.appendChild(fields);

  if (c.notes) {
    const notesLabel = document.createElement('div');
    notesLabel.className = 'detail-row__label';
    notesLabel.style.marginTop = '10px';
    notesLabel.textContent = 'Observações';
    const notes = document.createElement('p');
    notes.className = 'detail-description';
    notes.textContent = c.notes;
    content.appendChild(notesLabel);
    content.appendChild(notes);
  }

  const openBtn = $('contactOpenConversation');
  openBtn.disabled = !c.conversation_url;
  openBtn.title = c.conversation_url ? '' : 'Sem link de conversa salvo pra esse contato';
  openBtn.onclick = () => openConversationInSameTab(c.conversation_url);

  $('contactEditWeb').onclick = () => window.open(`${WEB_APP_URL}/contacts?edit=${encodeURIComponent(c.id)}`, '_blank');

  $('contactsListView').style.display = 'none';
  $('contactDetailView').style.display = 'flex';
}
$('contactDetailBack').addEventListener('click', () => {
  $('contactDetailView').style.display = 'none';
  $('contactsListView').style.display = 'flex';
});

// ---- Módulos (aba "Módulos" — busca a EMPRESA, igual ao campo "Empresa" da
// aba Criar, e mostra o identificador dela + os módulos do catálogo que ela
// já tem contratados, cruzando empresas.modulo_ids com o catálogo /modules.
// Some sozinha com a empresa da conversa atual (Crisp), igual ao scanner de
// CNPJ da aba Criar — busca manual é só o fallback/troca. Somente consulta,
// sem marcar/desmarcar módulo por aqui (isso é feito na página da empresa no
// sistema web). ----
const CATEGORY_COLORS = { adicionais: '#60a5fa', fiscal: '#fbbf24', operacional: '#34d399' };

let modulesLoaded = false;
let allModules = [];
let moduleCompanyId = '';
let moduleSearchTimer = null;
let pendingModuleIds = null; // module_ids da empresa selecionada, à espera do catálogo carregar

function formatModulePrice(m) {
  const isFixed = Number(m.price_type) === 0;
  const raw = isFixed ? m.fixed_value : m.unit_value;
  if (raw == null) return '—';
  const value = Number(raw).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return isFixed ? `${value}/mês` : `${value}/${m.unit || 'unidade'}`;
}

function moduleCategoryLabel(m) {
  const cat = (m.category || '').trim();
  if (!cat) return null;
  return cat.charAt(0).toUpperCase() + cat.slice(1).toLowerCase();
}

function renderCompanyModuleChips(moduleIds) {
  pendingModuleIds = Array.isArray(moduleIds) ? moduleIds : [];
  const box = $('moduleResultChips');
  box.innerHTML = '';

  if (!modulesLoaded) {
    const loading = document.createElement('p');
    loading.className = 'muted';
    loading.style.fontSize = '12.5px';
    loading.textContent = 'Carregando catálogo de módulos...';
    box.appendChild(loading);
    return;
  }

  const mods = allModules.filter((m) => pendingModuleIds.includes(m.id));
  if (!mods.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.style.fontSize = '12.5px';
    empty.textContent = 'Nenhum módulo adicional contratado.';
    box.appendChild(empty);
    return;
  }
  for (const m of mods) {
    const catLabel = moduleCategoryLabel(m);
    const color = (catLabel && CATEGORY_COLORS[catLabel.toLowerCase()]) || '#a1a1aa';
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    chip.title = formatModulePrice(m);
    chip.style.cssText = `background:${color}18; border:1px solid ${color}55; color:${color};`;
    const dot = document.createElement('span');
    dot.style.cssText = `width:6px; height:6px; flex-shrink:0; border-radius:999px; background:${color}; display:inline-block;`;
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(m.name));
    box.appendChild(chip);
  }
}

function clearModuleCompany() {
  moduleCompanyId = '';
  pendingModuleIds = null;
  $('moduleCompanyChip').style.display = 'none';
  $('moduleCompany').style.display = '';
  $('moduleCompany').value = '';
  $('moduleCompanyList').style.display = 'none';
  $('moduleCompanyResult').style.display = 'none';
  $('moduleCompanyMsg').textContent = '';
}

function selectModuleCompany(c) {
  if (!c || !c.id) return;
  moduleCompanyId = c.id;
  const detalhes = [c.tenant, c.document ? `CNPJ ${c.document}` : null].filter(Boolean);
  $('moduleCompanyChipName').textContent = c.name + (detalhes.length ? ` · ${detalhes.join(' · ')}` : '');
  $('moduleCompanyChip').style.display = 'flex';
  $('moduleCompany').style.display = 'none';
  $('moduleCompanyList').style.display = 'none';
  $('moduleCompanyMsg').textContent = '';

  const tenant = c.tenant && (c.tenant.name || c.tenant);
  $('moduleResultName').textContent = c.name || '—';
  $('moduleResultTenantRow').style.display = tenant ? 'flex' : 'none';
  $('moduleResultTenant').textContent = tenant || '';
  $('moduleResultCnpjRow').style.display = c.document ? 'flex' : 'none';
  $('moduleResultCnpj').textContent = c.document || '';
  $('moduleCompanyResult').style.display = 'flex';

  renderCompanyModuleChips(c.module_ids);
}

function renderModuleCompanyList(results) {
  const box = $('moduleCompanyList');
  box.innerHTML = '';
  if (!results.length) { box.style.display = 'none'; return; }
  for (const c of results) {
    const item = document.createElement('div');
    item.className = 'combo-item';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = c.name;
    const mt = document.createElement('div');
    mt.className = 'mt';
    mt.textContent = (c.document ? `CNPJ ${c.document}` : 'Sem CNPJ') + (c.tenant ? ` · ${c.tenant}` : '');
    item.appendChild(nm);
    item.appendChild(mt);
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectModuleCompany(c); });
    box.appendChild(item);
  }
  box.style.display = 'block';
}

$('moduleCompany').addEventListener('input', () => {
  const q = $('moduleCompany').value.trim();
  clearTimeout(moduleSearchTimer);
  if (!q) { $('moduleCompanyList').style.display = 'none'; return; }
  moduleSearchTimer = setTimeout(async () => {
    const r = await send('searchCompany', { query: q });
    if (r && r.ok) renderModuleCompanyList((r.data && r.data.results) || []);
  }, 250);
});
$('moduleCompany').addEventListener('blur', () => setTimeout(() => { $('moduleCompanyList').style.display = 'none'; }, 150));
$('moduleCompanyClear').addEventListener('click', clearModuleCompany);

// Preenche sozinha com a empresa já identificada na conversa atual do Crisp
// (mesmo resultado usado pra preencher a aba Criar) — só na primeira vez que
// a aba é aberta, sem sobrescrever uma busca manual já feita pelo atendente.
function autoFillModuleCompany() {
  if (moduleCompanyId) return;
  if (lastContext && lastContext.found && lastContext.data) selectModuleCompany(lastContext.data);
}

async function loadModules() {
  const r = await send('getModules', {});
  if (!r || !r.ok) {
    $('moduleCompanyMsg').textContent = (r && r.error) || 'Não foi possível carregar o catálogo de módulos.';
    $('moduleCompanyMsg').className = 'validate-msg warn';
    return;
  }
  const all = (r.data && r.data.data) || [];
  allModules = all.filter((m) => !m.deleted_at);
  modulesLoaded = true;
  if (pendingModuleIds) renderCompanyModuleChips(pendingModuleIds);
}

// ---- Histórico (aba "Histórico" — busca a EMPRESA, igual à aba Módulos, e
// lista TODOS os tickets dela + filiais do mesmo tenant, pendentes e
// resolvidos, com indicadores de recorrência no topo e filtro por status.
// Read-only: clicar num ticket aqui não abre detalhe/nota — isso já existe
// na aba Consultar; o objetivo é dar uma visão rápida do histórico do
// cliente, não gerenciar ticket. ----
let historyCompanyId = '';
let historySearchTimer = null;
let historyTickets = []; // último resultado carregado do backend (sem filtro de status)
let historyVisitCount = null;
let historyStatusFilter = 'all'; // 'all' | 'pending' | 'resolved'

function clearHistoryCompany() {
  historyCompanyId = '';
  historyTickets = [];
  historyVisitCount = null;
  $('historyCompanyChip').style.display = 'none';
  $('historyCompany').style.display = '';
  $('historyCompany').value = '';
  $('historyCompanyList').style.display = 'none';
  $('historySummary').style.display = 'none';
  $('historyTicketsList').innerHTML = '';
  $('historyCompanyMsg').textContent = '';
}

async function selectHistoryCompany(c) {
  if (!c || !c.id) return;
  historyCompanyId = c.id;
  const detalhes = [c.tenant, c.document ? `CNPJ ${c.document}` : null].filter(Boolean);
  $('historyCompanyChipName').textContent = c.name + (detalhes.length ? ` · ${detalhes.join(' · ')}` : '');
  $('historyCompanyChip').style.display = 'flex';
  $('historyCompany').style.display = 'none';
  $('historyCompanyList').style.display = 'none';
  await loadHistory();
}

function renderHistoryCompanyList(results) {
  const box = $('historyCompanyList');
  box.innerHTML = '';
  if (!results.length) { box.style.display = 'none'; return; }
  for (const c of results) {
    const item = document.createElement('div');
    item.className = 'combo-item';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = c.name;
    const mt = document.createElement('div');
    mt.className = 'mt';
    mt.textContent = (c.document ? `CNPJ ${c.document}` : 'Sem CNPJ') + (c.tenant ? ` · ${c.tenant}` : '');
    item.appendChild(nm);
    item.appendChild(mt);
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectHistoryCompany(c); });
    box.appendChild(item);
  }
  box.style.display = 'block';
}

$('historyCompany').addEventListener('input', () => {
  const q = $('historyCompany').value.trim();
  clearTimeout(historySearchTimer);
  if (!q) { $('historyCompanyList').style.display = 'none'; return; }
  historySearchTimer = setTimeout(async () => {
    const r = await send('searchCompany', { query: q });
    if (r && r.ok) renderHistoryCompanyList((r.data && r.data.results) || []);
  }, 250);
});
$('historyCompany').addEventListener('blur', () => setTimeout(() => { $('historyCompanyList').style.display = 'none'; }, 150));
$('historyCompanyClear').addEventListener('click', clearHistoryCompany);

// Preenche sozinha com a empresa já identificada na conversa atual do Crisp
// — mesmo mecanismo da aba Módulos — só na primeira vez que a aba é aberta,
// sem sobrescrever uma busca manual já feita pelo atendente.
function autoFillHistoryCompany() {
  if (historyCompanyId) return;
  if (lastContext && lastContext.found && lastContext.data) selectHistoryCompany(lastContext.data);
}

async function loadHistory() {
  $('historySummary').style.display = 'none';
  $('historyTicketsList').innerHTML = '';
  $('historyCompanyMsg').textContent = 'Carregando histórico...';
  $('historyCompanyMsg').className = 'validate-msg';
  const r = await send('getCompanyTicketHistory', { companyId: historyCompanyId });
  if (!r || !r.ok) {
    $('historyCompanyMsg').textContent = (r && r.error) || 'Não foi possível carregar o histórico.';
    $('historyCompanyMsg').className = 'validate-msg warn';
    return;
  }
  $('historyCompanyMsg').textContent = '';
  const payload = (r.data && r.data.data) || {};
  historyTickets = payload.tickets || [];
  historyVisitCount = payload.visit_count != null ? payload.visit_count : null;
  renderHistorySummary();
  renderHistoryTicketsList();
  $('historySummary').style.display = 'flex';
}

function renderHistorySummary() {
  const total = historyTickets.length;
  const resolved = historyTickets.filter((t) => CLOSED_STATUSES.has(t.status)).length;
  const pending = total - resolved;
  $('historyStatTotal').textContent = String(total);
  $('historyStatPending').textContent = String(pending);
  $('historyStatResolved').textContent = String(resolved);
  $('historyVisitsLine').textContent = historyVisitCount != null
    ? `💬 ${historyVisitCount} conversa${historyVisitCount === 1 ? '' : 's'} identificada${historyVisitCount === 1 ? '' : 's'} com este cliente`
    : '';
}

function setHistoryFilter(filter) {
  historyStatusFilter = filter;
  $('historyFilterAll').classList.toggle('active', filter === 'all');
  $('historyFilterPending').classList.toggle('active', filter === 'pending');
  $('historyFilterResolved').classList.toggle('active', filter === 'resolved');
  renderHistoryTicketsList();
}
$('historyFilterAll').addEventListener('click', () => setHistoryFilter('all'));
$('historyFilterPending').addEventListener('click', () => setHistoryFilter('pending'));
$('historyFilterResolved').addEventListener('click', () => setHistoryFilter('resolved'));

function renderHistoryTicketRow(t) {
  const row = document.createElement('div');
  row.className = 'ticket-row ticket-row--static';

  const top = document.createElement('div');
  top.className = 'ticket-row__top';
  const subject = document.createElement('span');
  subject.className = 'ticket-row__subject';
  subject.textContent = t.subject || '(sem assunto)';
  const number = document.createElement('span');
  number.className = 'ticket-row__number';
  number.textContent = t.ticket_number ? `#${t.ticket_number}` : '';
  top.appendChild(subject);
  top.appendChild(number);

  const meta = buildTicketBadges(t);
  if (t.created_at) {
    const date = document.createElement('span');
    date.textContent = new Date(t.created_at).toLocaleDateString('pt-BR');
    meta.appendChild(date);
  }

  row.appendChild(top);
  row.appendChild(meta);
  return row;
}

function renderHistoryTicketsList() {
  const box = $('historyTicketsList');
  box.innerHTML = '';
  const filtered = historyTickets.filter((t) => {
    if (historyStatusFilter === 'pending') return !CLOSED_STATUSES.has(t.status);
    if (historyStatusFilter === 'resolved') return CLOSED_STATUSES.has(t.status);
    return true;
  });
  if (!filtered.length) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.style.fontSize = '12.5px';
    empty.textContent = historyTickets.length ? 'Nenhum ticket nesse filtro.' : 'Nenhum ticket encontrado pra esta empresa.';
    box.appendChild(empty);
    return;
  }
  for (const t of filtered) box.appendChild(renderHistoryTicketRow(t));
}

function showError(text) {
  const el = $('error');
  if (!text) { el.style.display = 'none'; el.textContent = ''; el.className = 'error'; return; }
  el.textContent = text;
  el.className = 'error';
  el.style.display = 'block';
}
function showSuccess(text) {
  const el = $('error');
  el.textContent = text;
  el.className = 'error';
  el.style.cssText = 'display:block;background:rgba(16,163,74,.12);border:1px solid rgba(16,163,74,.3);color:#34d399;padding:9px 11px;border-radius:9px;font-size:13px;';
}

// ---- Máscara de telefone ----
// Espelha frontend/src/lib/masks.ts (a extensão não pode importar módulos TS).
function onlyDigits(v) {
  return (v || '').replace(/\D/g, '');
}
function maskPhone(v) {
  let d = onlyDigits(v);
  // O telefone capturado da conversa do Crisp vem em formato internacional
  // (ex.: "+554888732042"); remove o DDI 55 antes de aplicar a máscara BR.
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2);
  d = d.slice(0, 11);
  if (d.length <= 10) {
    return d
      .replace(/(\d{2})(\d)/, '($1) $2')
      .replace(/(\d{4})(\d{1,4})$/, '$1-$2');
  }
  return d
    .replace(/(\d{2})(\d)/, '($1) $2')
    .replace(/(\d{5})(\d{1,4})$/, '$1-$2');
}
$('phone').addEventListener('input', () => {
  const pos = $('phone').selectionStart;
  const before = $('phone').value;
  $('phone').value = maskPhone(before);
  // Mantém o cursor perto de onde estava (aproximado — mudou de tamanho com a máscara).
  const diff = $('phone').value.length - before.length;
  try { $('phone').setSelectionRange(pos + diff, pos + diff); } catch (e) {}
});

// ---- Empresa (combobox) ----
let companyId = '';
let searchTimer = null;

function clearCompany() {
  companyId = '';
  $('companyChip').style.display = 'none';
  $('company').style.display = '';
  $('company').value = '';
  $('companyList').style.display = 'none';
  hideSearchResult();
  saveDraftDebounced();
}

function selectCompany(c) {
  if (!c || !c.id) return;
  companyId = c.id;
  const detalhes = [c.tenant, c.document ? `CNPJ ${c.document}` : null].filter(Boolean);
  $('companyChipName').textContent = c.name + (detalhes.length ? ` · ${detalhes.join(' · ')}` : '');
  $('companyChip').style.display = 'flex';
  $('company').style.display = 'none';
  $('companyList').style.display = 'none';
  saveDraftDebounced();
}

// ---- Aviso do scanner de CNPJ (tenant.js) ----
// O content script varre a conversa e, ao achar um CNPJ novo já cadastrado,
// avisa o drawer (painel lateral OU iframe — chrome.runtime.onMessage chega
// nos dois). Só preenche se o usuário ainda não escolheu uma empresa.
if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
  chrome.runtime.onMessage.addListener((request) => {
    if (request && request.action === 'cnpjMatchFound' && request.company && !companyId) {
      selectCompany(request.company);
      renderSearchResult(request.company);
      const msg = $('validateMsg');
      if (msg) {
        msg.textContent = 'Empresa identificada automaticamente (CNPJ/CPF detectado na conversa).';
        msg.className = 'validate-msg ok';
      }
    }
    // Mesmo aviso também preenche sozinho a aba "Módulos", se ainda não tiver
    // empresa selecionada lá (busca manual independente da aba Criar).
    if (request && request.action === 'cnpjMatchFound' && request.company && !moduleCompanyId) {
      selectModuleCompany(request.company);
    }
    // Idem pra aba "Histórico".
    if (request && request.action === 'cnpjMatchFound' && request.company && !historyCompanyId) {
      selectHistoryCompany(request.company);
    }
    // Pedido do background pra se fechar (atalho Ctrl+\ apertado de novo
    // com o painel já aberto — ver toggleSidePanel em background.js).
    if (request && request.action === 'closeDrawer') {
      dismiss('close');
    }

    // Trocou de conversa no Crisp (ver notifyIfConversationChanged em
    // tenant.js) — troca pro rascunho da conversa nova se já existir um (ver
    // loadOrResetForSession), senão limpa os dados do cliente ANTERIOR
    // (nome, telefone, e-mail, empresa, tags, issues...) pra não vazar
    // informação errada pro ticket da conversa nova. Módulos segue a mesma
    // regra de limpar (troca manual se quiser outra empresa). Histórico
    // também limpa, mas ADEMAIS já busca sozinho a empresa da conversa
    // nova (se identificada) — sem isso, a aba ficava sem informação até o
    // atendente trocar de aba e voltar (só aí `autoFillHistoryCompany` do
    // setMode rodava de novo).
    if (request && request.action === 'conversationChanged') {
      clearModuleCompany();
      clearHistoryCompany();
      send('getContext', {}).then((r) => {
        lastContext = r;
        loadOrResetForSession(r);
        autoFillHistoryCompany();
      });
    }

    // Clique no toast de comentário novo (ver tenant.js) com o painel JÁ
    // aberto — abre direto nesse ticket. Se o painel estava fechado, essa
    // mensagem se perde no meio da recarga; quem cobre esse caso é o valor
    // salvo no storage (ver openPendingTicketIfAny, chamado ao carregar).
    if (request && request.action === 'openTicketInDrawer' && request.ticketId) {
      openTicketById(request.ticketId);
    }

    // tenant.js marcou ticket(s) como "não lido" enquanto o painel já
    // estava aberto — atualiza a lista sem esperar o próximo carregamento.
    if (request && request.action === 'unreadTicketsChanged') {
      refreshUnreadTicketIds().then(() => { if (ticketsLoaded) renderTicketsList(); });
    }
  });
}

function renderCompanyList(results) {
  const box = $('companyList');
  box.innerHTML = '';
  if (!results.length) { box.style.display = 'none'; return; }
  for (const c of results) {
    const item = document.createElement('div');
    item.className = 'combo-item';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = c.name;
    const mt = document.createElement('div');
    mt.className = 'mt';
    mt.textContent = (c.document ? `CNPJ ${c.document}` : 'Sem CNPJ') + (c.tenant ? ` · ${c.tenant}` : '');
    item.appendChild(nm);
    item.appendChild(mt);
    item.addEventListener('mousedown', (e) => { e.preventDefault(); selectCompany(c); });
    box.appendChild(item);
  }
  box.style.display = 'block';
}

$('company').addEventListener('input', () => {
  const q = $('company').value.trim();
  clearTimeout(searchTimer);
  if (!q) { $('companyList').style.display = 'none'; return; }
  searchTimer = setTimeout(async () => {
    const r = await send('searchCompany', { query: q });
    if (r && r.ok) renderCompanyList((r.data && r.data.results) || []);
  }, 250);
});
$('company').addEventListener('blur', () => setTimeout(() => { $('companyList').style.display = 'none'; }, 150));
$('companyClear').addEventListener('click', clearCompany);

// ---- Contexto da conversa (perfil + empresa validada) ----
// Preenche campos vazios sem sobrescrever o que o usuário já digitou.
function applyContext(r, { fillCompany }) {
  const ex = (r && r.extra) || {};
  if (ex.name && !$('name').value) {
    $('name').value = ex.name;
    if (!$('subject').value.trim()) $('subject').value = `Atendimento - ${ex.name}`;
  }
  if (ex.phone && !$('phone').value) $('phone').value = maskPhone(ex.phone);
  if (ex.email && !$('email').value) $('email').value = ex.email;
  if (ex.url && !$('url').value) $('url').value = ex.url;
  // Canal/origem detectado (Chat, WhatsApp...): só na abertura, para não
  // sobrescrever uma escolha manual do usuário numa revalidação.
  if (fillCompany && ex.channel && ['chat', 'whatsapp', 'email', 'telefone'].includes(ex.channel)) {
    $('canal').value = ex.channel;
  }
  if (fillCompany && r && r.found && r.data && !companyId) {
    selectCompany({
      id: r.data.id,
      name: r.data.name || r.data.nome,
      document: r.data.document || r.data.documento,
      tenant: r.data.tenant,
    });
    renderSearchResult(r.data);
  }
}

// Limpa o formulário de "Criar ticket" inteiro — chamado quando o atendente
// troca de conversa no Crisp (ver notifyIfConversationChanged em tenant.js),
// pra não deixar dado do cliente ANTERIOR (nome/telefone/e-mail/empresa)
// vazando pro ticket da conversa nova. Os campos referenciados aqui (tags,
// linear, empresa) são declarados mais abaixo neste mesmo script, mas isso é
// seguro: esta função só é CHAMADA de fato depois que o script todo já
// rodou (por um evento assíncrono), quando todas as declarações já existem.
function resetCreateForm() {
  $('subject').value = '';
  $('name').value = '';
  $('phone').value = '';
  $('email').value = '';
  $('url').value = '';
  $('description').value = '';
  $('status').value = 'novo';
  $('sistema').value = 'Z';
  $('canal').value = 'chat';
  if (typeof updateEmailRequiredHint === 'function') updateEmailRequiredHint();
  $('attendant').value = '';
  $('priority').value = 'media';
  $('dueDate').value = '';
  dueDateTouched = false;
  clearCompany();
  selectedTags = [];
  renderTagChips();
  linkedIssues = [];
  renderLinearChips();
  $('linear').value = '';
  showError('');
  $('summarizeMsg').textContent = '';
  $('summarizeMsg').className = 'validate-msg';
  $('createContactMsg').textContent = '';
  $('createContactMsg').className = 'validate-msg';
}

// Guarda o último contexto lido (inclui websiteId/sessionId da conversa
// aberta) pra "Resumir com IA" não precisar reler o DOM do Crisp de novo.
let lastContext = null;

// ---- Rascunho por conversa ----
// Trocar de aba (o painel se fecha sozinho, ver closeIfTabIsNotCrisp no topo
// deste arquivo) ou trocar de conversa no Crisp (ver "conversationChanged"
// acima) perdia TUDO que o atendente já tinha digitado — o formulário sempre
// nascia em branco de novo. Agora cada conversa (chave = website+sessão, ver
// getContext) guarda seu próprio rascunho em chrome.storage.session (memória
// da sessão do navegador — não precisa sobreviver a um fechar completo do
// Chrome, só ao ir-e-voltar de aba/conversa) e recupera sozinho ao reabrir a
// MESMA conversa. Uma conversa nova (sem rascunho salvo) continua limpando
// o formulário como antes, pra não vazar dado do cliente anterior.
let currentSessionKey = null;
let draftAttendantValue = null; // ver Promise.all(getAttendants) mais abaixo
let saveDraftTimer = null;

function sessionKeyFrom(ctx) {
  if (!ctx || !ctx.websiteId || !ctx.sessionId) return null;
  return `zt_draft:${ctx.websiteId}:${ctx.sessionId}`;
}

async function loadDraft(key) {
  if (!key) return null;
  try {
    const obj = await chrome.storage.session.get(key);
    return (obj && obj[key]) || null;
  } catch (e) {
    return null; // storage.session indisponível (Chrome antigo) — segue sem rascunho
  }
}

function snapshotFormState() {
  return {
    subject: $('subject').value,
    name: $('name').value,
    phone: $('phone').value,
    email: $('email').value,
    url: $('url').value,
    description: $('description').value,
    status: $('status').value,
    sistema: $('sistema').value,
    canal: $('canal').value,
    attendant: $('attendant').value,
    priority: $('priority').value,
    dueDate: $('dueDate').value,
    dueDateTouched,
    company: companyId ? { id: companyId, label: $('companyChipName').textContent } : null,
    tags: [...selectedTags],
    linearIssues: linkedIssues.map((i) => ({ ...i })),
  };
}

function applyCompanySnapshot(company) {
  if (!company || !company.id) { clearCompany(); return; }
  companyId = company.id;
  $('companyChipName').textContent = company.label || '';
  $('companyChip').style.display = 'flex';
  $('company').style.display = 'none';
  $('companyList').style.display = 'none';
}

function applyFormSnapshot(snap) {
  $('subject').value = snap.subject || '';
  $('name').value = snap.name || '';
  $('phone').value = snap.phone || '';
  $('email').value = snap.email || '';
  $('url').value = snap.url || '';
  $('description').value = snap.description || '';
  $('status').value = snap.status || 'novo';
  $('sistema').value = snap.sistema || 'Z';
  $('canal').value = snap.canal || 'chat';
  if (typeof updateEmailRequiredHint === 'function') updateEmailRequiredHint();
  $('priority').value = snap.priority || 'media';
  $('dueDate').value = snap.dueDate || '';
  dueDateTouched = Boolean(snap.dueDateTouched);
  draftAttendantValue = snap.attendant || null;
  if (draftAttendantValue) $('attendant').value = draftAttendantValue;
  applyCompanySnapshot(snap.company);
  selectedTags = Array.isArray(snap.tags) ? [...snap.tags] : [];
  renderTagChips();
  linkedIssues = Array.isArray(snap.linearIssues) ? snap.linearIssues.map((i) => ({ ...i })) : [];
  renderLinearChips();
}

function saveDraftNow() {
  if (!currentSessionKey) return;
  try { chrome.storage.session.set({ [currentSessionKey]: snapshotFormState() }); } catch (e) {}
}
function saveDraftDebounced() {
  clearTimeout(saveDraftTimer);
  saveDraftTimer = setTimeout(saveDraftNow, 400);
}
// Cobre todo campo de texto/select/data do formulário de uma vez (eventos
// borbulham) — empresa/tags/issues do Linear são estado próprio (arrays,
// chip), por isso salvam sozinhos nos pontos onde mudam (ver
// selectCompany/clearCompany/renderTagChips/renderLinearChips acima).
$('form').addEventListener('input', saveDraftDebounced);
$('form').addEventListener('change', saveDraftDebounced);

// Decide, pra conversa do contexto atual: existe rascunho? restaura. Não
// existe (conversa nova de verdade)? limpa e preenche com o perfil do Crisp,
// como sempre foi.
async function loadOrResetForSession(ctx) {
  const key = sessionKeyFrom(ctx);
  currentSessionKey = key;
  const draft = await loadDraft(key);
  if (draft) {
    applyFormSnapshot(draft);
  } else {
    resetCreateForm();
    applyContext(ctx, { fillCompany: true });
  }
}

// Ao abrir o painel, puxa o contexto da conversa atual.
send('getContext', {}).then((r) => { lastContext = r; loadOrResetForSession(r); });

// ---- Card de resultado da busca (Nome / Tenant / CNPJ / Cliente Novo) ----
function hideSearchResult() {
  $('searchResult').style.display = 'none';
}
function renderSearchResult(data) {
  if (!data) { hideSearchResult(); return; }
  const tenant = data.tenant && (data.tenant.name || data.tenant);
  const document = data.document || data.documento;
  const tags = Array.isArray(data.tags) ? data.tags : [];

  $('resultName').textContent = data.name || data.nome || '—';

  $('resultTenantRow').style.display = tenant ? 'flex' : 'none';
  $('resultTenant').textContent = tenant || '';

  $('resultCnpjRow').style.display = document ? 'flex' : 'none';
  $('resultCnpj').textContent = document || '';

  $('resultNewClientBadge').style.display = tags.includes('Cliente Novo') ? 'inline-flex' : 'none';

  $('searchResult').style.display = 'flex';
}

// ---- Buscar (identificar empresa na conversa atual) ----
const VALIDATE_LABEL = 'Buscar';
function setValidating(on) {
  const b = $('validate');
  b.disabled = on;
  b.textContent = on ? 'Buscando...' : VALIDATE_LABEL;
}

$('validate').addEventListener('click', async () => {
  const msg = $('validateMsg');
  msg.textContent = '';
  msg.className = 'validate-msg';
  hideSearchResult();
  setValidating(true);
  const r = await send('getContext', {});
  lastContext = r;
  setValidating(false);
  if (!r || !r.ok) {
    msg.textContent = r && r.error === 'not-crisp'
      ? 'Abra uma conversa no Crisp e tente de novo.'
      : 'Não consegui ler a conversa do Crisp.';
    msg.className = 'validate-msg warn';
    return;
  }
  if (r.found && r.data) {
    selectCompany({
      id: r.data.id,
      name: r.data.name || r.data.nome,
      document: r.data.document || r.data.documento,
      tenant: r.data.tenant,
    });
    applyContext(r, { fillCompany: false });
    renderSearchResult(r.data);
    msg.textContent = 'Empresa identificada.';
    msg.className = 'validate-msg ok';
  } else {
    applyContext(r, { fillCompany: false });
    msg.textContent = 'Nenhuma empresa identificada na conversa.';
    msg.className = 'validate-msg warn';
  }
});

// ---- Resumir com IA (Gemini) ----
// Lê as mensagens de HOJE direto do HTML da conversa aberta no Crisp (via
// tenant.js) e preenche os campos do ticket — não fala com a API do Crisp,
// só com o texto que já está na tela.
const AI_CONFIDENCE_THRESHOLD = 80;

$('summarize').addEventListener('click', async () => {
  const msg = $('summarizeMsg');
  const btn = $('summarize');
  msg.textContent = '';
  msg.className = 'validate-msg';

  let ctx = lastContext;
  if (!ctx || !ctx.websiteId || !ctx.sessionId) {
    ctx = await send('getContext', {});
    lastContext = ctx;
  }
  if (!ctx || !ctx.ok || !ctx.websiteId || !ctx.sessionId) {
    msg.textContent = 'Abra uma conversa no Crisp e tente de novo.';
    msg.className = 'validate-msg warn';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Resumindo conversa...';
  const r = await send('summarizeCrisp', {});
  btn.disabled = false;
  btn.textContent = '✨ Resumir com IA e preencher';

  const data = r && r.data;
  if (!r || !r.ok || !data || data.ok === false) {
    msg.textContent = (data && (data.error || data.reason)) || (r && r.error) || 'Não foi possível resumir a conversa.';
    msg.className = 'validate-msg warn';
    return;
  }

  if (data.subject) $('subject').value = data.subject;
  if (data.description) $('description').value = data.description;
  if (data.priority) {
    $('priority').value = data.priority;
    if (!dueDateTouched) $('dueDate').value = toInputValue(suggestDueDate(data.priority));
  }
  if (data.contact_name) $('name').value = data.contact_name;
  if (data.phone) $('phone').value = maskPhone(data.phone);
  if (data.company && data.company.id) selectCompany({ id: data.company.id, name: data.company.name });
  if (data.attendant && data.attendant.id) $('attendant').value = data.attendant.id;
  if (Array.isArray(data.tag_suggestions)) {
    // addTag() só adiciona ao ticket; se a IA sugerir uma tag que ainda não
    // existe no catálogo, precisa de createAndAddTag() pra também cadastrar
    // ela em "etiquetas" — senão a tag fica usada em tickets de verdade mas
    // nunca aparece na tela "/tags" (só lê o catálogo).
    for (const t of data.tag_suggestions) {
      const n = (t || '').trim();
      if (!n) continue;
      const existsInCatalog = tagCatalog.some((c) => c.name.toLowerCase() === n.toLowerCase());
      if (existsInCatalog) addTag(n);
      else await createAndAddTag(n);
    }
  }
  if (data.linear_search_keywords) {
    $('linear').value = data.linear_search_keywords;
    searchLinear();
  }

  // Confiança é só um aviso visual — nunca bloqueia salvar o ticket (mesma
  // regra do widget web).
  const low = [];
  if (data.contact_name && data.contact_name_confidence < AI_CONFIDENCE_THRESHOLD) low.push(`nome (${Math.round(data.contact_name_confidence)}%)`);
  if (data.phone && data.phone_confidence < AI_CONFIDENCE_THRESHOLD) low.push(`telefone (${Math.round(data.phone_confidence)}%)`);
  if (data.company && data.company.confidence < AI_CONFIDENCE_THRESHOLD) low.push(`empresa (${Math.round(data.company.confidence)}%)`);
  if (data.attendant && data.attendant.confidence < AI_CONFIDENCE_THRESHOLD) low.push(`atendente (${Math.round(data.attendant.confidence)}%)`);
  if (data.priority && data.priority_confidence < AI_CONFIDENCE_THRESHOLD) low.push(`prioridade (${Math.round(data.priority_confidence)}%)`);

  if (low.length) {
    msg.textContent = `Preenchido pela IA — confira com atenção: ${low.join(', ')}.`;
    msg.className = 'validate-msg warn';
  } else {
    msg.textContent = 'Campos preenchidos pela IA — revise antes de salvar.';
    msg.className = 'validate-msg ok';
  }
});

// ---- Criar contato do cliente (sistema web) a partir dos campos já
// preenchidos acima (nome/telefone/e-mail/empresa) — sem precisar abrir o
// sistema web e cadastrar na mão. Atendimento por "chat" normalmente não tem
// telefone (é visitante do site, não WhatsApp), então o e-mail vira
// obrigatório nesse canal — é o único jeito confiável de identificar esse
// contato depois.
function updateEmailRequiredHint() {
  const isChat = $('canal').value === 'chat';
  $('emailRequiredHint').style.display = isChat ? 'inline' : 'none';
}
$('canal').addEventListener('change', updateEmailRequiredHint);
updateEmailRequiredHint();

// Contato via WhatsApp normalmente não tem e-mail (é só o número) — o
// sistema web exige algum e-mail (é o identificador principal do contato),
// então usa esse e-mail placeholder pra esses casos. Ele NUNCA aparece no
// campo de e-mail do drawer (só entra no dado mandado pro sistema); e se o
// contato já existir com esse placeholder e depois surgir um e-mail de
// verdade (digitado no drawer numa próxima conversa), o placeholder é
// substituído pelo e-mail real — ver lógica de patch abaixo.
const WHATSAPP_PLACEHOLDER_EMAIL = 'whatsapp@zorte.com';

$('createContactBtn').addEventListener('click', async () => {
  const msg = $('createContactMsg');
  const btn = $('createContactBtn');
  msg.textContent = '';
  msg.className = 'validate-msg';

  const name = $('name').value.trim();
  const phone = $('phone').value.trim();
  const email = $('email').value.trim(); // e-mail de verdade digitado/preenchido, se houver
  const canal = $('canal').value;
  const conversationUrl = $('url').value.trim();

  if (canal === 'chat' && !email) {
    msg.textContent = 'Atendimento por chat — informe o e-mail do cliente antes de criar o contato.';
    msg.className = 'validate-msg warn';
    return;
  }
  if (!name && !phone && !email) {
    msg.textContent = 'Preencha nome, telefone ou e-mail do cliente antes de criar o contato.';
    msg.className = 'validate-msg warn';
    return;
  }

  // E-mail que efetivamente vai pro cadastro: o real, se tiver; senão o
  // placeholder do WhatsApp quando for esse o canal. A busca de duplicado
  // (abaixo) usa sempre o e-mail REAL — nunca o placeholder, que é
  // compartilhado entre vários contatos e não serve pra identificar ninguém.
  const emailForRecord = email || (canal === 'whatsapp' ? WHATSAPP_PLACEHOLDER_EMAIL : '');

  btn.disabled = true;

  // Antes de criar, verifica se já existe um contato com esse e-mail ou
  // telefone — evita duplicar quem já está cadastrado. Se achar e faltar
  // algum dado (telefone, e-mail ou empresa), completa em vez de criar de
  // novo. Passar companyId habilita o fallback do backend: mesma empresa +
  // único contato com e-mail real e sem telefone ainda conta como "já existe".
  const found = await send('findContact', { email: email || undefined, phone: phone || undefined, company_id: companyId || undefined });
  const existing = found && found.ok && found.data && found.data.data;

  if (existing) {
    const patch = {};
    if (!existing.phone && phone) patch.phone = phone;
    if (!existing.email && emailForRecord) {
      patch.email = emailForRecord;
    } else if (existing.email === WHATSAPP_PLACEHOLDER_EMAIL && email && email.toLowerCase() !== WHATSAPP_PLACEHOLDER_EMAIL) {
      // Já tinha só o placeholder do WhatsApp e agora veio um e-mail de
      // verdade — substitui.
      patch.email = email;
    }
    if (!existing.company_id && companyId) patch.company_id = companyId;
    // Link da conversa: sempre atualiza pro mais recente (ao contrário dos
    // campos acima, que só preenchem se estiverem faltando) — é o atendimento
    // atual que deve ficar salvo pra reabrir depois.
    if (conversationUrl && existing.conversation_url !== conversationUrl) patch.conversation_url = conversationUrl;

    if (Object.keys(patch).length === 0) {
      btn.disabled = false;
      msg.textContent = `Já existe um contato cadastrado com esses dados (${existing.name || 'sem nome'}).`;
      msg.className = 'validate-msg warn';
      return;
    }

    const r = await send('updateContact', { id: existing.id, patch });
    btn.disabled = false;
    if (r && r.ok) {
      msg.textContent = 'Contato atualizado com sucesso.';
      msg.className = 'validate-msg ok';
    } else {
      msg.textContent = (r && r.error) || 'Já existe um contato, mas não consegui completar os dados.';
      msg.className = 'validate-msg warn';
    }
    return;
  }

  const r = await send('createContact', {
    contact: { name: name || null, phone: phone || null, email: emailForRecord || null, company_id: companyId || null, conversation_url: conversationUrl || null },
  });
  btn.disabled = false;

  if (r && r.ok) {
    msg.textContent = 'Contato criado no sistema.';
    msg.className = 'validate-msg ok';
  } else {
    msg.textContent = (r && r.error) || 'Não foi possível criar o contato.';
    msg.className = 'validate-msg warn';
  }
});

// ---- Prioridade (SLA) + prazo sugerido ----
// Espelha frontend/src/lib/sla.ts (a extensão não pode importar módulos TS).
const SLA_HOURS = { urgente: 4, alta: 24, media: 48, baixa: 72 };

function toInputValue(iso) {
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromInputValue(v) {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}
function suggestDueDate(priority) {
  const hours = SLA_HOURS[priority] ?? SLA_HOURS.media;
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

let dueDateTouched = false;
$('dueDate').value = toInputValue(suggestDueDate($('priority').value));
$('priority').addEventListener('change', () => {
  if (!dueDateTouched) $('dueDate').value = toInputValue(suggestDueDate($('priority').value));
});
$('dueDate').addEventListener('input', () => { dueDateTouched = true; });

// ---- Issues vinculadas no Linear (múltiplas por ticket) ----
// Espelha frontend/src/components/LinearIssuePicker.tsx: chips removíveis +
// busca com debounce na API do Linear (via background.js -> backend). Sem
// LINEAR_API_KEY configurada no backend, cai pro modo manual (colar ID/URL
// e apertar Enter) — mesmo fallback do app web.
let linearConfigured = null;
let linkedIssues = []; // [{ identifier, url }]
let linearSuggestions = []; // resultado da última busca, para o Enter escolher a primeira
let linearSearchTimer;

send('getLinearStatus', {}).then((r) => {
  linearConfigured = !!(r && r.ok && r.data && r.data.configured);
  if (!linearConfigured) $('linear').placeholder = 'Cole o ID (ex.: ZOR-123) ou a URL da issue';
});

// Aceita colar o ID da issue (ex.: "ZOR-123") ou a URL completa do Linear;
// extrai o identificador de qualquer um dos dois formatos.
function parseLinearInput(raw) {
  const v = (raw || '').trim();
  if (!v) return null;
  const m = v.match(/([A-Z]{2,10}-\d+)/i);
  const identifier = m ? m[1].toUpperCase() : v;
  const url = /^https?:\/\//i.test(v) ? v : null;
  return { identifier, url };
}

function renderLinearChips() {
  const box = $('linearChips');
  box.innerHTML = '';
  for (const issue of linkedIssues) {
    const chip = document.createElement('span');
    chip.className = 'linear-chip';
    const nm = document.createElement('span');
    nm.textContent = issue.identifier;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    x.textContent = '×';
    x.addEventListener('click', () => {
      linkedIssues = linkedIssues.filter((i) => i.identifier !== issue.identifier);
      renderLinearChips();
    });
    chip.appendChild(nm);
    chip.appendChild(x);
    box.appendChild(chip);
  }
  saveDraftDebounced();
}

function addLinearIssue(issue) {
  if (!issue || !issue.identifier) return;
  if (linkedIssues.some((i) => i.identifier.toLowerCase() === issue.identifier.toLowerCase())) return;
  linkedIssues.push(issue);
  renderLinearChips();
  $('linear').value = '';
  $('linearList').style.display = 'none';
}

function renderLinearList(results) {
  const box = $('linearList');
  box.innerHTML = '';
  const selectedLower = new Set(linkedIssues.map((i) => i.identifier.toLowerCase()));
  const suggestions = results.filter((issue) => !selectedLower.has(issue.identifier.toLowerCase()));
  linearSuggestions = suggestions;
  if (!suggestions.length) { box.style.display = 'none'; return; }
  for (const issue of suggestions) {
    const item = document.createElement('div');
    item.className = 'combo-item';
    const nm = document.createElement('div');
    nm.className = 'nm';
    nm.textContent = issue.identifier;
    const mt = document.createElement('div');
    mt.className = 'mt';
    mt.textContent = issue.title + (issue.state ? ` · ${issue.state}` : '');
    item.appendChild(nm);
    item.appendChild(mt);
    item.addEventListener('mousedown', (e) => {
      e.preventDefault();
      addLinearIssue({ identifier: issue.identifier, url: issue.url });
    });
    box.appendChild(item);
  }
  box.style.display = 'block';
}

function searchLinear() {
  if (linearConfigured !== true) return;
  const q = $('linear').value.trim();
  clearTimeout(linearSearchTimer);
  linearSearchTimer = setTimeout(async () => {
    const r = await send('searchLinearIssues', { query: q });
    if (r && r.ok) renderLinearList((r.data && r.data.data) || []);
  }, 300);
}

$('linear').addEventListener('focus', searchLinear);
$('linear').addEventListener('input', searchLinear);
$('linear').addEventListener('blur', () => setTimeout(() => { $('linearList').style.display = 'none'; }, 150));
$('linear').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  if (linearConfigured && linearSuggestions[0]) {
    addLinearIssue({ identifier: linearSuggestions[0].identifier, url: linearSuggestions[0].url });
    return;
  }
  const q = $('linear').value.trim();
  if (q) addLinearIssue(parseLinearInput(q));
});

// ---- Tags (catálogo reutilizável, com criação na hora) ----
let tagCatalog = [];
let selectedTags = [];

send('getTags', {}).then((r) => {
  if (r && r.ok) tagCatalog = (r.data && r.data.data) || [];
});

function renderTagChips() {
  const box = $('tagChips');
  box.innerHTML = '';
  for (const name of selectedTags) {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';
    const nm = document.createElement('span');
    nm.textContent = name;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'x';
    x.textContent = '×';
    x.addEventListener('click', () => {
      selectedTags = selectedTags.filter((t) => t !== name);
      renderTagChips();
    });
    chip.appendChild(nm);
    chip.appendChild(x);
    box.appendChild(chip);
  }
  saveDraftDebounced();
}

function addTag(name) {
  const n = (name || '').trim();
  if (!n) return;
  if (selectedTags.some((t) => t.toLowerCase() === n.toLowerCase())) return;
  selectedTags.push(n);
  renderTagChips();
  $('tagInput').value = '';
  $('tagList').style.display = 'none';
}

async function createAndAddTag(name) {
  const n = (name || '').trim();
  if (!n) return;
  const r = await send('createTag', { tag: { name: n } });
  if (r && r.ok && r.data && r.data.data) {
    tagCatalog.push(r.data.data);
  }
  addTag(n);
}

function renderTagSuggestions() {
  const q = $('tagInput').value.trim().toLowerCase();
  const selectedLower = new Set(selectedTags.map((t) => t.toLowerCase()));
  const suggestions = tagCatalog
    .filter((t) => !selectedLower.has(t.name.toLowerCase()))
    .filter((t) => !q || t.name.toLowerCase().includes(q));
  const exactMatch = tagCatalog.some((t) => t.name.toLowerCase() === q);
  const canCreate = q.length > 0 && !exactMatch && !selectedLower.has(q);

  const box = $('tagList');
  box.innerHTML = '';
  for (const t of suggestions) {
    const item = document.createElement('div');
    item.className = 'combo-item';
    item.textContent = t.name;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); addTag(t.name); });
    box.appendChild(item);
  }
  if (canCreate) {
    const item = document.createElement('div');
    item.className = 'combo-item create';
    item.textContent = `+ Criar tag "${$('tagInput').value.trim()}"`;
    item.addEventListener('mousedown', (e) => { e.preventDefault(); createAndAddTag($('tagInput').value); });
    box.appendChild(item);
  }
  box.style.display = suggestions.length || canCreate ? 'block' : 'none';
}

$('tagInput').addEventListener('input', renderTagSuggestions);
$('tagInput').addEventListener('focus', renderTagSuggestions);
$('tagInput').addEventListener('blur', () => setTimeout(() => { $('tagList').style.display = 'none'; }, 150));
$('tagInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const q = $('tagInput').value.trim().toLowerCase();
    const selectedLower = new Set(selectedTags.map((t) => t.toLowerCase()));
    const first = tagCatalog.find((t) => !selectedLower.has(t.name.toLowerCase()) && t.name.toLowerCase().includes(q));
    if (first) addTag(first.name);
    else if (q) createAndAddTag($('tagInput').value);
  }
});

// ---- Atendentes ----
// O campo já vem preenchido com quem está logado (sabemos o id exato — não
// precisa mais casar nome por aproximação), mas continua editável: trocar
// aqui vale só para o ticket atual.
Promise.all([
  send('getAttendants', {}),
  chrome.storage.local.get({ zt_attendant: null }),
]).then(([r, { zt_attendant }]) => {
  if (!r || !r.ok) return;
  const list = ((r.data && r.data.data) || []).filter((a) => a.active !== false);
  const sel = $('attendant');
  for (const a of list) {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  }
  // Se um rascunho já tinha restaurado um atendente diferente antes desta
  // lista terminar de carregar (corrida entre os dois carregamentos), o
  // rascunho tem prioridade — senão cai no padrão de sempre (quem está logado).
  if (draftAttendantValue && list.some((a) => a.id === draftAttendantValue)) sel.value = draftAttendantValue;
  else if (zt_attendant && list.some((a) => a.id === zt_attendant.id)) sel.value = zt_attendant.id;
});

// ---- Fechar (fecha o painel lateral) ----
$('close').addEventListener('click', () => dismiss('close'));
$('cancel').addEventListener('click', () => dismiss('close'));

// ---- Submit ----
$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  showError('');
  const subject = $('subject').value.trim();
  if (!subject) { showError('Informe o assunto.'); return; }

  // Enter no formulário disparava o mesmo submit do botão "Criar ticket" sem
  // nenhuma confirmação — fácil de criar ticket por engano. window.confirm()
  // funciona tanto no painel lateral nativo quanto no iframe de fallback
  // (nenhum dos dois é sandboxed).
  if (!window.confirm('Tem certeza que deseja criar este ticket?')) return;

  const btn = $('submit');
  btn.disabled = true;
  btn.textContent = 'Salvando...';

  // Se o usuário digitou/colou algo e esqueceu de confirmar (Enter/clique),
  // aproveita na hora de enviar em vez de perder o que já tinha escrito.
  const pendingLinear = parseLinearInput($('linear').value);
  if (pendingLinear) addLinearIssue(pendingLinear);

  const ticket = {
    subject,
    description: $('description').value.trim() || null,
    url_atendimento: $('url').value.trim() || null,
    nome_contato: $('name').value.trim() || null,
    telefone_contato: $('phone').value.trim() || null,
    status: $('status').value,
    sistema: $('sistema').value,
    channel: $('canal').value,
    company_id: companyId || null,
    attendant_id: $('attendant').value || null,
    created_by: myAttendantId || null,
    priority: $('priority').value,
    due_date: fromInputValue($('dueDate').value),
    tags: selectedTags,
    linear_issue_ids: linkedIssues.map((i) => i.identifier),
    linear_issue_urls: linkedIssues.map((i) => i.url || ''),
  };

  const r = await send('createTicket', { ticket });
  if (!r || !r.ok) {
    showError(`Erro ao salvar: ${(r && r.error) || 'erro desconhecido'}`);
    btn.disabled = false;
    btn.textContent = 'Criar ticket';
    return;
  }

  const created = (r.data && r.data.data) || {};
  // Log de auditoria (não bloqueia o fluxo se falhar).
  send('createLog', { log: { action: 'create', entity: 'ticket', entity_id: created.id, details: { subject, sistema: ticket.sistema } } });

  // Ticket criado — o rascunho desta conversa não serve mais (senão a
  // próxima vez que abrir essa mesma conversa voltaria o formulário antigo).
  if (currentSessionKey) { try { chrome.storage.session.remove(currentSessionKey); } catch (e) {} }

  showSuccess(`Ticket criado: "${subject}". Fechando...`);
  btn.textContent = 'Criado ✓';
  setTimeout(() => dismiss('created', { subject }), 1200);
});
