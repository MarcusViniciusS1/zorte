// cnpj-scanner.js — módulo portátil, sem dependências.
//
// Duas partes INDEPENDENTES:
//   1) Extração de CNPJ e CPF de um texto (extract / isValid / isValidCPF /
//      format / formatCPF / onlyDigits).
//   2) Scanner de DOM (createCnpjScanner) que observa a tela e dispara quando
//      aparece um documento NOVO (CNPJ ou CPF).
//
// Dá pra levar as duas — ou só a primeira — pra qualquer extensão.
// Exposto como window.CnpjScanner (e module.exports em ambiente CommonJS).
//
// ── Uso em outra extensão ──────────────────────────────────────────────
// manifest.json:
//   "content_scripts": [{
//     "matches": ["https://SEU-SITE/*"],
//     "js": ["cnpj-scanner.js", "seu-content.js"]
//   }]
//
// seu-content.js:
//   const scanner = CnpjScanner.createCnpjScanner({
//     root: () => document.querySelector('#chat') || document.body,
//     onNew: (novos) => alert('Documento novo detectado: ' + novos.join(', ')),
//   });
//   scanner.start();
//
// Só extração pontual:
//   CnpjScanner.extract("cliente 11.222.333/0001-81, CPF 123.456.789-09 e 04252011000110");
//   // => ["11.222.333/0001-81", "123.456.789-09", "04.252.011/0001-10"]
//
// CPF em formato CRU (11 dígitos sem pontuação) só é considerado documento se
// passar na validação do dígito verificador — um número de telefone celular
// brasileiro também tem 11 dígitos, e sem essa checagem viraria falso positivo
// toda hora. CNPJ cru (14 dígitos) não tem esse problema: nada mais no domínio
// da conversa tem 14 dígitos, então o formato sozinho já basta. CPF/CNPJ já
// pontuados (com os separadores certos) são aceitos só pelo formato, igual
// sempre foi.
//
// Compatibilidade: os regex RAW usam lookbehind (?<!\d), suportado em
// Chrome/Edge modernos. Para navegadores muito antigos existe uma variante
// sem lookbehind (peça se precisar).

(function (globalScope) {
  'use strict';

  // CNPJ mascarado: XX.XXX.XXX/XXXX-XX
  const MASKED = /\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g;
  // CNPJ cru: exatamente 14 dígitos, SEM fazer parte de um número maior
  const RAW = /(?<!\d)\d{14}(?!\d)/g;

  // CPF mascarado: XXX.XXX.XXX-XX
  const MASKED_CPF = /\d{3}\.\d{3}\.\d{3}-\d{2}/g;
  // CPF cru: exatamente 11 dígitos, SEM fazer parte de um número maior
  // (mesmo formato de um celular brasileiro — por isso passa por isValidCPF
  // antes de entrar na lista, ver extract()).
  const RAW_CPF = /(?<!\d)\d{11}(?!\d)/g;

  // Só os números de uma string.
  function onlyDigits(s) {
    return String(s == null ? '' : s).replace(/\D/g, '');
  }

  // Aplica a máscara XX.XXX.XXX/XXXX-XX. Devolve null se não houver 14 dígitos.
  function format(raw) {
    const d = onlyDigits(raw);
    if (d.length !== 14) return null;
    return d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
  }

  // Aplica a máscara XXX.XXX.XXX-XX. Devolve null se não houver 11 dígitos.
  function formatCPF(raw) {
    const d = onlyDigits(raw);
    if (d.length !== 11) return null;
    return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  }

  // Calcula um dígito verificador padrão (usado por CNPJ e CPF): soma
  // ponderada dos dígitos de `base` com pesos decrescentes a partir de
  // base.length + 1, mod 11.
  function checkDigit(base) {
    let weight = base.length + 1;
    let sum = 0;
    for (let i = 0; i < base.length; i++) {
      sum += Number(base[i]) * weight--;
      if (weight < 2) weight = 9; // só entra em jogo pro CNPJ (ciclo 9..2)
    }
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  }

  // Valida os dois dígitos verificadores do CNPJ (opcional — use só pra marcar
  // ✅/⚠️; a detecção em si é por formato).
  function isValid(cnpj) {
    const d = onlyDigits(cnpj);
    if (d.length !== 14) return false;
    if (/^(\d)\1{13}$/.test(d)) return false; // rejeita 00000000000000, 11111111111111...

    const base12 = d.slice(0, 12);
    const dv1 = checkDigit(base12);
    const dv2 = checkDigit(base12 + dv1);
    return d.slice(12) === String(dv1) + String(dv2);
  }

  // Valida os dois dígitos verificadores do CPF. Ao contrário do CNPJ, esta
  // checagem É usada na detecção (ver RAW_CPF acima) — é o que separa um CPF
  // cru de um número de celular de mesmo tamanho.
  function isValidCPF(cpf) {
    const d = onlyDigits(cpf);
    if (d.length !== 11) return false;
    if (/^(\d)\1{10}$/.test(d)) return false; // rejeita 00000000000, 11111111111...

    const base9 = d.slice(0, 9);
    const dv1 = checkDigit(base9);
    const dv2 = checkDigit(base9 + dv1);
    return d.slice(9) === String(dv1) + String(dv2);
  }

  // Junta os quatro regex (CNPJ mascarado/cru + CPF mascarado/cru) num Set e
  // devolve a lista única, tudo já formatado com pontuação. CPF cru só entra
  // se passar em isValidCPF (ver nota no topo do arquivo sobre celular).
  function extract(text) {
    const t = String(text == null ? '' : text);
    const set = new Set();
    let m;

    MASKED.lastIndex = 0;
    while ((m = MASKED.exec(t)) !== null) {
      const f = format(m[0]);
      if (f) set.add(f);
    }
    RAW.lastIndex = 0;
    while ((m = RAW.exec(t)) !== null) {
      const f = format(m[0]);
      if (f) set.add(f);
    }

    MASKED_CPF.lastIndex = 0;
    while ((m = MASKED_CPF.exec(t)) !== null) {
      const f = formatCPF(m[0]);
      if (f) set.add(f);
    }
    RAW_CPF.lastIndex = 0;
    while ((m = RAW_CPF.exec(t)) !== null) {
      if (!isValidCPF(m[0])) continue;
      const f = formatCPF(m[0]);
      if (f) set.add(f);
    }

    return [...set];
  }

  // Scanner de DOM: MutationObserver (com debounce) + raiz limitada +
  // Set de "já vistos". Só dispara onNew quando surge um documento inédito.
  function createCnpjScanner(opts) {
    opts = opts || {};
    const getRoot = typeof opts.root === 'function'
      ? opts.root
      : function () { return opts.root || document.body; };
    const onNew = typeof opts.onNew === 'function' ? opts.onNew : function () {};
    const onScan = typeof opts.onScan === 'function' ? opts.onScan : null;
    const debounceMs = typeof opts.debounceMs === 'number' ? opts.debounceMs : 800;

    const seen = new Set();
    let observer = null;
    let timer = null;

    function scan() {
      const rootEl = getRoot() || document.body;
      if (!rootEl) return [];
      const text = rootEl.innerText || rootEl.textContent || '';
      const all = extract(text);
      const fresh = all.filter(function (c) { return !seen.has(c); });
      for (const c of all) seen.add(c);
      if (onScan) { try { onScan(all); } catch (e) {} }
      if (fresh.length) { try { onNew(fresh, all); } catch (e) {} }
      return all;
    }

    function scheduleScan() {
      clearTimeout(timer);
      timer = setTimeout(scan, debounceMs);
    }

    return {
      // Começa a observar e faz uma varredura inicial.
      start: function () {
        const rootEl = getRoot() || document.body;
        if (rootEl) {
          if (observer) observer.disconnect();
          observer = new MutationObserver(scheduleScan);
          observer.observe(rootEl, { childList: true, subtree: true, characterData: true });
        }
        scan();
        return this;
      },
      // Para de observar.
      stop: function () {
        if (observer) observer.disconnect();
        observer = null;
        clearTimeout(timer);
        return this;
      },
      // Zera a memória de "já vistos" (ex.: ao trocar de conversa/contexto).
      reset: function () {
        seen.clear();
        return this;
      },
      // Força uma varredura imediata (ignora o debounce).
      scan: scan
    };
  }

  const api = {
    MASKED, RAW, MASKED_CPF, RAW_CPF,
    onlyDigits, format, formatCPF, isValid, isValidCPF,
    extract, createCnpjScanner,
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (globalScope) globalScope.CnpjScanner = api;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
