import { Router } from "express";
import { storage } from "../storage.js";
import {
  insertSnippetSchema, insertCustomActionSchema, insertEmentaSchema,
  insertAiHistorySchema, insertPromptTemplateSchema, insertDocTemplateSchema,
  insertProcessoMonitoradoSchema,
} from "@workspace/db";

const router = Router();

// ── Snippets ────────────────────────────────────────────────────────────────
router.get("/snippets", async (_req, res) => {
  try { res.json(await storage.getSnippets()); } catch { res.status(500).json({ message: "Erro ao buscar snippets" }); }
});
router.get("/snippets/:id", async (req, res) => {
  try {
    const s = await storage.getSnippet(req.params.id);
    if (!s) return res.status(404).json({ message: "Snippet não encontrado" });
    res.json(s);
  } catch { res.status(500).json({ message: "Erro ao buscar snippet" }); }
});
router.post("/snippets", async (req, res) => {
  try {
    const parsed = insertSnippetSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    res.status(201).json(await storage.createSnippet(parsed.data));
  } catch { res.status(500).json({ message: "Erro ao criar snippet" }); }
});
router.patch("/snippets/:id", async (req, res) => {
  try {
    const { title } = req.body;
    if (!title || typeof title !== "string") return res.status(400).json({ message: "Título obrigatório" });
    const s = await storage.updateSnippetTitle(req.params.id, title);
    if (!s) return res.status(404).json({ message: "Snippet não encontrado" });
    res.json(s);
  } catch { res.status(500).json({ message: "Erro ao atualizar snippet" }); }
});
router.delete("/snippets/:id", async (req, res) => {
  try { await storage.deleteSnippet(req.params.id); res.status(204).send(); } catch { res.status(500).json({ message: "Erro ao excluir snippet" }); }
});

// ── Custom Actions ───────────────────────────────────────────────────────────
router.get("/custom-actions", async (_req, res) => {
  try { res.json(await storage.getCustomActions()); } catch { res.status(500).json({ message: "Erro ao buscar modelos" }); }
});
router.post("/custom-actions", async (req, res) => {
  try {
    const parsed = insertCustomActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    res.status(201).json(await storage.createCustomAction(parsed.data));
  } catch { res.status(500).json({ message: "Erro ao criar modelo" }); }
});
router.patch("/custom-actions/:id", async (req, res) => {
  try {
    const parsed = insertCustomActionSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    const a = await storage.updateCustomAction(req.params.id, parsed.data);
    if (!a) return res.status(404).json({ message: "Modelo não encontrado" });
    res.json(a);
  } catch { res.status(500).json({ message: "Erro ao atualizar modelo" }); }
});
router.delete("/custom-actions/:id", async (req, res) => {
  try { await storage.deleteCustomAction(req.params.id); res.status(204).send(); } catch { res.status(500).json({ message: "Erro ao excluir modelo" }); }
});

// ── Ementas ──────────────────────────────────────────────────────────────────
router.get("/ementas", async (_req, res) => {
  try { res.json(await storage.getEmentas()); } catch { res.status(500).json({ message: "Erro ao buscar ementas" }); }
});
router.post("/ementas", async (req, res) => {
  try {
    const parsed = insertEmentaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    res.status(201).json(await storage.createEmenta(parsed.data));
  } catch { res.status(500).json({ message: "Erro ao criar ementa" }); }
});
router.patch("/ementas/:id", async (req, res) => {
  try {
    const parsed = insertEmentaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    const e = await storage.updateEmenta(req.params.id, parsed.data);
    if (!e) return res.status(404).json({ message: "Ementa não encontrada" });
    res.json(e);
  } catch { res.status(500).json({ message: "Erro ao atualizar ementa" }); }
});
router.delete("/ementas/:id", async (req, res) => {
  try { await storage.deleteEmenta(req.params.id); res.status(204).send(); } catch { res.status(500).json({ message: "Erro ao excluir ementa" }); }
});

// ── AI History ───────────────────────────────────────────────────────────────
router.get("/ai-history", async (_req, res) => {
  try { res.json(await storage.getAiHistory()); } catch { res.status(500).json({ message: "Erro ao buscar histórico" }); }
});
router.post("/ai-history", async (req, res) => {
  try {
    const parsed = insertAiHistorySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    res.status(201).json(await storage.createAiHistory(parsed.data));
  } catch { res.status(500).json({ message: "Erro ao salvar histórico" }); }
});
router.delete("/ai-history/:id", async (req, res) => {
  try { await storage.deleteAiHistory(req.params.id); res.status(204).send(); } catch { res.status(500).json({ message: "Erro ao excluir histórico" }); }
});
router.delete("/ai-history", async (_req, res) => {
  try { await storage.clearAiHistory(); res.status(204).send(); } catch { res.status(500).json({ message: "Erro ao limpar histórico" }); }
});

// ── Prompt Templates ─────────────────────────────────────────────────────────
router.get("/prompt-templates", async (_req, res) => {
  try { res.json(await storage.getPromptTemplates()); } catch { res.status(500).json({ message: "Erro ao buscar templates" }); }
});
router.post("/prompt-templates", async (req, res) => {
  try {
    const parsed = insertPromptTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    res.status(201).json(await storage.createPromptTemplate(parsed.data));
  } catch { res.status(500).json({ message: "Erro ao criar template" }); }
});
router.patch("/prompt-templates/:id", async (req, res) => {
  try {
    const parsed = insertPromptTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    const t = await storage.updatePromptTemplate(req.params.id, parsed.data);
    if (!t) return res.status(404).json({ message: "Template não encontrado" });
    res.json(t);
  } catch { res.status(500).json({ message: "Erro ao atualizar template" }); }
});
router.delete("/prompt-templates/:id", async (req, res) => {
  try { await storage.deletePromptTemplate(req.params.id); res.status(204).send(); } catch { res.status(500).json({ message: "Erro ao excluir template" }); }
});

// ── Doc Templates ────────────────────────────────────────────────────────────
router.get("/doc-templates", async (_req, res) => {
  try { res.json(await storage.getDocTemplates()); } catch { res.status(500).json({ message: "Erro ao buscar modelos de doc" }); }
});
router.post("/doc-templates", async (req, res) => {
  try {
    const parsed = insertDocTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    res.status(201).json(await storage.createDocTemplate(parsed.data));
  } catch { res.status(500).json({ message: "Erro ao criar modelo de doc" }); }
});
router.patch("/doc-templates/:id", async (req, res) => {
  try {
    const parsed = insertDocTemplateSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    const t = await storage.updateDocTemplate(req.params.id, parsed.data);
    if (!t) return res.status(404).json({ message: "Modelo não encontrado" });
    res.json(t);
  } catch { res.status(500).json({ message: "Erro ao atualizar modelo" }); }
});
router.delete("/doc-templates/:id", async (req, res) => {
  try { await storage.deleteDocTemplate(req.params.id); res.status(204).send(); } catch { res.status(500).json({ message: "Erro ao excluir modelo" }); }
});

// ── Processos Monitorados ────────────────────────────────────────────────────
router.get("/processos-monitorados", async (_req, res) => {
  try { res.json(await storage.getProcessosMonitorados()); } catch { res.status(500).json({ message: "Erro ao buscar processos" }); }
});
router.post("/processos-monitorados", async (req, res) => {
  try {
    const parsed = insertProcessoMonitoradoSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "Dados inválidos" });
    res.status(201).json(await storage.createProcessoMonitorado(parsed.data));
  } catch { res.status(500).json({ message: "Erro ao criar processo" }); }
});
router.patch("/processos-monitorados/:id", async (req, res) => {
  try {
    const p = await storage.updateProcessoMonitorado(req.params.id, req.body);
    if (!p) return res.status(404).json({ message: "Processo não encontrado" });
    res.json(p);
  } catch { res.status(500).json({ message: "Erro ao atualizar processo" }); }
});
router.delete("/processos-monitorados/:id", async (req, res) => {
  try { await storage.deleteProcessoMonitorado(req.params.id); res.status(204).send(); } catch { res.status(500).json({ message: "Erro ao excluir processo" }); }
});

// ── Shared Pareceres ─────────────────────────────────────────────────────────
router.post("/share/parecer", async (req, res) => {
  try {
    const { html, processo } = req.body;
    if (!html) return res.status(400).json({ message: "HTML obrigatório" });
    const sanitized = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "").replace(/on\w+\s*=\s*"[^"]*"/gi, "");
    const id = Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    await storage.createSharedParecer(id, sanitized, processo || "");
    const url = `${req.protocol}://${req.get("host")}/parecer/${id}`;
    res.json({ id, url });
  } catch { res.status(500).json({ message: "Erro ao compartilhar parecer" }); }
});

// ── Tramitação ───────────────────────────────────────────────────────────────
router.get("/tramitacao/publicacoes", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    res.json(await storage.getTramitacaoPublicacoes(limit));
  } catch { res.status(500).json({ message: "Erro ao buscar publicações" }); }
});
router.patch("/tramitacao/publicacoes/:id/lida", async (req, res) => {
  try {
    const { lida } = req.body;
    await storage.markPublicacaoLida(req.params.id, lida || "sim");
    res.json({ ok: true });
  } catch { res.status(500).json({ message: "Erro ao marcar como lida" }); }
});
router.post("/webhooks/tramitacao", async (req, res) => {
  try {
    const payload = req.body;
    if (payload?.event_type === "publications.created" && Array.isArray(payload?.payload?.publications)) {
      for (const pub of payload.payload.publications) {
        await storage.upsertTramitacaoPublicacao({
          extId: String(pub.id), idempotencyKey: payload.idempotency_key,
          numeroProcesso: pub.numero_processo || "", numeroProcessoMascara: pub.numero_processo_com_mascara || "",
          tribunal: pub.siglaTribunal || "", orgao: pub.nomeOrgao || "", classe: pub.nomeClasse || "",
          texto: pub.texto || "", disponibilizacaoDate: pub.disponibilizacao_date || "",
          publicacaoDate: pub.publication_date || "", inicioPrazoDate: pub.inicio_do_prazo_date || "",
          linkTramitacao: pub.link_tramitacao || "", linkTribunal: pub.link || "",
          destinatarios: JSON.stringify(pub.destinatarios || []), advogados: JSON.stringify(pub.destinatario_advogados || []),
        });
      }
    }
    res.json({ ok: true });
  } catch (e: any) { res.status(500).json({ message: e.message }); }
});

// ── AI Usage Summary ─────────────────────────────────────────────────────────
router.get("/ai-usage-summary", async (_req, res) => {
  try {
    const history = await storage.getAiHistory();
    const byProvider: Record<string, { calls: number; inputTokens: number; outputTokens: number; cost: number }> = {};
    let totalCost = 0, totalCalls = 0;
    for (const h of history) {
      const prov = (h as any).provider || "Desconhecido";
      if (!byProvider[prov]) byProvider[prov] = { calls: 0, inputTokens: 0, outputTokens: 0, cost: 0 };
      byProvider[prov].calls++;
      byProvider[prov].inputTokens += (h as any).inputTokens || 0;
      byProvider[prov].outputTokens += (h as any).outputTokens || 0;
      byProvider[prov].cost += (h as any).estimatedCost || 0;
      totalCost += (h as any).estimatedCost || 0;
      totalCalls++;
    }
    const credit = parseFloat((await storage.getSetting("user_credit")) || "0");
    res.json({ byProvider, totalCost: Math.round(totalCost * 10000) / 10000, totalCalls, credit, remaining: Math.round((credit - totalCost) * 10000) / 10000 });
  } catch { res.status(500).json({ message: "Erro ao buscar resumo" }); }
});

export default router;
