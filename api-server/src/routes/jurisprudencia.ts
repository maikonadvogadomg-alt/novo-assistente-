import { Router } from "express";
import { storage } from "../storage.js";

const router = Router();

router.post("/jurisprudencia/buscar", async (req, res) => {
  try {
    const { q, tribunais, apiKey: clientKey } = req.body as { q: string; tribunais: string[]; apiKey?: string };
    if (!q?.trim()) return res.status(400).json({ message: "Termo de busca obrigatório" });

    const rawKey = (clientKey?.trim()) || (await storage.getSetting("datajud_api_key")) || "";
    if (!rawKey) {
      return res.status(400).json({
        message: "Chave DataJud não configurada. Acesse Configurações e insira sua chave CNJ (datajud-wiki.cnj.jus.br).",
      });
    }
    const DATAJUD_KEY = rawKey.startsWith("ApiKey ") ? rawKey : `ApiKey ${rawKey}`;

    const tribunalMap: Record<string, string> = {
      STJ: "stj", STF: "stf",
      TRF1: "trf1", TRF2: "trf2", TRF3: "trf3", TRF4: "trf4", TRF5: "trf5", TRF6: "trf6",
      TJMG: "tjmg", TJSP: "tjsp", TJRJ: "tjrj",
    };

    const tribunaisList = Array.isArray(tribunais) && tribunais.length > 0 ? tribunais : [];
    const indices = tribunaisList.length > 0
      ? tribunaisList.map(t => `api_publica_${tribunalMap[t] || t.toLowerCase()}`)
      : ["api_publica_stj", "api_publica_trf1", "api_publica_trf6"];

    const payload = {
      size: 10,
      query: {
        bool: {
          should: [
            { match: { ementa: { query: q, boost: 5 } } },
            { match_phrase: { ementa: { query: q, boost: 8 } } },
            { match: { "assuntos.nome": { query: q, boost: 3 } } },
            { match: { "classe.nome": { query: q, boost: 2 } } },
          ],
          minimum_should_match: 1,
        },
      },
      sort: [{ _score: { order: "desc" } }, { dataAjuizamento: { order: "desc" } }],
    };

    const allResults: any[] = [];
    const errorMessages: string[] = [];
    let totalErrors = 0;

    for (const idx of indices) {
      try {
        const url = `https://api-publica.datajud.cnj.jus.br/${idx}/_search`;
        const cnjRes = await fetch(url, {
          method: "POST",
          headers: { Authorization: DATAJUD_KEY, "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!cnjRes.ok) {
          totalErrors++;
          errorMessages.push(`${idx.replace("api_publica_", "").toUpperCase()}: HTTP ${cnjRes.status}`);
          continue;
        }
        const data = await cnjRes.json() as any;
        for (const hit of data?.hits?.hits || []) {
          const s = hit._source || {};
          const numProc = s.numeroProcesso || "";
          const formatted = numProc.length === 20
            ? `${numProc.slice(0,7)}-${numProc.slice(7,9)}.${numProc.slice(9,13)}.${numProc.slice(13,14)}.${numProc.slice(14,16)}.${numProc.slice(16)}`
            : numProc;
          const assuntos = (s.assuntos || []).map((a: any) => a.nome).filter(Boolean).join(", ");
          const ultimoMov = (s.movimentos || []).slice(-1)[0];
          const orgao = s.orgaoJulgador?.nome || ultimoMov?.orgaoJulgador?.nome || "";
          const dataMov = s.dataAjuizamento
            ? (() => { const d = s.dataAjuizamento; return `${d.slice(6,8)}/${d.slice(4,6)}/${d.slice(0,4)}`; })()
            : ultimoMov?.dataHora ? new Date(ultimoMov.dataHora).toLocaleDateString("pt-BR") : "Não informado";
          allResults.push({
            tribunal: s.tribunal || idx.replace("api_publica_", "").toUpperCase(),
            tipo: s.classe?.nome || "Processo",
            processo: formatted,
            relator: orgao,
            data: dataMov,
            ementa: s.ementa || assuntos || "Sem ementa disponível",
            assuntos: assuntos || "",
            url: numProc ? `https://jurisprudencia.cnj.jus.br/pesquisa-unificada?numero=${numProc}` : null,
          });
        }
      } catch (err: any) {
        totalErrors++;
        errorMessages.push(`${idx.replace("api_publica_", "").toUpperCase()}: ${err.message}`);
      }
    }

    if (allResults.length === 0 && totalErrors === indices.length) {
      return res.status(503).json({ message: `DataJud temporariamente indisponível. Detalhes: ${errorMessages.join("; ")}` });
    }

    res.json({
      results: allResults.slice(0, 20),
      warnings: totalErrors > 0 && allResults.length > 0 ? [`Alguns tribunais não responderam: ${errorMessages.join("; ")}`] : undefined,
    });
  } catch (e: any) {
    res.status(500).json({ message: "Falha na comunicação com o DataJud. Verifique sua conexão." });
  }
});

export default router;
