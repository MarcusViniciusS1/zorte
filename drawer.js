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
  if (EMBEDDED) {
    try { window.parent.postMessage({ source: 'zt-drawer', type: type || 'close', ...(extra || {}) }, '*'); } catch (e) {}
  } else {
    window.close();
  }
}

// ---- Ponte com o background ----
function send(action, extra) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ action, ...extra }, (r) => {
      if (chrome.runtime.lastError) return resolve({ ok: false, error: chrome.runtime.lastError.message });
      resolve(r || { ok: false, error: 'sem resposta' });
    });
  });
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
}

function selectCompany(c) {
  if (!c || !c.id) return;
  companyId = c.id;
  $('companyChipName').textContent =
    c.name + (c.tenant ? ` · ${c.tenant}` : c.document ? ` · CNPJ ${c.document}` : '');
  $('companyChip').style.display = 'flex';
  $('company').style.display = 'none';
  $('companyList').style.display = 'none';
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
  }
}

// Ao abrir o painel, puxa o contexto da conversa atual.
send('getContext', {}).then((r) => applyContext(r, { fillCompany: true }));

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
send('getAttendants', {}).then((r) => {
  if (!r || !r.ok) return;
  const list = (r.data && r.data.data) || [];
  const sel = $('attendant');
  for (const a of list) {
    if (a.active === false) continue;
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.name;
    sel.appendChild(opt);
  }
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

  showSuccess(`Ticket criado: "${subject}". Fechando...`);
  btn.textContent = 'Criado ✓';
  setTimeout(() => dismiss('created', { subject }), 1200);
});
