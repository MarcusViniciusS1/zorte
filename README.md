# Zorte Crisp — Atendimento e Etiquetas (unificada)

**Versão: 5.0.0**

Junção de duas extensões que atuavam no `app.crisp.chat`, agora em uma só —
sem perder nenhuma função:

## Vem da "Etiqueta Última Mensagem" (penetra)
Atua na **lista de conversas** (100% via DOM):
- Círculo de status colorido (sem retorno / respondido) — cores configuráveis.
- Etiqueta "🚨 {seu nome}" nas conversas atribuídas a você.
- Janela de 24h (contagem <5h e "✕" quando expira), multi-idioma.
- Barra de resumo no topo (total / minhas / aguardando).
- Ícones de canal coloridos (WhatsApp verde, chat azul).
- Esconde marcações "@" presas.
- Bloqueio de finalização com atendente atribuído.
- Etiqueta de empresa (segmento) + botão de copiar o nome.
- Badge no ícone da extensão com nº de conversas aguardando.

Arquivos: `crisp-ui.js`, `content.css`.

## Vem da "Tenant Finder" (extenção)
- Botão flutuante **"+ Registrar atendimento"** que abre o **painel lateral
  (Side Panel)** do navegador — não tampa o Crisp.
- Identifica a empresa da conversa (perfil, tags, segmento/employment) e valida
  no sistema interno (backend em `http://localhost:3001`).
- Formulário de ticket no painel: assunto, contato, telefone, URL, descrição,
  status, sistema (Z=Zorte / L=Lonngren), canal (Chat/WhatsApp/...), empresa,
  atendente, tags.
- Popup: Validar Atendimento, Abrir Atendimento (nova aba), Testar Conexão.

Arquivos: `tenant.js`, `drawer.html`, `drawer.js`.

## Estrutura
- `manifest.json` — MV3, 1 service worker (`background.js`), 1 popup
  (`popup.html`/`popup.js`), 2 content scripts, `side_panel`.
- Os dois content scripts rodam no mesmo contexto sem colisão de nomes.
- `crisp-ui.js` roda em `app.` e `chat.crisp.chat`; `tenant.js` só em `app.`.

## Instalar
1. `chrome://extensions` → Modo do desenvolvedor.
2. "Carregar sem compactação" → selecione a pasta `extensao-unificada`.
3. Abra o `app.crisp.chat`. Para o registro/painel, tenha o backend rodando
   na porta 3001.

## Observações
- Substitui as pastas `extension/`, `extenção/` e `penetra/` (podem ser
  removidas após confirmar que a unificada funciona).
- Regra do projeto: a cada alteração de script, subir a `version` no manifest.
