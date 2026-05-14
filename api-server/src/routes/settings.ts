import { Router } from "express";
import { storage } from "../storage.js";
import { getLocalConfig, setLocalConfig, readLocalConfig, writeLocalConfig } from "../local-config.js";

const router = Router();

function sanitizeKey(raw: string): string {
  return (raw || "").split(/[\r\n]+/).map(l => l.trim()).filter(Boolean)[0] || "";
}

// Auth
router.get("/auth/check", (req, res) => {
  const appPassword = process.env.APP_PASSWORD || getLocalConfig("app_password");
  if (!appPassword) return res.json({ authenticated: true, passwordRequired: false });
  return res.json({ authenticated: !!(req.session as any)?.authenticated, passwordRequired: true });
});
router.post("/auth/login", (req, res) => {
  const appPassword = process.env.APP_PASSWORD || getLocalConfig("app_password");
  if (!appPassword) return res.json({ success: true });
  const { password } = req.body;
  if (password === appPassword) { (req.session as any).authenticated = true; return res.json({ success: true }); }
  return res.status(401).json({ message: "Senha incorreta" });
});
router.post("/auth/logout", (req, res) => {
  req.session?.destroy(() => {});
  return res.json({ success: true });
});

// AI Config
router.get("/settings/ai-config", async (_req, res) => {
  try {
    const geminiKey = await storage.getSetting("gemini_api_key") || "";
    const openaiKey = await storage.getSetting("openai_api_key") || "";
    const perplexityKey = await storage.getSetting("perplexity_api_key") || "";
    const demoKey = await storage.getSetting("demo_api_key") || "";
    const demoUrl = await storage.getSetting("demo_api_url") || "";
    const demoModel = await storage.getSetting("demo_api_model") || "";
    const datajudKey = await storage.getSetting("datajud_api_key") || "";
    res.json({
      geminiKey: geminiKey ? geminiKey.substring(0, 8) + "..." : "",
      openaiKey: openaiKey ? openaiKey.substring(0, 8) + "..." : "",
      perplexityKey: perplexityKey ? perplexityKey.substring(0, 8) + "..." : "",
      hasGemini: !!geminiKey, hasOpenAI: !!openaiKey,
      hasPerplexity: !!perplexityKey, hasDemo: !!demoKey,
      demoUrl, demoModel, datajudKey: datajudKey ? datajudKey.substring(0, 8) + "..." : "",
      hasDatajud: !!datajudKey,
    });
  } catch { res.status(500).json({ message: "Erro ao buscar configurações" }); }
});

router.put("/settings/ai-config", async (req, res) => {
  try {
    const { geminiKey, openaiKey, perplexityKey, demoKey, demoUrl, demoModel, datajudKey } = req.body;
    if (geminiKey !== undefined) await storage.setSetting("gemini_api_key", sanitizeKey(geminiKey));
    if (openaiKey !== undefined) await storage.setSetting("openai_api_key", sanitizeKey(openaiKey));
    if (perplexityKey !== undefined) await storage.setSetting("perplexity_api_key", sanitizeKey(perplexityKey));
    if (demoKey !== undefined) await storage.setSetting("demo_api_key", sanitizeKey(demoKey));
    if (demoUrl !== undefined) await storage.setSetting("demo_api_url", demoUrl.trim());
    if (demoModel !== undefined) await storage.setSetting("demo_api_model", demoModel.trim());
    if (datajudKey !== undefined) await storage.setSetting("datajud_api_key", sanitizeKey(datajudKey));
    res.json({ ok: true });
  } catch { res.status(500).json({ message: "Erro ao salvar configurações" }); }
});

router.get("/settings/system-status", async (_req, res) => {
  try {
    const cfg = readLocalConfig();
    const geminiKey = await storage.getSetting("gemini_api_key");
    const openaiKey = await storage.getSetting("openai_api_key");
    const perplexityKey = await storage.getSetting("perplexity_api_key");
    const demoKey = await storage.getSetting("demo_api_key");
    res.json({
      database: !!process.env.DATABASE_URL,
      gemini: !!geminiKey, openai: !!openaiKey,
      perplexity: !!perplexityKey, demo: !!demoKey,
      passwordProtected: !!(process.env.APP_PASSWORD || cfg.app_password),
    });
  } catch { res.status(500).json({ message: "Erro ao buscar status" }); }
});

router.put("/settings/app-password", async (req, res) => {
  try {
    const { password, currentPassword } = req.body;
    const existing = process.env.APP_PASSWORD || getLocalConfig("app_password");
    if (existing && currentPassword !== existing) return res.status(401).json({ message: "Senha atual incorreta" });
    if (password) {
      setLocalConfig("app_password", password);
      process.env.APP_PASSWORD = password;
    } else {
      const cfg = readLocalConfig();
      delete cfg.app_password;
      writeLocalConfig(cfg);
      delete process.env.APP_PASSWORD;
    }
    res.json({ ok: true });
  } catch { res.status(500).json({ message: "Erro ao atualizar senha" }); }
});

router.post("/settings/database-reconnect", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) return res.status(400).json({ message: "URL do banco obrigatória" });
    const { reconnectDb } = await import("../storage.js");
    await reconnectDb(url);
    setLocalConfig("database_url", url);
    res.json({ ok: true, message: "Banco reconectado com sucesso" });
  } catch (e: any) { res.status(500).json({ message: `Erro ao reconectar: ${e.message}` }); }
});

// Demo key endpoints (sem auth)
router.get("/demo-key-status", async (_req, res) => {
  const demoKey = await storage.getSetting("demo_api_key") || "";
  const demoModel = await storage.getSetting("demo_api_model") || "";
  const demoUrl = await storage.getSetting("demo_api_url") || "";
  res.json({ hasPublicKey: !!demoKey, model: demoKey ? (demoModel || "gpt-4o-mini") : null, url: demoKey ? demoUrl : null });
});

router.get("/demo-key-config", async (_req, res) => {
  const key = await storage.getSetting("demo_api_key") || "";
  const model = await storage.getSetting("demo_api_model") || "";
  const url = await storage.getSetting("demo_api_url") || "";
  res.json({ hasKey: !!key, model, url });
});

router.post("/demo-key-config", async (req, res) => {
  const { key, model, url, perplexityKey } = req.body;
  if (key !== undefined) await storage.setSetting("demo_api_key", sanitizeKey(key));
  if (model !== undefined) await storage.setSetting("demo_api_model", model.trim());
  if (url !== undefined) await storage.setSetting("demo_api_url", url.trim());
  if (perplexityKey !== undefined) await storage.setSetting("perplexity_api_key", sanitizeKey(perplexityKey));
  res.json({ ok: true });
});

router.get("/perplexity-key-status", async (_req, res) => {
  const k = await storage.getSetting("perplexity_api_key") || "";
  res.json({ configured: !!k, masked: k ? k.substring(0, 8) + "..." : "" });
});

// TTS
router.post("/tts", async (req, res) => {
  const { text } = req.body;
  if (!text || typeof text !== "string") return res.status(400).json({ message: "Texto obrigatório" });
  const { execFile } = await import("child_process");
  const { promisify } = await import("util");
  const fs = await import("fs");
  const execFileAsync = promisify(execFile);
  const txtFile = `/tmp/tts_in_${Date.now()}.txt`;
  const mp3File = `/tmp/tts_out_${Date.now()}.mp3`;
  try {
    const cleanText = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4096);
    fs.writeFileSync(txtFile, cleanText, "utf8");
    await execFileAsync("python3", ["-m", "edge_tts", "--file", txtFile, "--voice", "pt-BR-FranciscaNeural", "--rate=+18%", "--write-media", mp3File], { timeout: 45000 });
    const audioBuffer = fs.readFileSync(mp3File);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length);
    res.send(audioBuffer);
  } catch (error: any) {
    res.status(500).json({ message: `Erro ao gerar áudio: ${error.message || "erro desconhecido"}` });
  } finally {
    try { fs.unlinkSync(txtFile); } catch {}
    try { fs.unlinkSync(mp3File); } catch {}
  }
});

// Export DOCX
router.post("/export/docx", async (req, res) => {
  try {
    const { html, filename } = req.body;
    if (!html) return res.status(400).json({ message: "HTML obrigatório" });
    const { Document, Paragraph, TextRun, Packer, AlignmentType, HeadingLevel } = await import("docx");
    const text = html.replace(/<[^>]+>/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    const lines = text.split("\n");
    const paragraphs = lines.map((line: string) => {
      const trimmed = line.trim();
      const isTitle = trimmed === trimmed.toUpperCase() && trimmed.length > 3 && trimmed.length < 100;
      return new Paragraph({
        children: [new TextRun({ text: trimmed || " ", bold: isTitle, size: isTitle ? 26 : 24 })],
        alignment: isTitle ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
        spacing: { line: 360, after: isTitle ? 200 : 0 },
        indent: isTitle ? undefined : { firstLine: 720 },
      });
    });
    const doc = new Document({ sections: [{ properties: {}, children: paragraphs }] });
    const buffer = await Packer.toBuffer(doc);
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    res.setHeader("Content-Disposition", `attachment; filename="${filename || "documento"}.docx"`);
    res.send(buffer);
  } catch (e: any) { res.status(500).json({ message: `Erro ao exportar: ${e.message}` }); }
});

// AI usage summary
router.get("/ai-usage-summary", async (_req, res) => {
  try {
    const credit = parseFloat(await storage.getSetting("user_credit") || "0") || 0;
    res.json({ byProvider: {}, totalCost: 0, totalCalls: 0, credit, remaining: credit });
  } catch { res.json({ byProvider: {}, totalCost: 0, totalCalls: 0, credit: 0, remaining: 0 }); }
});

// Git push stub (feature not yet implemented)
router.post("/git-push", async (_req, res) => {
  res.json({ ok: false, message: "Sincronização com Git não configurada neste ambiente." });
});

// ── DB Test & Init ────────────────────────────────────────────────────────────
router.get("/settings/db-status", async (_req, res) => {
  try {
    const { pool } = await import("../storage.js");
    const client = await (pool as any).connect();
    await client.query("SELECT 1");
    client.release();
    const url = process.env.DATABASE_URL || getLocalConfig("database_url") || "";
    const safeUrl = url ? url.replace(/:([^:@]+)@/, ":***@") : "";
    res.json({ connected: true, url: safeUrl });
  } catch (e: any) {
    res.json({ connected: false, error: e.message?.substring(0, 200) || "Erro desconhecido" });
  }
});

router.post("/settings/db-test", async (req, res) => {
  const testUrl = ((req.body?.url as string) || "").trim()
    || process.env.DATABASE_URL
    || getLocalConfig("database_url")
    || "";
  if (!testUrl) return res.status(400).json({ ok: false, message: "URL do banco não fornecida" });
  let testPool: any = null;
  try {
    const pg = await import("pg");
    testPool = new pg.default.Pool({ connectionString: testUrl, connectionTimeoutMillis: 6000 });
    const client = await testPool.connect();
    await client.query("SELECT 1");
    client.release();
    const safe = testUrl.replace(/:([^:@]+)@/, ":***@");
    res.json({ ok: true, message: `Conexão bem-sucedida: ${safe}` });
  } catch (e: any) {
    res.json({ ok: false, message: `Falha na conexão: ${e.message?.substring(0, 200) || "erro desconhecido"}` });
  } finally {
    if (testPool) testPool.end().catch(() => {});
  }
});

router.post("/settings/db-init", async (_req, res) => {
  try {
    const { pool } = await import("../storage.js");
    const result = await (pool as any).query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    const names: string[] = (result.rows || []).map((r: any) => r.table_name);
    res.json({ ok: true, tables: names });
  } catch (e: any) {
    res.json({ ok: false, error: e.message?.substring(0, 300) });
  }
});

// ── PWA App Info ──────────────────────────────────────────────────────────────
router.get("/settings/app-info", async (_req, res) => {
  res.json({
    version: "1.0.0",
    nodeVersion: process.version,
    platform: process.platform,
    uptime: Math.floor(process.uptime()),
    memoryMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    databaseUrl: !!(process.env.DATABASE_URL || getLocalConfig("database_url")),
  });
});

// ── Env Variables Admin ───────────────────────────────────────────────────────

const SENSITIVE_KEYS = ["KEY", "SECRET", "PASSWORD", "TOKEN", "DATABASE_URL", "SESSION"];

function isSensitive(key: string) {
  return SENSITIVE_KEYS.some(s => key.toUpperCase().includes(s));
}

function maskValue(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return value.slice(0, 3) + "••••••••" + value.slice(-2);
}

router.get("/settings/env-list", async (_req, res) => {
  const localCfg = (() => {
    try { return getLocalConfig as any; } catch { return null; }
  })();

  const CONFIG_KEYS = [
    "DATABASE_URL", "SESSION_SECRET", "NODE_ENV", "PORT",
    "gemini_api_key", "openai_api_key", "groq_api_key", "perplexity_api_key",
    "custom_api_key", "custom_model", "custom_base_url",
    "google_drive_folder_id", "google_drive_access_token",
    "app_password", "datajud_api_key",
  ];

  const vars = CONFIG_KEYS.map(key => {
    const envVal = process.env[key];
    const cfgVal = getLocalConfig(key as any) as string | undefined;
    const value = envVal || cfgVal || "";
    const source = envVal ? "env" : cfgVal ? "config" : "env";
    const sensitive = isSensitive(key);
    return {
      key,
      value: sensitive ? maskValue(value) : value,
      source,
      sensitive,
      set: !!value,
    };
  });

  res.json({ ok: true, vars });
});

router.post("/settings/env-set", async (req, res) => {
  const { key, value } = req.body as { key: string; value: string };
  if (!key || typeof key !== "string") {
    return res.status(400).json({ ok: false, message: "key é obrigatório" });
  }
  try {
    const { setLocalConfig } = await import("../local-config.js");
    setLocalConfig(key as any, value ?? "");
    // Aplica imediatamente no process.env para efeito na sessão atual
    if (value) process.env[key] = value;
    return res.json({ ok: true, message: `${key} definido com sucesso` });
  } catch (e: any) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

// ── DB SQL Query (somente SELECT) ─────────────────────────────────────────────
router.post("/settings/db-query", async (req, res) => {
  const { query } = req.body as { query: string };
  if (!query || typeof query !== "string") {
    return res.status(400).json({ ok: false, error: "query é obrigatória" });
  }
  // Segurança: apenas SELECT
  const safe = query.trim().toUpperCase();
  if (!safe.startsWith("SELECT") && !safe.startsWith("SHOW") && !safe.startsWith("EXPLAIN")) {
    return res.status(403).json({ ok: false, error: "Apenas consultas SELECT são permitidas" });
  }
  try {
    const { pool } = await import("../storage.js");
    if (!pool) return res.status(503).json({ ok: false, error: "Banco não conectado" });
    const result = await (pool as any).query(query.trim());
    return res.json({ ok: true, rows: result.rows, rowCount: result.rowCount });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: e.message });
  }
});

// ── Google Drive Upload ────────────────────────────────────────────────────────
router.post("/settings/drive-upload", async (req, res) => {
  const { html, filename } = req.body as { html: string; filename?: string };
  if (!html) return res.status(400).json({ ok: false, message: "html é obrigatório" });

  const accessToken = getLocalConfig("google_drive_access_token") as string | undefined;
  const folderId = getLocalConfig("google_drive_folder_id") as string | undefined;

  if (!accessToken) {
    return res.status(400).json({
      ok: false,
      message: "Token de acesso do Google Drive não configurado. Acesse Configurações → Google Drive.",
    });
  }

  try {
    // Gerar DOCX a partir do HTML usando o módulo docx já disponível
    const { Packer, Document, Paragraph: DocxParagraph } = await import("docx");
    const doc = new Document({
      sections: [{
        children: [new DocxParagraph({ text: html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim() })],
      }],
    });
    const buf = await Packer.toBuffer(doc);
    const fname = (filename || "documento-juridico") + ".docx";

    // Metadados do arquivo
    const metadata = JSON.stringify({
      name: fname,
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ...(folderId ? { parents: [folderId] } : {}),
    });

    // Multipart upload para Drive API
    const boundary = "upload_boundary_juridico";
    const parts = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadata}\r\n`,
      `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document\r\n\r\n`,
    ];
    const closing = `\r\n--${boundary}--`;

    const bodyParts: Buffer[] = [
      Buffer.from(parts[0], "utf8"),
      Buffer.from(parts[1], "utf8"),
      buf,
      Buffer.from(closing, "utf8"),
    ];
    const body = Buffer.concat(bodyParts);

    const uploadRes = await fetch(
      "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": `multipart/related; boundary=${boundary}`,
          "Content-Length": String(body.length),
        },
        body,
      },
    );

    if (!uploadRes.ok) {
      const err = await uploadRes.text();
      return res.status(400).json({ ok: false, message: `Erro Google Drive: ${err.slice(0, 200)}` });
    }

    const file = await uploadRes.json() as { id: string; name: string; webViewLink?: string };
    return res.json({ ok: true, fileId: file.id, name: file.name, link: file.webViewLink });
  } catch (e: any) {
    return res.status(500).json({ ok: false, message: e.message });
  }
});

export default router;
