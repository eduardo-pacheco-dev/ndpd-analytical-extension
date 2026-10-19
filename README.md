# NDPd Analytical (extensão Chrome — MV3)

Extensão de teste que analisa o checklist aberto no NDPd
(`*.deliveryplatform.nokia.com`) lendo diretamente o DOM da aba ativa — **sem acesso a
servidor externo**, o que permite funcionar em sistema fechado.

## Como usar

1. Recarregue a extensão em `chrome://extensions` (modo desenvolvedor → “Recarregar”).
2. Abra a tela de execução do checklist no NDPd.
3. Clique no ícone da extensão. Ao abrir, o popup **não coleta nada** (mostra apenas a
   instrução). Clique em **Coletar tudo** para percorrer **todas as seções/passos** — ele
   ativa cada item do navegador (menu lateral, wizard, abas), renderiza e volta à posição
   original.
4. Use **↻** / **Coletar tudo** para reexecutar, **Seção atual** para ler só o que está
   aberto, e **JSON** / **CSV** para exportar.

## Dashboard no popup

O popup é o próprio dashboard visual (480px), com gráficos em SVG/CSS puro, sem
bibliotecas externas:

- **barra de progresso da coleta** logo abaixo do cabeçalho: mostra o caminho atual
  (ex.: `nível 2 · 3. FCC & Baterias › 3.1 FCC`), a **porcentagem geral estimada** a partir
  da trilha de níveis (wizard → seção → ...) e ficando verde/100% ao concluir. O percentual
  **avança continuamente** enquanto cada item é ativado/lido, não só ao trocar de seção;
- **4 KPIs**: itens, aceitos, rejeitados e pendentes (em 2 colunas);
- **donut** de status com percentual de aceite e legenda;
- **barras empilhadas** de progresso por seção (aceitos/pendentes/rejeitados/outros);
- **problemas por tipo** (barras horizontais);
- lista de validações (mostra as 8 primeiras, com “mostrar todos”);
- casos de teste em cartões expansíveis (com respostas, campos e miniaturas dos anexos);
- observações e rodapé de exportação.

Ideal para print: aumente o zoom do popup se quiser letras maiores, ou use
**JSON/CSV** para os dados completos.

> Ao recarregar a extensão em `chrome://extensions`, dê **F5** na aba do NDPd. A extensão
> detecta um content script antigo e se reinjeta sozinha, mas recarregar a aba garante o
> estado limpo.

## Diagnóstico

- Console da página (F12 → Console): a extensão loga com o prefixo `[NDPd Analytical]`
  (registro do content script, cada seção/passo ativado com o motivo — `active`,
  `content-changed`, `assumed-active` — e os campos lidos).
- `window.__ndpdDiagnostics()` mostra versão, **nível externo** (seções/steps com estado ativo),
  **nível interno** (stepper/abas dentro do conteúdo), campos visíveis e **candidatos**
  (`matStepHeaders`, `tabLabels`, `roleTabs`, `tablists`, `sidebarItems` + amostra de classes) —
  útil quando algum passo não é reconhecido.
- Console do popup (clique direito no popup → Inspecionar) mostra cada tentativa de
  leitura/injeção e o resumo final.

Se a coleta não avançar entre os passos, rode no console da página:

```js
window.__ndpdDiagnostics()
```

e, se possível, colete o HTML do passo atual:

```js
copy(document.querySelector('.mat-horizontal-stepper-content, .mat-step-content, mat-tab-group')?.outerHTML)
```

## O que a análise entrega

Dependendo da tela, a extensão escolhe o modo **checklist** ou **formulário (steps/abas)**.

**Modo checklist:**

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

## Formulários com steps ou abas

Se a tela de execução não for uma checklist e sim um **formulário com passos**
(`mat-stepper`) ou **abas** (`mat-tab-group`), a extensão troca de modo automaticamente:

- percorre cada passo/aba, renderiza e lê os campos:
  - texto e texto longo (`input`/`textarea`), data, `mat-select`, `mat-radio-group`,
    `mat-checkbox` e `mat-slide-toggle`;
  - rótulo vindo de `mat-label`, `.input-label`, `label`, `placeholder` ou do título acima;
  - obrigatoriedade detectada por `[required]`, `aria-required` ou marcação `*Required`.
- **coleta em vários níveis (recursiva):** cada nível é resolvido por aninhamento no DOM —
  o navegador que aparece **primeiro** no documento é o mais externo. Assim funciona tanto
  `wizard externo → checklist interna` quanto `checklist externa → stepper interno`, e
  rotula cada folha como `Passo › Seção › ...`;
- KPIs: **Passos**, **Campos**, **Preenchidos** e **Vazios**;
- donut de **preenchimento** e barras de **progresso por passo**
  (preenchidos / obrigatórios vazios / opcionais vazios);
- validações: campo obrigatório vazio, seleção não preenchida, anexos rejeitados/sem nome,
  passo que não carregou e passo sem campos identificados;
- export CSV no modo formulário usa as colunas
  `Passo; Campo; Tipo; Obrigatorio; Preenchido; Valor; Problemas`.

O mesmo botão **Coletar tudo** funciona nos dois modos; **Seção atual** lê apenas o passo/seção
aberto. `window.__ndpdDiagnostics()` mostra qual modo foi detectado (níveis `outer` e `inner`).

## Coleta de todas as seções (checklist)

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
| `popup.html` / `popup.js` | Interface em popup: dashboard, gráficos e exportações. |

## Permissões

- `activeTab` + `scripting`: injetar/consultar a aba do NDPd.
- `host_permissions` restrito a `https://*.deliveryplatform.nokia.com/*` (permite ler a URL
  da aba e injetar o content script sem depender do gesto do usuário).
- Nenhuma chamada de rede é feita pela extensão.
