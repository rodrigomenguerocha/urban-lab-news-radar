# P3 Real Estate News Agent — MVP

Agente que lê feeds RSS de notícias imobiliárias, usa a API do Claude para decidir se
cada artigo trata de um **projeto imobiliário P3** (Parceria Público-Privada) e extrai os
dados do projeto em JSON estruturado.

```
feeds RSS  →  dedupe + pré-filtro  →  Claude (classifica + extrai)  →  p3_projects.json
```

## Arquivos

| Arquivo | O que é |
|---|---|
| `p3_news_agent.py` | o agente completo, arquivo único e executável |
| `requirements.txt` | dependências |
| `feeds.txt` | lista de feeds RSS de teste (10 feeds verificados) |
| `p3_projects.json` | **gerado** — projetos P3 acumulados entre execuções |
| `.seen_articles.json` | **gerado** — cache de URLs já analisadas |

---

## 1. Instalação

O SDK `anthropic` 1.x exige **Python 3.10+**. A máquina atual tem apenas o Python 3.9.6
do sistema, então instale uma versão mais nova antes de começar:

```bash
brew install python@3.12
```

Depois, no diretório do projeto:

```bash
python3.12 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt
```

## 2. Chave da API

Pegue a chave em <https://console.anthropic.com/settings/keys> e exporte-a:

```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

Para não repetir isso a cada sessão, adicione a linha ao seu `~/.zshrc`. O script não
recebe a chave por parâmetro de propósito — assim ela não fica no histórico do shell nem
em commits. Alternativa: `ant auth login`, que grava um perfil em `~/.config/anthropic/`
e é lido automaticamente pelo SDK.

## 3. Execução

```bash
python p3_news_agent.py --feeds feeds.txt
```

Antes da primeira rodada paga, veja o que seria analisado sem gastar nada:

```bash
python p3_news_agent.py --feeds feeds.txt --dry-run
```

### Opções

| Flag | Padrão | Para que serve |
|---|---|---|
| `--feeds ARQ` | feeds embutidos | arquivo com uma URL de RSS por linha |
| `--limit N` | `15` | máximo de artigos por feed (principal controle de custo) |
| `--model ID` | `claude-sonnet-5` | modelo do Claude |
| `--min-confidence F` | `0.6` | confiança mínima para o projeto entrar no JSON |
| `--max-chars N` | `4000` | corte do texto do artigo enviado à API |
| `--output ARQ` | `p3_projects.json` | destino do JSON |
| `--no-prefilter` | desligado | manda todo artigo à API, sem o filtro de palavras-chave |
| `--no-cache` | desligado | reanalisa artigos já vistos |
| `--dry-run` | desligado | só coleta e pré-filtra; não chama a API |
| `-v` | desligado | log detalhado |

---

## 4. Como funciona

**Coleta.** `feedparser` lê cada feed com user-agent de navegador (vários portais
devolvem 403 para user-agent de biblioteca). Falha em um feed gera aviso no log e a
execução continua.

**Deduplicação.** Artigos repetidos entre feeds são descartados na mesma rodada, e
`.seen_articles.json` guarda o que já foi analisado — reexecutar não paga duas vezes pelo
mesmo artigo. Artigos cuja análise falhou **não** entram no cache: são tentados de novo.

**Pré-filtro.** Um regex amplo (~28 padrões: `public-private`, `P3`, `RFP`, `ground
lease`, `city-owned`, `housing authority`, `transit agency`…) descarta antes da API o que
não tem nenhum sinal de P3. Nos testes ele cortou ~70% dos artigos. É deliberadamente
generoso: um falso positivo custa uma chamada, um falso negativo perde a notícia. Use
`--no-prefilter` para medir o que ele está descartando.

**Classificação e extração.** Uma chamada por artigo, com `client.messages.parse()` e
*structured outputs* — o formato JSON é imposto pela API e validado pelo Pydantic, em vez
de depender de o modelo "lembrar" de responder só JSON. Se a API rejeitar o schema, o
script cai automaticamente para JSON via prompt + validação local (o contrato JSON está
escrito no system prompt de qualquer forma).

**Saída.** Terminal formatado + `p3_projects.json`, que acumula entre execuções com a URL
como chave (reanálises sobrescrevem). A gravação é atômica, via arquivo temporário.

### Critério de P3 aplicado pelo modelo

Só é P3 quando o artigo nomeia explicitamente **(a)** uma entidade pública (prefeitura,
condado, estado, autoridade de habitação, agência de trânsito, autoridade portuária,
distrito escolar, universidade ou hospital público, agência de redesenvolvimento, land
bank), **(b)** um desenvolvedor ou investidor privado e **(c)** um vínculo imobiliário
concreto entre os dois (acordo de desenvolvimento, cessão ou concessão de terreno,
ground lease, joint development, direitos aéreos). Exceção: RFP/edital ativo sem
vencedor definido conta, com `private_partner: null` e estágio `"RFP/Edital"`.

Ficam de fora: obra pública convencional, só incentivo fiscal ou TIF, transação
exclusivamente privada, infraestrutura sem componente imobiliário e artigo de
opinião/tendência que cita "public-private partnership" de forma genérica.

O conteúdo do artigo vai dentro de `<artigo>` com instrução explícita de tratá-lo como
dado, não como comando — isso barra tentativa de *prompt injection* vinda de um feed.

### Formato de saída

```json
{
  "is_p3": true,
  "confidence": 0.93,
  "project_name": "South Miami City Hall Redevelopment",
  "location": { "city": "South Miami", "state": "FL" },
  "public_partner": "City of South Miami",
  "private_partner": "13th Floor Investments",
  "project_stage": "RFP/Edital",
  "estimated_value_usd": "$300 million",
  "summary": "A cidade avalia proposta para redesenvolver o terreno da prefeitura...",

  "article_title": "South Miami could award development deal for City Hall",
  "article_url": "https://news.google.com/rss/articles/CBMi...",
  "source": "The Business Journals",
  "feed": "\"P3\" \"ground lease\" city developer - Google News",
  "headline_only": true,
  "published": "Fri, 04 Sep 2026 19:58:00 GMT",
  "analyzed_at": "2026-09-10T11:42:03+00:00",
  "model": "claude-sonnet-5"
}
```

Os campos abaixo da linha em branco são metadados adicionados pelo script; os de cima
são exatamente o contrato pedido para a IA.

---

## 5. Limitação importante: feeds de agregador só trazem a manchete

O Google News entrega **apenas o título** e uma URL de redirecionamento opaca — não há
corpo de artigo no RSS, e o link não resolve sem executar JavaScript. Verificado nos
testes: um item do Google News rende ~80 caracteres de texto; um item do Commercial
Observer rende 4.000.

O agente não finge que isso não existe. Ele detecta o caso, marca `headline_only: true`,
avisa o modelo no prompt para deixar em `null` tudo que o título não sustenta e limita a
confiança a 0.75. Consequência prática:

- **feeds do Google News** → ótimos para *descobrir* projetos; espere `public_partner`,
  `private_partner` e `estimated_value_usd` frequentemente nulos;
- **feeds dos veículos** (Commercial Observer, Bisnow, Route Fifty, Smart Cities Dive,
  Construction Dive) → texto completo no RSS e extração bem mais rica.

Para preencher os campos dos itens vindos do Google News é preciso buscar o texto do
artigo na fonte — o caminho natural é a ferramenta `web_fetch` da própria API, que roda
do lado do servidor da Anthropic. Ficou fora deste MVP porque a URL de redirecionamento
do Google News não resolve por HTTP simples e o passo exige tratar `pause_turn` no laço
de tool use. Ao adicionar, respeite `robots.txt` e os termos de cada veículo.

---

## 6. Modelo e custo

O padrão é `claude-sonnet-5`. Você pediu "claude-3-5-sonnet ou claude-3-haiku": esses IDs
foram descontinuados, e a geração atual desses mesmos tiers é `claude-sonnet-5` e
`claude-haiku-4-5`. Troque com `--model` ou `ANTHROPIC_MODEL`:

| Modelo | Quando usar |
|---|---|
| `claude-sonnet-5` | padrão — bom equilíbrio entre julgamento e custo |
| `claude-haiku-4-5` | volume alto, orçamento apertado (o script desliga o *thinking* nele automaticamente, pois Haiku 4.5 não aceita `adaptive`) |
| `claude-opus-5` | melhor julgamento nos casos ambíguos, mais caro |

Controles de custo, do mais eficaz ao menos: `--limit`, o cache de artigos vistos, o
pré-filtro e a escolha do modelo. Ao final de cada execução o script imprime tokens de
entrada e saída consumidos; os preços por milhão de tokens estão em
<https://www.anthropic.com/pricing>.

O prompt não usa *prompt caching* porque o system prompt está abaixo do prefixo mínimo
cacheável (512–4096 tokens, conforme o modelo) — habilitar seria um no-op silencioso.

## 7. Próximos passos naturais

1. **Texto completo dos artigos** (seção 5) — o maior ganho de qualidade disponível.
2. **Conjunto de avaliação**: rotule 30–50 artigos à mão e meça precisão/recall antes de
   ajustar o prompt no escuro. Sem isso, mexer nos critérios é chute.
3. **Agendamento**: `cron` ou `launchd` rodando de manhã; o cache já garante
   idempotência.
4. **Deduplicação por projeto**, não por URL — hoje a mesma obra noticiada por três
   veículos gera três linhas.
5. **Alerta**: e-mail ou Slack quando surgir P3 com confiança alta em mercados-alvo.
