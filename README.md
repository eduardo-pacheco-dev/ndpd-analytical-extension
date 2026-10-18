# NDPd Analytical (extensão Chrome — MV3)

Extensão de teste que analisa o checklist aberto no NDPd
(`*.deliveryplatform.nokia.com`) lendo diretamente o DOM da aba ativa — **sem acesso a
servidor externo**, o que permite funcionar em sistema fechado.

## Como usar

1. Recarregue a extensão em `chrome://extensions` (modo desenvolvedor → “Recarregar”).
2. Abra a tela de execução do checklist no NDPd e expanda a seção desejada.
3. Clique no ícone da extensão. O popup analisa a aba automaticamente.
4. Use **↻** ou **Analisar** para reanalisar e **JSON** / **CSV** para exportar.

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

## Limitação importante

O Angular renderiza **somente a seção ativa** no DOM. As demais seções aparecem apenas no
menu lateral com a contagem — por isso elas são listadas como “não renderizadas”, e a
validação item a item cobre apenas a seção aberta no momento da análise.

## Arquivos

| Arquivo       | Papel                                                            |
| ------------- | ---------------------------------------------------------------- |
| `manifest.json` | MV3, `activeTab` + `scripting`, content script no domínio NDPd. |
| `analyzer.js` | Extração e validações (função pura sobre o DOM).                 |
| `content.js`  | Ponte de mensagens entre popup e página.                         |
| `popup.html` / `popup.js` | Interface, relatório e exportações.                 |

## Permissões

- `activeTab` + `scripting`: injetar/consultar apenas a aba em que o usuário clicou.
- Sem `host_permissions` amplas e sem chamadas de rede.
