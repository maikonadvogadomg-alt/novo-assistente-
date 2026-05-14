import { Router } from "express";
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import { storage } from "../storage.js";
import { getLocalConfig } from "../local-config.js";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function sanitizeKey(raw: string): string {
  return (raw || "").split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)[0] || "";
}

function autoDetectProvider(key: string): { url: string; model: string } | null {
  const k = sanitizeKey(key);
  if (k.startsWith("gsk_")) return { url: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" };
  if (k.startsWith("sk-or-")) return { url: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" };
  if (k.startsWith("pplx-")) return { url: "https://api.perplexity.ai", model: "sonar-pro" };
  if (k.startsWith("sk-ant-")) return { url: "https://api.anthropic.com/v1", model: "claude-3-5-sonnet-20241022" };
  if (k.startsWith("AIza")) return { url: "https://generativelanguage.googleapis.com/v1beta/openai", model: "gemini-2.0-flash" };
  if (k.startsWith("xai-")) return { url: "https://api.x.ai/v1", model: "grok-2-latest" };
  if (k.startsWith("sk-") && k.length > 40) return { url: "https://api.openai.com/v1", model: "gpt-4o-mini" };
  return null;
}

function truncateChatHistory(
  history: Array<{ role: string; content: string }>,
  maxChars: number,
): Array<{ role: string; content: string }> {
  if (!Array.isArray(history) || history.length === 0) return history;
  const totalChars = history.reduce((s, m) => s + (m.content || "").length, 0);
  if (totalChars <= maxChars) return history;
  const kept: Array<{ role: string; content: string }> = [];
  let usedChars = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const c = (history[i].content || "").length;
    if (usedChars + c > maxChars && kept.length >= 2) break;
    kept.unshift(history[i]);
    usedChars += c;
  }
  return kept;
}

// BUG 2 FIX: geminiStream NEVER uses AI_INTEGRATIONS_* — only user keys from storage
async function geminiStreamWithKey(
  res: any,
  systemPrompt: string,
  userContent: string,
  model: string,
  maxOutputTokens: number,
  geminiKey: string,
): Promise<void> {
  const client = new GoogleGenAI({ apiKey: geminiKey });
  const fullPrompt = `${systemPrompt}\n\n${userContent}`;
  const stream = await client.models.generateContentStream({
    model,
    contents: [{ role: "user", parts: [{ text: fullPrompt }] }],
    config: { maxOutputTokens: Math.min(maxOutputTokens, 65536), temperature: 0.7 },
  });
  for await (const chunk of stream) {
    const content = chunk.text || "";
    if (content) res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
  }
}

async function geminiStreamMessagesWithKey(
  res: any,
  messages: Array<{ role: "user" | "model"; parts: [{ text: string }] }>,
  model: string,
  maxOutputTokens: number,
  geminiKey: string,
): Promise<void> {
  const client = new GoogleGenAI({ apiKey: geminiKey });
  const stream = await client.models.generateContentStream({
    model,
    contents: messages,
    config: { maxOutputTokens: Math.min(maxOutputTokens, 65536), temperature: 0.7 },
  });
  for await (const chunk of stream) {
    const content = chunk.text || "";
    if (content) res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
  }
}

async function openAiCompatStream(
  res: any,
  messages: Array<{ role: string; content: string }>,
  key: string,
  url: string,
  model: string,
  maxTokens: number,
): Promise<void> {
  const isGroq = url.includes("groq.com");
  const isPplx = url.includes("perplexity.ai") || key.startsWith("pplx-");
  const isOr = url.includes("openrouter.ai");
  const effectiveMax = isGroq ? Math.min(maxTokens, 32000)
    : isPplx ? Math.min(maxTokens, 8000)
    : isOr ? Math.min(maxTokens, 65536)
    : maxTokens;

  let cRes = await fetch(`${url.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, stream: true, max_tokens: effectiveMax, temperature: 0.3 }),
  });

  if (!cRes.ok) {
    const errTxt = await cRes.text().catch(() => "");
    const isTokenErr = errTxt.includes("max_tokens") || errTxt.includes("context_length") || errTxt.includes("too large") || errTxt.includes("context_window");
    if (isTokenErr) {
      const fallbackMax = isPplx ? 4000 : isGroq ? 16000 : 32000;
      cRes = await fetch(`${url.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, stream: true, max_tokens: fallbackMax, temperature: 0.3 }),
      });
    }
  }

  if (!cRes.ok) {
    const errTxt = await cRes.text().catch(() => "");
    let errDetail = errTxt.substring(0, 300);
    try { errDetail = (JSON.parse(errTxt) as any)?.error?.message ?? errDetail; } catch {}
    const httpCode = cRes.status;
    let userMsg = `Erro da API (${httpCode}): ${errDetail}`;
    if (httpCode === 401) userMsg = "Chave de API inválida ou expirada. Verifique nas Configurações.";
    else if (httpCode === 403) userMsg = "Sem permissão. Verifique se sua conta tem acesso ao modelo.";
    else if (httpCode === 429) userMsg = "Limite de requisições atingido. Aguarde alguns segundos.";
    res.write(`data: ${JSON.stringify({ error: userMsg })}\n\n`);
    return;
  }

  const cBody = cRes.body as any;
  if (!cBody) return;
  const cReader = cBody.getReader ? cBody.getReader() : null;
  if (cReader) {
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done: cDone, value } = await cReader.read();
      if (cDone) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() || "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const d = line.slice(6).trim();
        if (d === "[DONE]") break;
        try {
          const json = JSON.parse(d);
          const content = json?.choices?.[0]?.delta?.content;
          if (content) res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
        } catch {}
      }
    }
  }
}

async function getUserGeminiKey(): Promise<string | null> {
  return sanitizeKey(getLocalConfig("gemini_api_key") || await storage.getSetting("gemini_api_key") || "") || null;
}

const SYSTEM_PROMPT_BASE = `Voce e uma assistente juridica especializada em Direito brasileiro. Produza documentos COMPLETOS, EXTENSOS e PRONTOS PARA USO IMEDIATO.

REGRAS ABSOLUTAS:
1. DOCUMENTO COMPLETO E EXTENSO — nunca resuma, nunca corte, nunca omita. Escreva o documento inteiro do inicio ao fim. O advogado copia e cola direto no Word.
2. ESTRUTURA OBRIGATORIA para peticoes e minutas: Endereçamento → Qualificação das partes → Dos Fatos (detalhado) → Do Direito (com fundamentacao legal) → Dos Pedidos → Local, data e assinatura.
3. FUNDAMENTACAO ROBUSTA — cite artigos de lei, numeros de lei, doutrina, principios. Desenvolva cada argumento em paragrafos proprios.
4. Base-se EXCLUSIVAMENTE no texto fornecido. Nao invente fatos. Se faltar dado: [INFORMAR: descricao]. Se ha ementas selecionadas, CITE-AS literalmente.
5. MANTENHA nomes, CPFs, numeros, dados pessoais EXATAMENTE como estao. NAO altere nenhum dado.
6. TEXTO PURO sem markdown. NAO use asteriscos (*), hashtags (#), tracos (---), nem nenhuma sintaxe markdown. Para titulos, escreva em CAIXA ALTA. Para negrito, escreva em CAIXA ALTA. Paragrafos separados por linha em branco. Cada paragrafo em uma unica linha continua (sem quebras no meio da frase).
7. CADA PARAGRAFO maximo 5 linhas. Nunca junte varios argumentos num bloco so. Separe cada ideia em paragrafo proprio.
8. NUNCA produza um rascunho curto. O MINIMO ABSOLUTO para qualquer minuta ou peticao e 15 PAGINAS completas (aproximadamente 7.500 palavras).
9. FORMATACAO DO TEXTO:
   - Titulos e subtitulos: CAIXA ALTA, centralizado, sem recuo.
   - Paragrafos do corpo: justificados, recuo de 4cm na primeira linha, espacamento 1.5.
   - Citacoes (ementas, artigos, sumulas): recuo 4cm dos dois lados, justificado, fonte 10pt, espacamento simples, italico.
   - Assinatura do advogado: negrito, CAIXA ALTA, centralizado.
   - "Nestes termos, pede deferimento": alinhado a esquerda, sem recuo.`;

const ACTION_PROMPTS: Record<string, string> = {
  resumir: "Elabore RESUMO ESTRUTURADO do documento com as seguintes secoes, CADA UMA em bloco separado por linha em branco:\n\n1. NATUREZA DA DEMANDA\n[descricao]\n\n2. FATOS PRINCIPAIS\n[datas, nomes, valores]\n\n3. FUNDAMENTOS JURIDICOS\n[bases legais e argumentos]\n\n4. CONCLUSAO E PEDIDO\n[resultado pretendido]\n\nNao omita detalhes. Cada topico deve iniciar em nova linha apos linha em branco.\n\nDOCUMENTO:\n{{textos}}",
  revisar: "Analise erros gramaticais, concordancia, logica juridica. Sugira melhorias de redacao. Aponte omissoes/contradicoes.\n\nTEXTO:\n{{textos}}",
  refinar: "Reescreva elevando linguagem para padrao de tribunais superiores. Melhore fluidez e vocabulario juridico.\n\nTEXTO:\n{{textos}}",
  simplificar: "Traduza para linguagem simples e acessivel, mantendo rigor tecnico. Cliente leigo deve entender.\n\nTEXTO:\n{{textos}}",
  minuta: "Elabore PETICAO/MINUTA JURIDICA COMPLETA, EXTENSA E PROFISSIONAL com NO MINIMO 15 PAGINAS (7.500+ palavras). Inclua OBRIGATORIAMENTE todas as secoes abaixo, desenvolvendo CADA UMA extensamente:\n\nEXMO(A). SR(A). DR(A). JUIZ(A) DE DIREITO DA ... VARA DE ... DA COMARCA DE ...\n\n[QUALIFICACAO COMPLETA DAS PARTES com todos os dados]\n\nDOS FATOS\n[Narrativa EXTENSA, detalhada e cronologica dos fatos — minimo 8 paragrafos]\n\nDO DIREITO\n[Fundamentacao juridica ROBUSTA com citacao de artigos de lei, codigos, leis especificas, principios constitucionais, doutrina e jurisprudencia — minimo 12 paragrafos]\n\nDA JURISPRUDENCIA\n[Citacao de precedentes relevantes de tribunais superiores e regionais — minimo 5 julgados com ementa]\n\nDOS PEDIDOS\n[Lista numerada e DETALHADA de todos os pedidos, cada um com fundamentacao propria — minimo 8 pedidos]\n\nDO VALOR DA CAUSA\n[Fundamentacao do valor atribuido]\n\n[Data e assinatura]\n\nATENCAO: O documento DEVE ter no minimo 15 PAGINAS COMPLETAS.\n\nINFORMACOES:\n{{textos}}",
  analisar: "Elabore ANALISE JURIDICA com as seguintes secoes, CADA UMA separada por linha em branco:\n\n1. RISCOS PROCESSUAIS\n[analise dos riscos]\n\n2. TESES FAVORAVEIS E CONTRARIAS\n[argumentos pro e contra]\n\n3. JURISPRUDENCIA APLICAVEL\n[precedentes relevantes]\n\n4. PROXIMOS PASSOS\n[recomendacoes de atuacao]\n\nCada secao deve iniciar em nova linha apos linha em branco.\n\nDOCUMENTO:\n{{textos}}",
  "modo-estrito": "Corrija APENAS erros gramaticais e de estilo. Nao altere estrutura ou conteudo.\n\nTEXTO:\n{{textos}}",
  "modo-redacao": "Melhore o texto tornando-o mais profissional e persuasivo, mantendo todos dados e fatos.\n\nTEXTO:\n{{textos}}",
  "modo-interativo": "Identifique lacunas e pontos que precisam complementacao pelo advogado.\n\nTEXTO:\n{{textos}}",
};

// ── /ai/process ───────────────────────────────────────────────────────────────
// Handles ZIP2 body format: { text, action, customActionId, ementaIds, model, effortLevel, verbosity, recentContext, perplexityKey, customKey, customUrl, customModel }
router.post("/ai/process", async (req, res) => {
  try {
    const {
      text: rawText,
      textos: rawTextos,
      action,
      customActionId,
      ementaIds,
      model,
      effortLevel,
      verbosity,
      recentContext,
      perplexityKey: reqPerplexityKey,
      customKey: reqCustomKey,
      customUrl: reqCustomUrl,
      customModel: reqCustomModel,
    } = req.body;

    const inputText = (rawText || rawTextos || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    if (!inputText || (!action && !customActionId)) {
      return res.status(400).json({ message: "Texto e ação são obrigatórios" });
    }

    const isPerplexity = model === "perplexity";
    const isCustom = model === "custom";
    const geminiModel = model === "economico" ? "gemini-2.5-flash" : "gemini-2.5-pro";
    const effort = typeof effortLevel === "number" ? Math.min(5, Math.max(1, effortLevel)) : 3;
    const verb = verbosity === "curta" ? "curta" : "longa";

    const effortLabels: Record<number, string> = {
      1: "ESFORCO: RAPIDO. Direto e objetivo.",
      2: "ESFORCO: BASICO. Pontos principais.",
      3: "ESFORCO: DETALHADO. Analise completa.",
      4: "ESFORCO: PROFUNDO. Fundamentacao robusta, nuances, legislacao.",
      5: "ESFORCO: EXAUSTIVO. Todos os angulos, teses, jurisprudencia.",
    };
    const verbosityInstr = verb === "curta" ? "TAMANHO: CONCISO. Direto ao ponto." : "TAMANHO: COMPLETO. Desenvolva cada argumento.";
    const effortVerbosityInstr = `\n\n${effortLabels[effort] || effortLabels[3]}\n${verbosityInstr}`;
    const maxTokens = verb === "curta" ? (effort <= 2 ? 32768 : 65536) : 65536;

    let ementasForSystem = "";
    if (ementaIds && Array.isArray(ementaIds) && ementaIds.length > 0) {
      const selectedEmentas = [];
      for (const eid of ementaIds) {
        const em = await storage.getEmenta(eid);
        if (em) selectedEmentas.push(em);
      }
      if (selectedEmentas.length > 0) {
        ementasForSystem = "\n\nJURISPRUDÊNCIA DE REFERÊNCIA SELECIONADA PELO ADVOGADO:\nUse-as como fundamentação.\n\n" +
          selectedEmentas.map((e, i) => `EMENTA ${i + 1} [${e.categoria}] - ${e.titulo}:\n${e.texto}`).join("\n\n") + "\n";
      }
    }

    let recentContextStr = "";
    if (Array.isArray(recentContext) && recentContext.length > 0) {
      recentContextStr = "\n\n--- HISTÓRICO COMPLETO DO ADVOGADO ---\n" +
        recentContext.map((item: any, i: number) => `[${i + 1}] Ação: ${item.acao || "consulta"}\nPergunta: ${item.pergunta || ""}\nResposta: ${item.resposta || ""}`).join("\n\n") +
        "\n--- FIM DO HISTÓRICO ---\n";
    }

    const systemPromptWithContext = SYSTEM_PROMPT_BASE + effortVerbosityInstr + recentContextStr + ementasForSystem;

    let promptTemplate: string | undefined;
    if (customActionId) {
      const customAction = await storage.getCustomAction(customActionId);
      if (!customAction) return res.status(400).json({ message: "Modelo personalizado não encontrado" });
      promptTemplate = customAction.prompt + "\n\n{{textos}}";
    } else {
      promptTemplate = ACTION_PROMPTS[action];
    }
    if (!promptTemplate) return res.status(400).json({ message: "Ação inválida" });

    const safeText = inputText.length > 800000 ? inputText.substring(0, 800000) : inputText;
    const userPrompt = promptTemplate.replace("{{textos}}", safeText);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (isCustom) {
      const personalKey = sanitizeKey(reqCustomKey || "");
      const dbDemoKey = sanitizeKey(await storage.getSetting("demo_api_key") || "");
      const cKey = personalKey || dbDemoKey;
      const usingDemo = !personalKey && !!dbDemoKey;

      if (!cKey) {
        res.write(`data: ${JSON.stringify({ error: "Chave Própria não configurada. Acesse Configurações ⚙ e preencha sua chave." })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }
      if (usingDemo) res.write(`data: ${JSON.stringify({ demoMode: true })}\n\n`);

      const dbDemoUrl = (await storage.getSetting("demo_api_url") || "").trim();
      const dbDemoModel = (await storage.getSetting("demo_api_model") || "").trim();
      const cUrl = (personalKey
        ? (reqCustomUrl || "https://api.openai.com/v1")
        : (dbDemoUrl || "https://api.openai.com/v1")
      ).replace(/\/$/, "");
      const cModel = (personalKey
        ? (reqCustomModel || "gpt-4o-mini")
        : (dbDemoModel || "gpt-4o-mini")
      ).trim();

      const msgs = [
        { role: "system", content: systemPromptWithContext },
        { role: "user", content: userPrompt },
      ];
      await openAiCompatStream(res, msgs, cKey, cUrl, cModel, maxTokens);

    } else if (isPerplexity) {
      let pKey = sanitizeKey(reqPerplexityKey || "");
      if (!pKey) pKey = sanitizeKey(await storage.getSetting("perplexity_api_key") || "");
      if (!pKey) {
        const dbKey = sanitizeKey(await storage.getSetting("demo_api_key") || "");
        const dbUrl = (await storage.getSetting("demo_api_url") || "").trim();
        if (dbKey && dbUrl && dbUrl.includes("perplexity")) pKey = dbKey;
      }
      if (!pKey) {
        res.write(`data: ${JSON.stringify({ error: "Chave Perplexity não configurada. Acesse Configurações e cole sua chave de perplexity.ai/settings/api" })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }
      const pRes = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pKey}` },
        body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: systemPromptWithContext }, { role: "user", content: userPrompt }], stream: true, max_tokens: Math.min(maxTokens, 8000), temperature: 0.2 }),
      });
      if (!pRes.ok) {
        const errText = await pRes.text().catch(() => "");
        const errMsg = pRes.status === 401 ? "Chave Perplexity inválida." : `Erro Perplexity (${pRes.status}): ${errText.substring(0, 200)}`;
        res.write(`data: ${JSON.stringify({ error: errMsg })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }
      let buffer = "";
      let pplxCitations: string[] = [];
      for await (const chunk of pRes.body as any) {
        buffer += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          const d = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
          try {
            const json = JSON.parse(d);
            const content = json?.choices?.[0]?.delta?.content;
            if (content) res.write(`data: ${JSON.stringify({ text: content })}\n\n`);
            if (json?.citations && Array.isArray(json.citations) && json.citations.length > 0) pplxCitations = json.citations;
          } catch {}
        }
      }
      if (pplxCitations.length > 0) res.write(`data: ${JSON.stringify({ citations: pplxCitations })}\n\n`);

    } else {
      // Gemini — BUG 2 FIX: only user keys, NEVER AI_INTEGRATIONS_*
      const personalKey = sanitizeKey(reqCustomKey || "");
      const geminiKey = personalKey || await getUserGeminiKey() || sanitizeKey(await storage.getSetting("demo_api_key") || "");

      if (!geminiKey) {
        res.write(`data: ${JSON.stringify({ error: "Nenhuma chave de IA configurada. Acesse Configurações e adicione sua chave Gemini ou outra." })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }

      const ownUrl = (reqCustomUrl || "").trim() || (await storage.getSetting("demo_api_url") || "").trim();
      const ownModel = (reqCustomModel || "").trim() || (await storage.getSetting("demo_api_model") || "").trim();

      if (ownUrl && ownModel && geminiKey) {
        // Use as OpenAI-compatible endpoint
        const msgs = [
          { role: "system", content: systemPromptWithContext },
          { role: "user", content: userPrompt },
        ];
        await openAiCompatStream(res, msgs, geminiKey, ownUrl, ownModel, maxTokens);
      } else if (geminiKey.startsWith("AIza")) {
        await geminiStreamWithKey(res, systemPromptWithContext, userPrompt, geminiModel, maxTokens, geminiKey);
      } else {
        // Try as OpenAI-compatible with auto-detected provider
        const detected = autoDetectProvider(geminiKey);
        if (detected) {
          const msgs = [
            { role: "system", content: systemPromptWithContext },
            { role: "user", content: userPrompt },
          ];
          await openAiCompatStream(res, msgs, geminiKey, detected.url, detected.model, maxTokens);
        } else {
          res.write(`data: ${JSON.stringify({ error: "Nenhuma chave de IA válida configurada. Acesse Configurações." })}\n\n`);
        }
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("AI process error:", error?.message);
    const errorMsg = error?.status === 429
      ? "Limite de uso atingido. Aguarde e tente novamente."
      : `Erro ao processar: ${error?.message || "erro desconhecido"}`;
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ message: errorMsg });
    }
  }
});

// ── /ai/refine ────────────────────────────────────────────────────────────────
// ZIP2 format: { previousResult, instruction, originalText, model, ementaIds, chatHistory, effortLevel, verbosity, perplexityKey, customKey, customUrl, customModel }
router.post("/ai/refine", async (req, res) => {
  try {
    const {
      previousResult,
      instruction,
      originalText,
      model,
      ementaIds,
      chatHistory,
      effortLevel,
      verbosity,
      perplexityKey: reqPerplexityKey,
      customKey: reqCustomKey,
      customUrl: reqCustomUrl,
      customModel: reqCustomModel,
      // Legacy format support
      messages: legacyMessages,
    } = req.body;

    const isPerplexity = model === "perplexity";
    const isCustom = model === "custom";
    const geminiModel = model === "economico" ? "gemini-2.5-flash" : "gemini-2.5-pro";
    const effort = typeof effortLevel === "number" ? Math.min(5, Math.max(1, effortLevel)) : 3;
    const verb = verbosity === "curta" ? "curta" : "longa";
    const refineMaxTokens = verb === "curta" ? (effort <= 2 ? 32768 : 65536) : 65536;

    if (!instruction && !legacyMessages) {
      return res.status(400).json({ message: "Instrução é obrigatória" });
    }

    let ementasForRefine = "";
    if (ementaIds && Array.isArray(ementaIds) && ementaIds.length > 0) {
      const selectedEmentas = [];
      for (const eid of ementaIds) {
        const em = await storage.getEmenta(eid);
        if (em) selectedEmentas.push(em);
      }
      if (selectedEmentas.length > 0) {
        ementasForRefine = "\n\nJURISPRUDÊNCIA DE REFERÊNCIA SELECIONADA PELO ADVOGADO:\nUse-as como fundamentação.\n\n" +
          selectedEmentas.map((e, i) => `EMENTA ${i + 1} [${e.categoria}] - ${e.titulo}:\n${e.texto}`).join("\n\n") + "\n";
      }
    }

    const refineSystemPrompt = `Voce e uma assistente juridica especializada. Seu UNICO papel e construir e ajustar documentos juridicos brasileiros.

REGRA ABSOLUTA: Se a mensagem do advogado NAO for uma instrucao juridica clara, IGNORE o conteudo emocional e retorne o documento atual SEM alteracoes.

${originalText ? `TEXTO BASE:\n---\n${originalText.substring(0, 15000)}\n---\n` : ""}${ementasForRefine}

MODOS DE OPERACAO:
1. CONSTRUCAO: Documento INTEIRO com MINIMO 15 PAGINAS.
2. EXPANSAO: Expanda com mais argumentacao. Minimo 15 paginas.
3. AJUSTE: Documento COMPLETO com a alteracao especifica.
4. PERGUNTA juridica: Responda diretamente.

REGRAS FIXAS: Mantenha dados pessoais exatos. Texto puro sem markdown. NAO use asteriscos (*), hashtags (#) ou qualquer sintaxe markdown. Para titulos use CAIXA ALTA.`;

    const effortLabels: Record<number, string> = { 1: "ESFORCO: RAPIDO.", 2: "ESFORCO: BASICO.", 3: "ESFORCO: DETALHADO.", 4: "ESFORCO: PROFUNDO.", 5: "ESFORCO: EXAUSTIVO." };
    const refineVerbInstr = verb === "curta" ? "Conciso." : "Completo.";
    const fullRefinePrompt = refineSystemPrompt + `\n\n${effortLabels[effort] || effortLabels[3]}\n${refineVerbInstr}`;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    if (isCustom) {
      const personalKey = sanitizeKey(reqCustomKey || "");
      const dbDemoKey = sanitizeKey(await storage.getSetting("demo_api_key") || "");
      const cKey = personalKey || dbDemoKey;
      const usingDemo = !personalKey && !!dbDemoKey;

      if (!cKey) {
        res.write(`data: ${JSON.stringify({ error: "Chave Própria não configurada. Acesse Configurações." })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }
      if (usingDemo) res.write(`data: ${JSON.stringify({ demoMode: true })}\n\n`);

      const dbDemoUrl = (await storage.getSetting("demo_api_url") || "").trim();
      const dbDemoModel = (await storage.getSetting("demo_api_model") || "").trim();
      const cUrl = (personalKey ? (reqCustomUrl || "https://api.openai.com/v1") : (dbDemoUrl || "https://api.openai.com/v1")).replace(/\/$/, "");
      const cModel = (personalKey ? (reqCustomModel || "gpt-4o-mini") : (dbDemoModel || "gpt-4o-mini")).trim();

      const cMsgs: Array<{ role: string; content: string }> = [{ role: "system", content: fullRefinePrompt }];
      const history = legacyMessages || chatHistory;
      const truncatedHistory = truncateChatHistory(history || [], 500_000);
      if (Array.isArray(truncatedHistory) && truncatedHistory.length > 0) {
        for (const msg of truncatedHistory) {
          const role = msg.role === "assistant" ? "assistant" : "user";
          const c = (msg.content || "").trim();
          if (c) cMsgs.push({ role, content: c });
        }
      } else {
        const docRef = previousResult || originalText || "";
        cMsgs.push({ role: "user", content: `DOCUMENTO ATUAL:\n${docRef}` });
        if (docRef.trim()) cMsgs.push({ role: "assistant", content: docRef });
        cMsgs.push({ role: "user", content: instruction || "" });
      }
      await openAiCompatStream(res, cMsgs, cKey, cUrl, cModel, refineMaxTokens);

    } else if (isPerplexity) {
      let pKey = sanitizeKey(reqPerplexityKey || "");
      if (!pKey) pKey = sanitizeKey(await storage.getSetting("perplexity_api_key") || "");
      if (!pKey) {
        res.write(`data: ${JSON.stringify({ error: "Chave Perplexity não configurada. Acesse Configurações." })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }
      const pMessages: Array<{ role: string; content: string }> = [{ role: "system", content: fullRefinePrompt }];
      const history = legacyMessages || chatHistory;
      const truncatedHistory = truncateChatHistory(history || [], 400_000);
      if (Array.isArray(truncatedHistory) && truncatedHistory.length > 0) {
        for (const msg of truncatedHistory) {
          const role = msg.role === "assistant" ? "assistant" : "user";
          const c = (msg.content || "").trim();
          if (c) pMessages.push({ role, content: c });
        }
      } else {
        const docRef = previousResult || originalText || "";
        pMessages.push({ role: "user", content: `DOCUMENTO ATUAL:\n${docRef}` });
        if (docRef.trim()) pMessages.push({ role: "assistant", content: docRef });
        pMessages.push({ role: "user", content: instruction || "" });
      }
      const pRes = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pKey}` },
        body: JSON.stringify({ model: "sonar-pro", messages: pMessages, stream: true, max_tokens: Math.min(refineMaxTokens, 8000), temperature: 0.2 }),
      });
      if (!pRes.ok) {
        const errText = await pRes.text().catch(() => "");
        res.write(`data: ${JSON.stringify({ error: `Erro Perplexity (${pRes.status}): ${errText.substring(0, 200)}` })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }
      let buf = "";
      let pplxCitations: string[] = [];
      for await (const chunk of pRes.body as any) {
        buf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf-8");
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          const d = trimmed.startsWith("data: ") ? trimmed.slice(6) : trimmed;
          try {
            const j = JSON.parse(d);
            const c = j?.choices?.[0]?.delta?.content;
            if (c) res.write(`data: ${JSON.stringify({ text: c })}\n\n`);
            if (j?.citations && Array.isArray(j.citations) && j.citations.length > 0) pplxCitations = j.citations;
          } catch {}
        }
      }
      if (pplxCitations.length > 0) res.write(`data: ${JSON.stringify({ citations: pplxCitations })}\n\n`);

    } else {
      // Gemini — BUG 2 FIX: only user keys, NEVER AI_INTEGRATIONS_*
      const personalKey = sanitizeKey(reqCustomKey || "");
      const geminiKey = personalKey || await getUserGeminiKey() || sanitizeKey(await storage.getSetting("demo_api_key") || "");

      if (!geminiKey) {
        res.write(`data: ${JSON.stringify({ error: "Nenhuma chave de IA configurada. Acesse Configurações e adicione sua chave Gemini ou outra." })}\n\n`);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        return res.end();
      }

      const ownUrl = (reqCustomUrl || "").trim() || (await storage.getSetting("demo_api_url") || "").trim();
      const ownModel = (reqCustomModel || "").trim() || (await storage.getSetting("demo_api_model") || "").trim();

      const history = legacyMessages || chatHistory;
      const truncatedHistory = truncateChatHistory(history || [], 1_500_000);

      if ((ownUrl && ownModel) || !geminiKey.startsWith("AIza")) {
        const finalUrl = ownUrl || (autoDetectProvider(geminiKey)?.url || "https://api.openai.com/v1");
        const finalModel = ownModel || (autoDetectProvider(geminiKey)?.model || "gpt-4o-mini");
        const cMsgs: Array<{ role: string; content: string }> = [{ role: "system", content: fullRefinePrompt }];
        if (Array.isArray(truncatedHistory) && truncatedHistory.length > 0) {
          for (const msg of truncatedHistory) {
            const role = msg.role === "assistant" ? "assistant" : "user";
            const c = (msg.content || "").trim();
            if (c) cMsgs.push({ role, content: c });
          }
        } else {
          const docRef = previousResult || originalText || "";
          cMsgs.push({ role: "user", content: `DOCUMENTO ATUAL:\n${docRef}` });
          if (docRef.trim()) cMsgs.push({ role: "assistant", content: docRef });
          cMsgs.push({ role: "user", content: instruction || "" });
        }
        await openAiCompatStream(res, cMsgs, geminiKey, finalUrl, finalModel, refineMaxTokens);
      } else {
        // Build Gemini messages format
        const geminiMessages: Array<{ role: "user" | "model"; parts: [{ text: string }] }> = [];
        if (Array.isArray(truncatedHistory) && truncatedHistory.length > 0) {
          let systemInjected = false;
          for (const msg of truncatedHistory) {
            const geminiRole = msg.role === "assistant" ? "model" as const : "user" as const;
            if (!systemInjected && geminiRole === "user") {
              geminiMessages.push({ role: "user", parts: [{ text: `${fullRefinePrompt}\n\n${msg.content}` }] });
              systemInjected = true;
            } else {
              geminiMessages.push({ role: geminiRole, parts: [{ text: msg.content }] });
            }
          }
          if (!systemInjected) {
            geminiMessages.push({ role: "user", parts: [{ text: `${fullRefinePrompt}\n\n${instruction || ""}` }] });
          }
        } else {
          const docRef = previousResult || originalText || "";
          geminiMessages.push({ role: "user", parts: [{ text: `${fullRefinePrompt}\n\nDOCUMENTO ATUAL:\n${docRef}` }] });
          if (docRef.trim()) geminiMessages.push({ role: "model", parts: [{ text: docRef }] });
          geminiMessages.push({ role: "user", parts: [{ text: instruction || "" }] });
        }
        await geminiStreamMessagesWithKey(res, geminiMessages, geminiModel, refineMaxTokens, geminiKey);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  } catch (error: any) {
    console.error("AI refine error:", error?.message);
    const errorMsg = error?.status === 429
      ? "Limite de uso atingido. Aguarde e tente novamente."
      : `Erro ao processar: ${error?.message || "erro desconhecido"}`;
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: errorMsg })}\n\n`);
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
      res.end();
    } else {
      res.status(500).json({ message: errorMsg });
    }
  }
});

// ── /code-assistant ───────────────────────────────────────────────────────────
router.post("/code-assistant", async (req, res) => {
  const { prompt, html, css, js, customKey, customUrl, customModel } = req.body;

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const systemPrompt = `Você é um assistente de código web especialista em HTML, CSS e JavaScript. 
Responda em português. Forneça código funcional e bem comentado.
Quando modificar código existente, retorne o código completo e atualizado.
Use práticas modernas e acessíveis.`;

  const context = [
    prompt,
    html ? `\n\nHTML atual:\n\`\`\`html\n${html}\n\`\`\`` : "",
    css ? `\n\nCSS atual:\n\`\`\`css\n${css}\n\`\`\`` : "",
    js ? `\n\nJS atual:\n\`\`\`javascript\n${js}\n\`\`\`` : "",
  ].join("");

  try {
    const cKey = customKey ? sanitizeKey(customKey) : null;
    const cUrl = customUrl || (cKey ? autoDetectProvider(cKey)?.url : null) || null;
    const cModel = customModel || (cKey ? autoDetectProvider(cKey)?.model : null) || "gpt-4o-mini";

    if (cKey) {
      const msgs = [{ role: "system", content: systemPrompt }, { role: "user", content: context }];
      const url = cUrl || "https://api.openai.com/v1";
      await openAiCompatStream(res, msgs, cKey, url, cModel, 32000);
    } else {
      const geminiKey = await getUserGeminiKey() || sanitizeKey(await storage.getSetting("demo_api_key") || "");
      if (!geminiKey) {
        res.write(`data: ${JSON.stringify({ text: "⚠️ Nenhuma chave de IA configurada. Acesse Configurações e adicione sua chave." })}\n\n`);
      } else {
        const dbUrl = (await storage.getSetting("demo_api_url") || "").trim();
        const dbModel = (await storage.getSetting("demo_api_model") || "").trim();
        if (dbUrl && dbModel) {
          const msgs = [{ role: "system", content: systemPrompt }, { role: "user", content: context }];
          await openAiCompatStream(res, msgs, geminiKey, dbUrl, dbModel, 32000);
        } else {
          await geminiStreamWithKey(res, systemPrompt, context, "gemini-2.5-flash", 32000, geminiKey);
        }
      }
    }
  } catch (err: any) {
    res.write(`data: ${JSON.stringify({ error: err?.message || "Erro interno" })}\n\n`);
  } finally {
    res.write("data: [DONE]\n\n");
    res.end();
  }
});

// ── /voice-chat ───────────────────────────────────────────────────────────────
router.post("/voice-chat", async (req, res) => {
  try {
    const { message, history, customKey, customUrl, customModelName, perplexityKey } = req.body;
    if (!message || typeof message !== "string") return res.status(400).json({ message: "Mensagem obrigatória" });

    const systemPrompt = `Você é uma assistente jurídica brasileira conversacional. O advogado está FALANDO com você por voz.
REGRAS PARA RESPOSTAS POR VOZ:
1. Resposta CURTA e DIRETA — máximo 3 frases
2. Use linguagem natural de conversa, NÃO use formatação
3. Seja objetiva e prática
4. Use português brasileiro informal mas profissional`;

    const chatHistory: Array<{ role: string; content: string }> = Array.isArray(history)
      ? history.map((m: any) => ({ role: m.role === "assistant" ? "assistant" : "user", content: m.text || m.content || "" }))
      : [];
    chatHistory.push({ role: "user", content: message });

    const pKey = perplexityKey ? sanitizeKey(perplexityKey) : null;
    if (pKey) {
      const pRes = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${pKey}` },
        body: JSON.stringify({ model: "sonar-pro", messages: [{ role: "system", content: systemPrompt }, ...chatHistory], max_tokens: 512, temperature: 0.7 }),
      });
      const data = await pRes.json() as any;
      const reply = (data.choices?.[0]?.message?.content || "Desculpe, não consegui responder.").replace(/\*\*/g, "").replace(/#{1,3}\s/g, "").replace(/\n{2,}/g, " ").trim();
      return res.json({ reply });
    }

    const cKey = customKey ? sanitizeKey(customKey) : null;
    const cUrl = customUrl || (cKey ? autoDetectProvider(cKey)?.url : null) || "https://api.groq.com/openai/v1";
    const cModel = customModelName || (cKey ? autoDetectProvider(cKey)?.model : null) || "llama-3.3-70b-versatile";

    if (cKey) {
      const cRes = await fetch(`${cUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${cKey}` },
        body: JSON.stringify({ model: cModel, messages: [{ role: "system", content: systemPrompt }, ...chatHistory], max_tokens: 512, temperature: 0.7 }),
      });
      const data = await cRes.json() as any;
      const reply = (data.choices?.[0]?.message?.content || "Desculpe, não consegui responder.").replace(/\*\*/g, "").replace(/\n{2,}/g, " ").trim();
      return res.json({ reply });
    }

    const geminiKey = await getUserGeminiKey() || sanitizeKey(await storage.getSetting("demo_api_key") || "");
    if (geminiKey && geminiKey.startsWith("AIza")) {
      const client = new GoogleGenAI({ apiKey: geminiKey });
      const contents = chatHistory.map(m => ({ role: m.role === "assistant" ? "model" as const : "user" as const, parts: [{ text: m.content }] }));
      const result = await client.models.generateContent({ model: "gemini-2.0-flash", contents, config: { systemInstruction: systemPrompt, maxOutputTokens: 512, temperature: 0.7 } });
      const reply = (result.text || "Desculpe, não consegui responder.").replace(/\*\*/g, "").replace(/\*/g, "").replace(/\n{2,}/g, " ").trim();
      return res.json({ reply });
    }

    return res.status(400).json({ message: "Nenhuma chave de IA configurada. Configure nas Configurações." });
  } catch (error: any) {
    console.error("[voice-chat]", error?.message);
    return res.status(500).json({ message: "Erro ao processar conversa" });
  }
});

// ── /demo-key-test ────────────────────────────────────────────────────────────
router.post("/demo-key-test", async (req, res) => {
  const { key, model, url } = req.body;
  if (!key?.trim()) return res.json({ ok: false, error: "Chave não informada." });
  const apiKey = sanitizeKey(key);
  const detected = autoDetectProvider(apiKey);
  const apiUrl = ((url?.trim()) || detected?.url || "").replace(/\/$/, "");
  const apiModel = ((model?.trim()) || detected?.model || "llama-3.3-70b-versatile");

  try {
    if (apiKey.startsWith("AIza")) {
      const ai = new GoogleGenAI({ apiKey });
      await ai.models.generateContent({ model: apiModel, contents: "Responda apenas: OK" });
      return res.json({ ok: true, model: apiModel });
    }
    const testUrl = (apiUrl || "https://api.groq.com/openai/v1").replace(/\/chat\/completions\/?$/, "");
    const response = await fetch(`${testUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: apiModel, messages: [{ role: "user", content: "OK" }], max_tokens: 10 }),
    });
    if (!response.ok) {
      let errMsg = `Erro ${response.status}`;
      if (response.status === 401) errMsg = "Chave inválida ou expirada.";
      else if (response.status === 429) errMsg = "Limite de requisições atingido.";
      return res.json({ ok: false, error: errMsg });
    }
    const data = await response.json() as any;
    return res.json({ ok: true, model: data?.model ?? apiModel });
  } catch (e: any) {
    return res.json({ ok: false, error: e?.message ?? "Falha na conexão." });
  }
});

// ── /ai-usage-credit ──────────────────────────────────────────────────────────
router.post("/ai-usage-credit", async (req, res) => {
  const { credit } = req.body;
  if (credit === undefined) return res.status(400).json({ message: "Crédito não informado" });
  await storage.setSetting("user_credit", String(credit));
  res.json({ ok: true });
});

export default router;
