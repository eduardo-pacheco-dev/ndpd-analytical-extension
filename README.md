# NDPd Analytical (extensão Chrome — MV3)

Extensão de teste que analisa o checklist aberto no NDPd
(`*.deliveryplatform.nokia.com`) lendo diretamente o DOM da aba ativa — **sem acesso a
servidor externo**, o que permite funcionar em sistema fechado.

## Como usar

1. Recarregue a extensão em `chrome://extensions` (modo desenvolvedor → “Recarregar”).
2. Abra a tela de execução do checklist no NDPd.
3. Clique no ícone da extensão. O popup coleta **todas as seções** automaticamente
   (ele percorre o menu lateral, renderiza cada seção e volta para a seção original).
4. Use **↻** / **Coletar tudo** para reexecutar, **Seção atual** para ler só o que está
   aberto, e **JSON** / **CSV** para exportar.

> Ao recarregar a extensão em `chrome://extensions`, dê **F5** na aba do NDPd. A extensão
> detecta um content script antigo e se reinjeta sozinha, mas recarregar a aba garante o
> estado limpo.

## Diagnóstico

- Console da página (F12 → Console): a extensão loga com o prefixo `[NDPd Analytical]`
  (registro do content script, cada seção ativada, itens lidos e total).
- No console da página você pode rodar `window.__ndpdDiagnostics()` para ver versão do
  content script, se a página foi reconhecida, seções encontradas e a seção ativa.
- Console do popup (clique direito no popup → Inspecionar) mostra cada tentativa de
  leitura/injeção e o resumo final.

## O que a análise entrega

- **Resumo (inventário):** seções, itens, aceitos, rejeitados, pendentes e anexos.
- **Validações:**
  - item obrigatório sem aceite/rejeição;
  - item pendente / rejeitado;
  - pergunta (rádio) sem opção selecionada;
  - campo obrigatório vazio (apenas campos editáveis);
  - evidência fotográfica sem anexo;
  - anexo rejeitado, sem nome ou com nome duplicado;
  - divergência entre a contagem do menu lateral (`9/10`) e o DOM da seção ativa.
- **Detalhe por caso de teste:** status, obrigatoriedade, resposta do rádio, campos
  preenchidos, anexos (com miniatura) e problemas.
- **Exportação:** JSON completo e CSV (separador `;`, com BOM para Excel pt-BR).

## Coleta de todas as seções

O Angular renderiza **somente a seção ativa** no DOM. Para coletar tudo, o content script:

1. lê a lista de seções do menu lateral (`app-checklist-side-sections`);
2. clica em cada seção, aguarda o conteúdo renderizar e ficar estável;
3. extrai os casos de teste daquele momento;
4. ao final, reativa a seção que estava aberta antes da coleta.

Se alguma seção não puder ser carregada, ela é registrada como
“Não foi possível carregar a seção … para coleta” nas validações, e as demais são
coletadas normalmente. Para conferir contra a contagem do menu lateral, a extensão
compara o `badge` (ex.: `10/10`) com o que foi lido no DOM de cada seção.

## Arquivos

| Arquivo       | Papel                                                            |
| ------------- | ---------------------------------------------------------------- |
| `manifest.json` | MV3, `activeTab` + `scripting`, content script no domínio NDPd. |
| `analyzer.js` | Extração e validações (função pura sobre o DOM).                 |
| `content.js`  | Ponte de mensagens entre popup e página.                         |
| `popup.html` / `popup.js` | Interface, relatório e exportações.                 |

## Permissões

- `activeTab` + `scripting`: injetar/consultar a aba do NDPd.
- `host_permissions` restrito a `https://*.deliveryplatform.nokia.com/*` (permite ler a URL
  da aba e injetar o content script sem depender do gesto do usuário).
- Nenhuma chamada de rede é feita pela extensão.
