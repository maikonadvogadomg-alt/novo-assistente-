import { Router } from "express";
import multer from "multer";
import mammoth from "mammoth";
import path from "path";
import { decode } from "html-entities";

const router = Router();

// 150MB limit — memoryStorage handles up to ~500MB in practice
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 150 * 1024 * 1024 },
});

// Converts HTML/XML to plain text PRESERVING line structure
function cleanHtml(html: string): string {
  let text = html;

  // Remove script/style blocks entirely
  text = text.replace(/<(script|style|noscript)[^>]*>[\s\S]*?<\/\1>/gi, "");

  // Block-level tags → newlines (before stripping tags)
  text = text.replace(/<\/(p|div|li|tr|blockquote|pre|section|article|header|footer|h[1-6]|td|th)\s*>/gi, "\n");
  text = text.replace(/<(br\s*\/?)>/gi, "\n");
  text = text.replace(/<(p|div|li|tr|h[1-6])[^>]*>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode HTML entities
  text = decode(text);

  // Normalize horizontal whitespace only — keep newlines
  text = text.replace(/[ \t]+/g, " ");
  text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Trim each line but keep the line
  text = text.split("\n").map(l => l.trim()).join("\n");

  // Collapse runs of 3+ blank lines to 2
  text = text.replace(/\n{3,}/g, "\n\n");

  return text.trim();
}

let _pdfjsWorkerSrcSet = false;
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
  if (!_pdfjsWorkerSrcSet) {
    const { pathToFileURL } = await import("url");
    const { createRequire } = await import("module");
    const req = createRequire(import.meta.url);
    const workerPath = req.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
    _pdfjsWorkerSrcSet = true;
  }

  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(buffer) });
  const pdfDocument = await loadingTask.promise;
  const numPages = pdfDocument.numPages;
  const pages: string[] = [];

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDocument.getPage(i);
    const textContent = await page.getTextContent();

    // Reconstruct text with proper line breaks using transform (y-position)
    const items = textContent.items as any[];
    let pageText = "";
    let lastY: number | null = null;
    for (const item of items) {
      if (!("str" in item)) continue;
      const y = item.transform?.[5];
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        pageText += "\n";
      }
      pageText += item.str;
      if (item.hasEOL) pageText += "\n";
      lastY = y;
    }
    pages.push(pageText.trim());
  }

  return pages.join("\n\n");
}

// /api/upload/extract-text — multiple files (ZIP2 format)
router.post("/upload/extract-text", upload.array("files", 20), async (req, res) => {
  try {
    const files = (req.files as Express.Multer.File[]) ||
      (req.file ? [req.file] : []);
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "Nenhum arquivo enviado" });
    }

    let combinedText = "";

    for (const file of files) {
      const ext = path.extname(file.originalname).toLowerCase();
      const mime = file.mimetype || "";
      let extractedText = "";

      try {
        const isPdf = ext === ".pdf" || mime === "application/pdf";
        const isDocx = ext === ".docx" || mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
        const isDoc = ext === ".doc" || mime === "application/msword";
        const isHtml = [".html", ".htm"].includes(ext) || mime.includes("html");
        const isXml = ext === ".xml" || mime.includes("xml");
        const isTxt = ext === ".txt" || mime === "text/plain";

        if (isPdf) {
          extractedText = await extractTextFromPDF(file.buffer);
        } else if (isDocx) {
          const result = await mammoth.extractRawText({ buffer: file.buffer });
          extractedText = result.value;
        } else if (isDoc) {
          try {
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            extractedText = result.value;
          } catch {
            extractedText = "(Formato .doc antigo não suportado. Salve como .docx)";
          }
        } else if (isHtml) {
          extractedText = cleanHtml(file.buffer.toString("utf-8"));
        } else if (isXml) {
          // XML: strip tags but preserve structure
          extractedText = cleanHtml(file.buffer.toString("utf-8"));
        } else if (isTxt || ext === "") {
          // Preserve all CR/LF exactly as-is
          extractedText = file.buffer.toString("utf-8");
        } else {
          // Try as UTF-8 text (handles .csv, .rtf etc.)
          try { extractedText = file.buffer.toString("utf-8"); } catch {}
        }
      } catch (err) {
        console.error(`Erro no arquivo ${file.originalname}:`, err);
      }

      if (extractedText && extractedText.trim().length > 0) {
        combinedText += (combinedText ? "\n\n---\n\n" : "") + extractedText;
      }
    }

    if (!combinedText || combinedText.trim().length < 5) {
      return res.status(422).json({
        message: "Não foi possível extrair texto do arquivo. O arquivo pode estar protegido, ser uma imagem escaneada ou estar vazio.",
      });
    }

    // Normalize line endings, collapse excessive blank lines — do NOT strip single newlines
    combinedText = combinedText.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    combinedText = combinedText.replace(/\n{4,}/g, "\n\n\n").trim();

    return res.json({ text: combinedText, chars: combinedText.length });
  } catch (error: any) {
    console.error("[upload/extract-text]", error);
    return res.status(500).json({ message: `Erro ao processar arquivo: ${error.message || "erro desconhecido"}` });
  }
});

// Also support single file at /api/extract-text (legacy path)
router.post("/extract-text", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: "Arquivo não enviado" });

  const { originalname, buffer, mimetype } = req.file;
  const ext = path.extname(originalname).toLowerCase();
  let text = "";

  try {
    if (ext === ".txt" || mimetype === "text/plain") {
      text = buffer.toString("utf-8");
    } else if (ext === ".pdf" || mimetype === "application/pdf") {
      text = await extractTextFromPDF(buffer);
    } else if (ext === ".docx" || mimetype === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
      const result = await mammoth.extractRawText({ buffer });
      text = result.value;
    } else if ([".html", ".htm"].includes(ext) || mimetype.includes("html")) {
      text = cleanHtml(buffer.toString("utf-8"));
    } else if (ext === ".xml" || mimetype.includes("xml")) {
      text = cleanHtml(buffer.toString("utf-8"));
    } else {
      return res.status(400).json({ message: `Formato não suportado: ${ext || mimetype}` });
    }

    text = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
    if (!text || text.length < 5) return res.status(422).json({ message: "Não foi possível extrair texto do arquivo." });
    return res.json({ text, chars: text.length, filename: originalname });
  } catch (error: any) {
    return res.status(500).json({ message: `Erro ao processar arquivo: ${error.message || "erro desconhecido"}` });
  }
});

// /api/import/url
router.post("/import/url", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ message: "URL inválida" });

    let parsedUrl: URL;
    try { parsedUrl = new URL(url); } catch { return res.status(400).json({ message: "URL mal formada" }); }
    if (!["http:", "https:"].includes(parsedUrl.protocol)) return res.status(400).json({ message: "Apenas URLs http/https são permitidas" });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(url, {
        signal: controller.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; LegalAssistant/1.0)" },
      });
    } finally { clearTimeout(timeout); }

    if (!response.ok) return res.status(502).json({ message: `Site retornou erro ${response.status}` });

    const contentType = response.headers.get("content-type") || "";
    let text = "";

    if (contentType.includes("application/pdf")) {
      const buf = Buffer.from(await response.arrayBuffer());
      text = await extractTextFromPDF(buf);
    } else {
      const html = await response.text();
      text = cleanHtml(html);
    }

    if (text.length < 100) return res.status(422).json({ message: "Não foi possível extrair texto desta página" });
    return res.json({ text: text.substring(0, 80000), length: text.length, url });
  } catch (err: any) {
    if (err?.name === "AbortError") return res.status(504).json({ message: "Tempo limite excedido ao acessar o link" });
    return res.status(500).json({ message: "Erro ao buscar o link" });
  }
});

// Legacy path alias
router.post("/import-url", async (req, res) => {
  try {
    const { url } = req.body;
    if (!url || typeof url !== "string") return res.status(400).json({ message: "URL inválida" });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let response: Response;
    try {
      response = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; LegalAssistant/1.0)" } });
    } finally { clearTimeout(timeout); }
    if (!response.ok) return res.status(502).json({ message: `Site retornou erro ${response.status}` });
    const contentType = response.headers.get("content-type") || "";
    let text = "";
    if (contentType.includes("application/pdf")) {
      const buf = Buffer.from(await response.arrayBuffer());
      text = await extractTextFromPDF(buf);
    } else {
      const html = await response.text();
      text = cleanHtml(html);
    }
    if (!text) return res.status(422).json({ message: "Nenhum texto encontrado" });
    return res.json({ text: text.substring(0, 80000), chars: text.length, url });
  } catch (err: any) {
    return res.status(500).json({ message: "Erro ao importar URL" });
  }
});

// /api/upload/transcribe — audio/video transcription via OpenAI-compatible API
router.post("/upload/transcribe", upload.array("files", 5), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ message: "Nenhum arquivo enviado" });
    }

    const { storage: storageModule } = await import("../storage.js");
    const dbKey = (await storageModule.getSetting("demo_api_key") || "").trim();
    const dbUrl = (await storageModule.getSetting("demo_api_url") || "").trim();

    if (!dbKey) {
      return res.status(400).json({ message: "Chave de API não configurada para transcrição. Configure nas Configurações." });
    }

    const OpenAI = (await import("openai")).default;
    const fs = await import("fs");
    const os = await import("os");
    const pathMod = await import("path");
    const { execFile } = await import("child_process");
    const { promisify } = await import("util");
    const execFileAsync = promisify(execFile);

    const apiUrl = dbUrl ? dbUrl.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "") : "https://api.openai.com/v1";
    const isGroq = apiUrl.includes("groq.com");
    const whisperModel = isGroq ? "whisper-large-v3" : "whisper-1";
    const client = new OpenAI({ apiKey: dbKey, baseURL: apiUrl });

    const results: { filename: string; text: string; error?: string }[] = [];
    const tmpDir = fs.mkdtempSync(pathMod.join(os.tmpdir(), "transcribe-"));

    for (const file of files) {
      const ext = pathMod.extname(file.originalname).toLowerCase().replace(".", "") || "bin";
      const isAudio = ["mp3", "wav", "m4a", "ogg", "oga", "opus", "ptt", "flac", "aac", "wma", "webm"].includes(ext) || file.mimetype.startsWith("audio/");
      const isVideo = ["mp4", "mov", "avi", "mkv", "wmv", "flv", "3gp", "m4v"].includes(ext) || file.mimetype.startsWith("video/");
      const needsConversion = ["ogg", "oga", "opus", "ptt", "wma", "webm", "flac", "aac"].includes(ext);

      if (!isAudio && !isVideo) {
        results.push({ filename: file.originalname, text: "", error: "Formato não suportado. Use audio (MP3, WAV, M4A, OGG, OPUS) ou video (MP4, MOV, AVI, MKV)." });
        continue;
      }

      const safeExt = ext.replace(/[^a-z0-9]/g, "") || "bin";
      const timestamp = Date.now();
      const inputPath = pathMod.join(tmpDir, `input_${timestamp}.${safeExt}`);
      let audioPath = inputPath;

      try {
        fs.writeFileSync(inputPath, file.buffer);

        if (isVideo || needsConversion) {
          audioPath = pathMod.join(tmpDir, `audio_${timestamp}.mp3`);
          try {
            await execFileAsync("ffmpeg", ["-i", inputPath, "-vn", "-acodec", "libmp3lame", "-q:a", "4", "-y", audioPath], { timeout: 120000 });
          } catch {
            results.push({ filename: file.originalname, text: "", error: "Erro ao converter arquivo. Verifique se o formato é suportado." });
            continue;
          }
        }

        const transcription = await client.audio.transcriptions.create({
          model: whisperModel,
          file: fs.createReadStream(audioPath),
          response_format: "json",
          language: "pt",
        });

        const text = typeof transcription === "string" ? transcription : (transcription as any).text || "";
        if (!text.trim()) {
          results.push({ filename: file.originalname, text: "", error: "Não foi possível transcrever. O áudio pode estar sem fala ou muito baixo." });
        } else {
          results.push({ filename: file.originalname, text: text.trim() });
        }
      } catch (e: any) {
        results.push({ filename: file.originalname, text: "", error: `Erro na transcrição: ${e.message || "erro desconhecido"}` });
      } finally {
        try { fs.unlinkSync(inputPath); } catch {}
        if (audioPath !== inputPath) { try { fs.unlinkSync(audioPath); } catch {} }
      }
    }

    try { fs.rmdirSync(tmpDir); } catch {}
    res.json({ results });
  } catch (error: any) {
    console.error("[upload/transcribe]", error);
    res.status(500).json({ message: "Erro ao transcrever arquivo" });
  }
});

export default router;
