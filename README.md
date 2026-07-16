# Extensao Crisp: status por cor + atribuicao + janela de 24h

Tres funcoes, todas detectadas localmente na tela do Crisp (sem nenhuma API
externa):

1. **Circulo de status:** recolore o botao de acao redondo de cada conversa
   - cor personalizavel quando o cliente esta sem retorno do suporte, verde
   quando o suporte ja respondeu.
2. **Etiqueta "atribuido a mim":** quando a conversa esta marcada para o
   operador que voce selecionou no popup, aparece uma etiqueta azul
   clarinha "🚨 Nome" ao lado do nome do contato.
3. **Janela de 24h:** para conversas sem retorno do suporte, mostra quanto
   tempo ainda resta antes de nao ser mais possivel responder livremente
   (regra comum em integracoes com WhatsApp) - verde, amarelo (ate 6h) ou
   "janela expirada" em vermelho.

## Como funciona

- **Sem retorno / com retorno:** o Crisp tem uma classe propria,
  `c-conversation-menu-item-headline__waiting-since`, que so aparece quando
  a conversa esta mesmo aguardando resposta do suporte (com tooltip
  "Aguardando desde: Xh"). A extensao usa esse indicador nativo diretamente
  - nao depende mais de adivinhar por seta/icone de resposta.
- **Atribuido a mim:** o Crisp marca o responsavel pela conversa com a
  classe `c-conversation-menu-item-headline__assignee` (confirmada via
  DevTools). A extensao le o nome ali, compara com o que voce selecionou em
  "Quem e voce?" e, se bater, esconde o texto cinza nativo e coloca no lugar
  a etiqueta azul "🚨 Nome".

## Correcao de caracteres invisiveis (v2.5)

O Crisp preenche o texto do responsavel truncado com caracteres invisiveis
(soft hyphen, zero-width space, "Braille pattern blank") para caber no
espaco disponivel. A extensao agora remove esses caracteres antes de
comparar o nome, e usa comparacao "comeca com" em vez de igualdade exata
(pois nomes longos truncados, como "Joao Nilo" -> "Joao Nil.", nao ficam
identicos ao nome completo).

Alem disso, o texto que o Crisp mostra nem sempre e o apelido que a equipe
usa. Por exemplo, o Crisp mostra "Joao" para quem a equipe chama de "Nilo" -
a extensao ja sabe disso e faz a correspondencia certa por baixo dos panos,
mas a etiqueta continua mostrando o apelido escolhido no popup ("🚨Nilo").

Se algum outro colega tiver esse mesmo tipo de diferenca (apelido != nome
que aparece no Crisp), me avise qual e o texto exato mostrado (copie o
outerHTML do `<span class="c-conversation-menu-item-headline__assignee">`
dele) que eu ajusto o mapeamento.

## Janela de 24h para responder

Em integracoes com WhatsApp, depois de 24h desde a ultima mensagem do
cliente sem resposta do suporte, normalmente nao e mais possivel mandar
mensagem livre (so modelos pre-aprovados). A extensao calcula esse prazo
a partir do horario que o proprio Crisp mostra na lista (ex: "14h" =
14 horas atras) e exibe uma etiqueta ao lado do horario:

- **Nada aparece** enquanto ainda sobram 5h ou mais - sem poluicao visual.
- **"Xh" (urgente):** faltando menos de 5h, mostra quantas horas restam.
- **Circulo vermelho com "✕":** a janela de 24h ja expirou (passe o mouse
  para ver o detalhe).

A extensao reconhece os formatos de horario que o Crisp usa em portugues e
em ingles: minutos/horas ("25m", "19h", "3 hrs"), "Agora"/"now",
"Hoje"/"Today", "Ontem"/"Yesterday", nomes de dia da semana ("terça-feira",
"Monday") e datas ("13 Jul", "5 Aug"). Os formatos de ontem/dia da
semana/data sao sempre tratados como janela ja expirada (com certeza mais
de 24h corridas). Importante: o texto depende do idioma da interface de
CADA operador - por isso e essencial esse suporte duplo.

Essa contagem so aparece nas conversas marcadas como "sem retorno"
(circulo colorido), porque so nesse caso o horario mostrado na lista
corresponde exatamente ao momento da ultima mensagem do cliente. Quando o
suporte ja respondeu, o horario mostrado passa a ser o da resposta do
suporte, entao nao da pra calcular a janela do cliente so pela lista.

### Se algum chat nao ficar colorido (fica com a cor vermelha nativa do Crisp)

Isso indica que o horario daquela linha veio num formato que a extensao
ainda nao reconhece. Me avise qual texto de horario apareceu (ex: um nome
de mes abreviado diferente, "amanha", etc.) que eu adiciono o formato.

## Instalar no Chrome

1. Extraia o `.zip` em uma pasta.
2. Abra `chrome://extensions`.
3. Ative "Modo do desenvolvedor" (canto superior direito).
4. Clique em "Carregar sem compactacao" e selecione a pasta extraida (a que
   tem o `manifest.json`).
5. Abra o Crisp normalmente em `app.crisp.chat`.

## Configurar

Clique no icone da extensao na barra do Chrome:

- **Logo no topo:** identifica a extensao como sendo da Zorte.
- **Quem e voce?** escolha seu nome (Marcus M, Artur R, Nilo, Arthur F ou
  Felipe) para que as conversas atribuidas a voce ganhem a etiqueta azul.
- **Cor sem retorno / com retorno:** personalize as cores do circulo de
  acao.

## Se algo aparecer errado

A deteccao de "sem retorno" agora usa a classe nativa do Crisp
(`c-conversation-menu-item-headline__waiting-since`), entao e bem mais
estavel que a versao anterior baseada em icone/seta. Se mesmo assim algo
aparecer errado (cor trocada, etiqueta faltando), me avise qual conversa e
o que apareceu, com o outerHTML do elemento em questao (DevTools > botao
direito > Inspecionar > Copy outerHTML) para eu corrigir com precisao.

## Logo da empresa

A logo exibida no topo do popup e carregada de `IMG/logo.png`. O arquivo
atual e um placeholder - substitua-o pela logo real da empresa (mesmo nome
de arquivo, formato PNG) e clique em "Atualizar extensao" no popup. Os
icones da barra do Chrome ficam em `icons/` (icon16/48/128.png) e tambem
podem ser substituidos pelos arquivos reais, mantendo os nomes e tamanhos.

## Aviso de versao ao atualizar

Ao clicar em "Atualizar extensao" (apos um `git pull`), a extensao rele os
arquivos da pasta. Na proxima vez que o popup for aberto, ele mostra
"Atualizado para a versao X.Y.Z" (uma unica vez) e a versao atual aparece
sempre ao lado do nome, no topo.

## Atualizando via GitHub (git pull)

Fluxo recomendado para o time:

1. Publique esta pasta num repositorio (ex: GitHub privado da empresa).
2. Cada colega clona o repositorio e, no `chrome://extensions`, carrega a
   extensao "sem compactacao" apontando para a pasta clonada.
3. Para atualizar: `git pull` na pasta e, em seguida, clique no botao
   **"Atualizar extensao"** no popup da extensao - ele rele os arquivos da
   pasta na hora, sem precisar abrir o gerenciador de extensoes.
4. A partir da v4.0.1, nao e mais preciso dar F5: ao atualizar, a extensao
   desliga o script antigo e reinjeta o novo automaticamente nas abas do
   Crisp que estiverem abertas.

## Cada colega instala a sua propria copia

Cada pessoa deve instalar a extensao no proprio Chrome (repita o passo
"Instalar no Chrome" acima) e escolher o proprio nome no popup - a etiqueta
azul so aparece para quem esta com o nome certo selecionado. As
configuracoes ficam salvas localmente em cada navegador (chrome.storage,
sincronizado pela conta Google se o Chrome Sync estiver ativado).

## Limitacoes

- A deteccao de "sem retorno" e "atribuido a mim" usa classes reais do
  Crisp, entao e estavel - mas se o Crisp renomear essas classes num
  futuro update, a extensao para de funcionar ate eu atualizar os
  seletores.
- A extensao roda apenas com as paginas abertas (nao funciona em segundo
  plano quando o Crisp esta fechado).
- O casamento de nomes para a etiqueta "atribuido a mim" usa o primeiro
  nome (ex: "Artur" ou "Arthur") - names duplicados com o mesmo primeiro
  nome podem gerar falso positivo (nao e o caso da lista atual: Marcus,
  Artur, Nilo, Arthur e Felipe sao todos distintos).
