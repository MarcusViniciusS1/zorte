# Crisp - Etiqueta Última Mensagem do Cliente

**Versão atual: 4.0.9**

Extensão do Chrome (Manifest V3) para uso da equipe da Zorte Tecnologia no
`app.crisp.chat`. Toda a detecção é feita 100% pela interface (DOM) do
Crisp — não usa a API do Crisp nem qualquer conexão externa.

## O que a extensão faz atualmente

- **Círculo de status colorido:** o círculo de ação de cada conversa na
  lista fica com uma cor personalizável quando o cliente ainda está sem
  retorno do suporte, e outra cor (também personalizável) quando o suporte
  já respondeu.
- **Etiqueta "atribuído a mim":** ao escolher seu nome no menu da extensão
  (Marcus M, Artur R, Nilo, Arthur F ou Felipe), as conversas atribuídas a
  você ganham a etiqueta "🚨 {seu nome}" no lugar do texto nativo de
  responsável.
- **Janela de 24h para responder (estilo WhatsApp):** mostra quantas horas
  faltam (só quando faltam menos de 5h e o cliente está aguardando) ou uma
  bolinha vermelha com "✕" quando a janela de 24h já expirou (nesse caso
  aparece para qualquer conversa parada há 24h+, não importa quem falou por
  último). Funciona com o Crisp em português, inglês, espanhol, francês ou
  alemão, e em qualquer ordenação da lista.
- **Barra de resumo no topo da lista:** total de conversas, quantas estão
  atribuídas a você e quantas estão aguardando retorno.
- **Ícones de canal coloridos:** WhatsApp em verde oficial, chat do site em
  azul Crisp.
- **Esconde marcações de "@" presas:** remove o indicador de menção que
  ficava preso na conversa mesmo depois de lida/resolvida.
- **Bloqueio de finalização com atendente atribuído:** ao tentar finalizar
  uma conversa (pelo círculo da lista ou pelo botão "Não resolvida" no topo
  da conversa aberta) que ainda tem um atendente atribuído, mostra um aviso
  com o nome da pessoa e só deixa finalizar depois de remover a atribuição.
- **Etiqueta de empresa (segmento):** destaca em branco (borda + ícone 🏢) o
  segmento/empresa do cliente, tanto na lista quanto no bloco "Segmentos de
  conversa" da conversa aberta. Na conversa aberta também tem um botão de
  copiar ao lado, que copia o nome exato da empresa para colar na busca do
  sistema interno.
- **Menu da extensão (popup):** mostra se a extensão está detectando o
  Crisp na aba atual, a versão instalada, um botão "Atualizar extensão"
  (recarrega os arquivos após um `git pull`) e um aviso único de "Atualizado
  para a versão X" depois de uma atualização.
- **Logo da Zorte** no topo do menu e como ícone da extensão (arquivo em
  `IMG/logo.png`, substituível pela logo real).

## Instalar

1. Baixe e extraia esta pasta em qualquer lugar do computador.
2. Acesse `chrome://extensions`, ative o "Modo do desenvolvedor" (canto
   superior direito).
3. Clique em "Carregar sem compactação" e selecione a pasta extraída.
4. Abra o `app.crisp.chat` normalmente - a extensão passa a atuar sozinha.

## Configurar

Clique no ícone da extensão na barra do Chrome para abrir o menu:

- **Quem é você?** escolha seu nome para ganhar a etiqueta de atribuição.
- **Cor sem retorno / com retorno:** personalize as cores do círculo de
  ação.
- **Atualizar extensão:** usa depois de um `git pull`, sem precisar ir até
  `chrome://extensions` recarregar manualmente.

## Atualizando via GitHub (git pull)

Cada colega clona/baixa esta pasta uma vez e carrega como extensão
"descompactada". Quando sair uma versão nova:

1. Rode `git pull` na pasta.
2. Clique em "Atualizar extensão" no menu da extensão.

A extensão detecta a mudança de versão sozinha e mostra um aviso confirmando
para qual versão foi atualizada.

## Se algo aparecer errado

Se alguma cor, etiqueta ou contagem aparecer errada em algum chat
específico, me avise qual conversa e o que apareceu, com o outerHTML do
elemento em questão (DevTools > botão direito > Inspecionar > Copy
outerHTML) para eu corrigir com precisão - foi assim que resolvemos todos
os ajustes até agora.

## Limitações conhecidas

- O atalho de teclado `Ctrl+Alt+R` para finalizar uma conversa não é
  interceptado pelo bloqueio de finalização (só cobre clique do mouse).
- A janela de 24h é uma aproximação baseada no horário que o próprio Crisp
  mostra na lista (não há acesso direto ao timestamp exato da última
  mensagem do cliente via DOM).
- O mapeamento de nomes dos 5 operadores é fixo no código; se a equipe
  mudar, precisa de um ajuste manual.
- A logo em `IMG/logo.png` ainda é um placeholder - substitua pelo arquivo
  real da logo da Zorte.

## Histórico de atualizações

- **4.0.9** - Corrige o botão de copiar da etiqueta de empresa: um seletor
  genérico demais fazia o botão aparecer duplicado ou até dentro da caixa
  de resposta de mensagens. Agora só atua nos dois lugares certos (lista e
  "Segmentos de conversa"), com limpeza automática de qualquer sobra.
- **4.0.8** - Etiqueta de empresa: depois de testar (e remover) uma versão
  com nome/cor personalizáveis por clique - que acabou complicando o uso e
  quebrando o layout com múltiplos segmentos - a versão final ficou mais
  simples: etiqueta branca com ícone 🏢, botão de copiar com ícone fixo
  (SVG, não depende de fonte de emoji do sistema) posicionado fora da
  etiqueta para não sobrepor o "x" nativo de remover segmento.
- **4.0.7** - Etiqueta de empresa (segmento) destacada com a cor do próprio
  Crisp na lista e na conversa aberta, com botão de copiar o nome da
  empresa.
- **4.0.6** - Esconde o indicador de menção (@) que ficava preso na linha da
  conversa mesmo depois de resolvida.
- **4.0.5** - Bloqueio de finalização passou a cobrir também o botão "Não
  resolvida" no topo da conversa aberta (antes só cobria o círculo da
  lista).
- **4.0.4** - Bloqueio de finalização: ao tentar finalizar uma conversa com
  atendente atribuído, mostra um aviso com o nome e só permite finalizar
  depois de remover a atribuição.
- **4.0.3** - X vermelho e contagem da janela de 24h passam a funcionar em
  qualquer ordenação da lista (Mais Recentes ou Maior Tempo de Espera).
- **4.0.2** - Leitor de horário passa a suportar português, inglês,
  espanhol, francês e alemão, com diagnóstico no popup para formatos ainda
  não reconhecidos.
- **4.0.1** - Corrige configurações que não valiam imediatamente após
  salvar: o script órfão se desliga sozinho e a extensão se reinjeta nas
  abas abertas do Crisp após uma atualização, sem precisar de F5.
- **4.0.0** - Fechamento do ciclo 4.0: círculo de status, etiqueta de
  atribuição (sirene 🚨), janela de 24h (urgente <5h e X expirado),
  contadores no topo, cores por canal, botão "Atualizar extensão" com aviso
  de versão, e logo em `IMG/logo.png`.
- **3.9.0** - Botão "Atualizar extensão" no popup, para recarregar os
  arquivos depois de um `git pull`.
- **3.8.0** - X vermelho passa a aparecer para qualquer conversa parada há
  24h ou mais, mesmo já respondida; a contagem urgente (<5h) fica só para
  quem está aguardando.
- **3.7.0** - Contagem regressiva só aparece faltando menos de 5h para
  estourar a janela de 24h; quando expira, mostra X vermelho.
- **3.6.0** - Etiqueta de atribuição passa a usar o emoji de sirene 🚨 (era
  uma mãozinha 🤚🏻); corrige a contagem de 24h não zerando depois de responder.
- **3.5.0** - Corrige a detecção de "sem retorno": passa a usar a setinha de
  resposta na prévia da mensagem (sinal real de quem falou por último), em
  vez do bloco "aguardando desde" que aparece em qualquer conversa não
  resolvida.
- **3.4.0** - Barra de contadores no topo da lista (total / minhas /
  aguardando) e proteção contra o erro "extension context invalidated".
- **3.3.0** - Linhas passam a ser localizadas pela classe real do Crisp
  (corrige círculo sem cor); ícones de canal coloridos (WhatsApp verde,
  chat azul).
- **3.2.0** - Usa o seletor real do círculo de estado do Crisp (corrige a
  etiqueta de contagem sendo pintada de amarelo por engano).
- **3.1.0** - Etiqueta de contagem de 24h ganha paleta própria (fundo
  escuro neutro), sem conflito visual com a cor do círculo de ação.
- **3.0.0** - Passa a usar o indicador nativo "aguardando desde" do Crisp
  para detectar conversas sem retorno (mais confiável que a heurística por
  ícone usada até então).
- **2.8.0** - Mostra quantas horas faltam (ou X vermelho se já expirou) da
  janela de 24h para responder.
- **2.7.0** - Contagem/expiração da janela de 24h passa a cobrir também
  "Ontem", dias da semana e datas.
- **2.6.0** - Primeira versão com a contagem regressiva da janela de 24h
  para responder.
- **2.5.0** - Corrige caracteres invisíveis no nome do responsável (o motivo
  pelo qual a etiqueta de atribuição não batia para todos os operadores).
- **2.4.0** - Substitui o texto nativo de responsável por uma etiqueta azul
  clara quando a conversa está atribuída a você.
- **2.3.0** - Primeira versão com a etiqueta de "atribuído a mim".
- **2.2.0** - Passa a recolorir o círculo de ação de cada conversa (cor
  personalizável sem retorno / verde com retorno), em vez de uma etiqueta
  flutuante separada.
- **2.1.0 / 2.0.0** - Primeiras versões: destacam a conversa quando a última
  mensagem foi do cliente (por texto e por ícone de resposta), 100% via DOM,
  sem uso da API do Crisp, com indicador de status e etiqueta personalizável.
