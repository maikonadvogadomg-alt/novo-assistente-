import {
  type User, type InsertUser, type Snippet, type InsertSnippet,
  type CustomAction, type InsertCustomAction, type Ementa, type InsertEmenta,
  type AiHistory, type InsertAiHistory, type PromptTemplate, type InsertPromptTemplate,
  type DocTemplate, type InsertDocTemplate, type SharedParecer,
  type ProcessoMonitorado, type InsertProcessoMonitorado,
  type AppSetting, type TramitacaoPublicacao,
  users, snippets, customActions, ementas, aiHistory, promptTemplates,
  docTemplates, sharedPareceres, processosMonitorados, appSettings, tramitacaoPublicacoes,
} from "@workspace/db";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq, desc } from "drizzle-orm";
import pg from "pg";
import { getLocalConfig, setLocalConfig, isAiKey, type LocalConfig } from "./local-config.js";

let pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});

export let db = drizzle(pool);
export { pool };

export async function reconnectDb(newUrl: string): Promise<void> {
  process.env.DATABASE_URL = newUrl;
  try { await pool.end(); } catch {}
  pool = new pg.Pool({ connectionString: newUrl, connectionTimeoutMillis: 8000 });
  db = drizzle(pool);
  _dbAvailable = null;
  _backend = new DatabaseStorage();
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getSnippets(): Promise<Snippet[]>;
  getSnippet(id: string): Promise<Snippet | undefined>;
  createSnippet(snippet: InsertSnippet): Promise<Snippet>;
  updateSnippetTitle(id: string, title: string): Promise<Snippet | undefined>;
  deleteSnippet(id: string): Promise<void>;
  getCustomActions(): Promise<CustomAction[]>;
  getCustomAction(id: string): Promise<CustomAction | undefined>;
  createCustomAction(action: InsertCustomAction): Promise<CustomAction>;
  updateCustomAction(id: string, action: InsertCustomAction): Promise<CustomAction | undefined>;
  deleteCustomAction(id: string): Promise<void>;
  getEmentas(): Promise<Ementa[]>;
  getEmenta(id: string): Promise<Ementa | undefined>;
  createEmenta(ementa: InsertEmenta): Promise<Ementa>;
  updateEmenta(id: string, ementa: InsertEmenta): Promise<Ementa | undefined>;
  deleteEmenta(id: string): Promise<void>;
  getAiHistory(): Promise<AiHistory[]>;
  createAiHistory(entry: InsertAiHistory): Promise<AiHistory>;
  deleteAiHistory(id: string): Promise<void>;
  clearAiHistory(): Promise<void>;
  getPromptTemplates(): Promise<PromptTemplate[]>;
  getPromptTemplate(id: string): Promise<PromptTemplate | undefined>;
  createPromptTemplate(template: InsertPromptTemplate): Promise<PromptTemplate>;
  updatePromptTemplate(id: string, template: InsertPromptTemplate): Promise<PromptTemplate | undefined>;
  deletePromptTemplate(id: string): Promise<void>;
  getDocTemplates(): Promise<DocTemplate[]>;
  getDocTemplate(id: string): Promise<DocTemplate | undefined>;
  createDocTemplate(template: InsertDocTemplate): Promise<DocTemplate>;
  updateDocTemplate(id: string, template: InsertDocTemplate): Promise<DocTemplate | undefined>;
  deleteDocTemplate(id: string): Promise<void>;
  getSharedParecer(id: string): Promise<SharedParecer | undefined>;
  createSharedParecer(id: string, html: string, processo: string): Promise<SharedParecer>;
  getProcessosMonitorados(): Promise<ProcessoMonitorado[]>;
  createProcessoMonitorado(p: InsertProcessoMonitorado): Promise<ProcessoMonitorado>;
  updateProcessoMonitorado(id: string, data: Partial<InsertProcessoMonitorado>): Promise<ProcessoMonitorado | undefined>;
  deleteProcessoMonitorado(id: string): Promise<void>;
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getTramitacaoPublicacoes(limit?: number): Promise<TramitacaoPublicacao[]>;
  upsertTramitacaoPublicacao(data: Omit<TramitacaoPublicacao, 'id' | 'lida' | 'createdAt'>): Promise<TramitacaoPublicacao>;
  markPublicacaoLida(id: string, lida: string): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string) { const [u] = await db.select().from(users).where(eq(users.id, id)); return u; }
  async getUserByUsername(username: string) { const [u] = await db.select().from(users).where(eq(users.username, username)); return u; }
  async createUser(u: InsertUser): Promise<User> { const [r] = await db.insert(users).values(u).returning(); return r; }

  async getSnippets() { return db.select().from(snippets); }
  async getSnippet(id: string) { const [s] = await db.select().from(snippets).where(eq(snippets.id, id)); return s; }
  async createSnippet(s: InsertSnippet): Promise<Snippet> { const [r] = await db.insert(snippets).values(s).returning(); return r; }
  async updateSnippetTitle(id: string, title: string) { const [r] = await db.update(snippets).set({ title }).where(eq(snippets.id, id)).returning(); return r; }
  async deleteSnippet(id: string) { await db.delete(snippets).where(eq(snippets.id, id)); }

  async getCustomActions() { return db.select().from(customActions); }
  async getCustomAction(id: string) { const [r] = await db.select().from(customActions).where(eq(customActions.id, id)); return r; }
  async createCustomAction(a: InsertCustomAction): Promise<CustomAction> { const [r] = await db.insert(customActions).values(a).returning(); return r; }
  async updateCustomAction(id: string, a: InsertCustomAction) { const [r] = await db.update(customActions).set(a).where(eq(customActions.id, id)).returning(); return r; }
  async deleteCustomAction(id: string) { await db.delete(customActions).where(eq(customActions.id, id)); }

  async getEmentas() { return db.select().from(ementas); }
  async getEmenta(id: string) { const [r] = await db.select().from(ementas).where(eq(ementas.id, id)); return r; }
  async createEmenta(e: InsertEmenta): Promise<Ementa> { const [r] = await db.insert(ementas).values(e).returning(); return r; }
  async updateEmenta(id: string, e: InsertEmenta) { const [r] = await db.update(ementas).set(e).where(eq(ementas.id, id)).returning(); return r; }
  async deleteEmenta(id: string) { await db.delete(ementas).where(eq(ementas.id, id)); }

  async getAiHistory() { return db.select().from(aiHistory).orderBy(desc(aiHistory.createdAt)); }
  async createAiHistory(e: InsertAiHistory): Promise<AiHistory> { const [r] = await db.insert(aiHistory).values(e).returning(); return r; }
  async deleteAiHistory(id: string) { await db.delete(aiHistory).where(eq(aiHistory.id, id)); }
  async clearAiHistory() { await db.delete(aiHistory); }

  async getPromptTemplates() { return db.select().from(promptTemplates); }
  async getPromptTemplate(id: string) { const [r] = await db.select().from(promptTemplates).where(eq(promptTemplates.id, id)); return r; }
  async createPromptTemplate(t: InsertPromptTemplate): Promise<PromptTemplate> { const [r] = await db.insert(promptTemplates).values(t).returning(); return r; }
  async updatePromptTemplate(id: string, t: InsertPromptTemplate) { const [r] = await db.update(promptTemplates).set(t).where(eq(promptTemplates.id, id)).returning(); return r; }
  async deletePromptTemplate(id: string) { await db.delete(promptTemplates).where(eq(promptTemplates.id, id)); }

  async getDocTemplates() { return db.select().from(docTemplates); }
  async getDocTemplate(id: string) { const [r] = await db.select().from(docTemplates).where(eq(docTemplates.id, id)); return r; }
  async createDocTemplate(t: InsertDocTemplate): Promise<DocTemplate> { const [r] = await db.insert(docTemplates).values(t).returning(); return r; }
  async updateDocTemplate(id: string, t: InsertDocTemplate) { const [r] = await db.update(docTemplates).set(t).where(eq(docTemplates.id, id)).returning(); return r; }
  async deleteDocTemplate(id: string) { await db.delete(docTemplates).where(eq(docTemplates.id, id)); }

  async getSharedParecer(id: string) { const [r] = await db.select().from(sharedPareceres).where(eq(sharedPareceres.id, id)); return r; }
  async createSharedParecer(id: string, html: string, processo: string): Promise<SharedParecer> {
    const [r] = await db.insert(sharedPareceres).values({ id, html, processo }).returning(); return r;
  }

  async getProcessosMonitorados() { return db.select().from(processosMonitorados).orderBy(desc(processosMonitorados.updatedAt)); }
  async createProcessoMonitorado(p: InsertProcessoMonitorado): Promise<ProcessoMonitorado> { const [r] = await db.insert(processosMonitorados).values(p).returning(); return r; }
  async updateProcessoMonitorado(id: string, data: Partial<InsertProcessoMonitorado>) { const [r] = await db.update(processosMonitorados).set({ ...data, updatedAt: new Date() }).where(eq(processosMonitorados.id, id)).returning(); return r; }
  async deleteProcessoMonitorado(id: string) { await db.delete(processosMonitorados).where(eq(processosMonitorados.id, id)); }

  async getSetting(key: string): Promise<string | null> {
    if (isAiKey(key)) { const local = getLocalConfig(key as keyof LocalConfig); if (local) return local; }
    try { const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key)); return row?.value ?? null; }
    catch { return getLocalConfig(key as keyof LocalConfig); }
  }

  async setSetting(key: string, value: string): Promise<void> {
    if (isAiKey(key)) setLocalConfig(key as keyof LocalConfig, value);
    try {
      await db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    } catch {
      if (!isAiKey(key)) throw new Error("Banco indisponível");
    }
  }

  async getTramitacaoPublicacoes(limit = 100) { return db.select().from(tramitacaoPublicacoes).orderBy(desc(tramitacaoPublicacoes.createdAt)).limit(limit); }
  async upsertTramitacaoPublicacao(data: any): Promise<TramitacaoPublicacao> {
    const [created] = await db.insert(tramitacaoPublicacoes).values(data).onConflictDoNothing().returning();
    if (created) return created;
    const [existing] = await db.select().from(tramitacaoPublicacoes).where(eq(tramitacaoPublicacoes.extId, data.extId));
    return existing;
  }
  async markPublicacaoLida(id: string, lida: string) { await db.update(tramitacaoPublicacoes).set({ lida }).where(eq(tramitacaoPublicacoes.id, id)); }
}

function uid() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }

export class MemoryStorage implements IStorage {
  private _users: User[] = [];
  private _snippets: Snippet[] = [];
  private _actions: CustomAction[] = [];
  private _ementas: Ementa[] = [];
  private _history: AiHistory[] = [];
  private _prompts: PromptTemplate[] = [];
  private _docs: DocTemplate[] = [];
  private _pareceres: SharedParecer[] = [];
  private _processos: ProcessoMonitorado[] = [];
  private _tramitacao: TramitacaoPublicacao[] = [];

  async getUser(id: string) { return this._users.find(u => u.id === id); }
  async getUserByUsername(u: string) { return this._users.find(x => x.username === u); }
  async createUser(u: InsertUser): Promise<User> { const r = { id: uid(), ...u } as User; this._users.push(r); return r; }

  async getSnippets() { return [...this._snippets]; }
  async getSnippet(id: string) { return this._snippets.find(s => s.id === id); }
  async createSnippet(s: InsertSnippet): Promise<Snippet> { const r = { id: uid(), title: "Untitled", mode: "html", html: "", css: "", js: "", ...s } as Snippet; this._snippets.push(r); return r; }
  async updateSnippetTitle(id: string, title: string) { const s = this._snippets.find(x => x.id === id); if (s) s.title = title; return s; }
  async deleteSnippet(id: string) { this._snippets = this._snippets.filter(s => s.id !== id); }

  async getCustomActions() { return [...this._actions]; }
  async getCustomAction(id: string) { return this._actions.find(a => a.id === id); }
  async createCustomAction(a: InsertCustomAction): Promise<CustomAction> { const r = { id: uid(), label: "", description: "", prompt: "", ...a } as CustomAction; this._actions.push(r); return r; }
  async updateCustomAction(id: string, a: InsertCustomAction) { const i = this._actions.findIndex(x => x.id === id); if (i >= 0) { this._actions[i] = { ...this._actions[i], ...a }; return this._actions[i]; } return undefined; }
  async deleteCustomAction(id: string) { this._actions = this._actions.filter(a => a.id !== id); }

  async getEmentas() { return [...this._ementas]; }
  async getEmenta(id: string) { return this._ementas.find(e => e.id === id); }
  async createEmenta(e: InsertEmenta): Promise<Ementa> { const r = { id: uid(), categoria: "Geral", titulo: "", texto: "", ...e } as Ementa; this._ementas.push(r); return r; }
  async updateEmenta(id: string, e: InsertEmenta) { const i = this._ementas.findIndex(x => x.id === id); if (i >= 0) { this._ementas[i] = { ...this._ementas[i], ...e }; return this._ementas[i]; } return undefined; }
  async deleteEmenta(id: string) { this._ementas = this._ementas.filter(e => e.id !== id); }

  async getAiHistory() { return [...this._history].reverse().slice(0, 200); }
  async createAiHistory(e: InsertAiHistory): Promise<AiHistory> { const r = { id: uid(), createdAt: new Date(), model: "", provider: "", inputTokens: 0, outputTokens: 0, estimatedCost: 0, inputPreview: "", chatHistory: [], ...e } as AiHistory; this._history.push(r); return r; }
  async deleteAiHistory(id: string) { this._history = this._history.filter(h => h.id !== id); }
  async clearAiHistory() { this._history = []; }

  async getPromptTemplates() { return [...this._prompts]; }
  async getPromptTemplate(id: string) { return this._prompts.find(p => p.id === id); }
  async createPromptTemplate(t: InsertPromptTemplate): Promise<PromptTemplate> { const r = { id: uid(), categoria: "Geral", titulo: "", texto: "", ...t } as PromptTemplate; this._prompts.push(r); return r; }
  async updatePromptTemplate(id: string, t: InsertPromptTemplate) { const i = this._prompts.findIndex(x => x.id === id); if (i >= 0) { this._prompts[i] = { ...this._prompts[i], ...t }; return this._prompts[i]; } return undefined; }
  async deletePromptTemplate(id: string) { this._prompts = this._prompts.filter(p => p.id !== id); }

  async getDocTemplates() { return [...this._docs]; }
  async getDocTemplate(id: string) { return this._docs.find(d => d.id === id); }
  async createDocTemplate(t: InsertDocTemplate): Promise<DocTemplate> { const r = { id: uid(), categoria: "Geral", titulo: "", conteudo: "", docxBase64: null, docxFilename: null, ...t } as DocTemplate; this._docs.push(r); return r; }
  async updateDocTemplate(id: string, t: InsertDocTemplate) { const i = this._docs.findIndex(x => x.id === id); if (i >= 0) { this._docs[i] = { ...this._docs[i], ...t }; return this._docs[i]; } return undefined; }
  async deleteDocTemplate(id: string) { this._docs = this._docs.filter(d => d.id !== id); }

  async getSharedParecer(id: string) { return this._pareceres.find(p => p.id === id); }
  async createSharedParecer(id: string, html: string, processo: string): Promise<SharedParecer> { const r = { id, html, processo, createdAt: new Date() } as SharedParecer; this._pareceres.push(r); return r; }

  async getProcessosMonitorados() { return [...this._processos]; }
  async createProcessoMonitorado(p: InsertProcessoMonitorado): Promise<ProcessoMonitorado> { const r = { id: uid(), apelido: "", classe: "", orgaoJulgador: "", dataAjuizamento: "", ultimaMovimentacao: "", ultimaMovimentacaoData: "", assuntos: "", status: "ativo", createdAt: new Date(), updatedAt: new Date(), ...p } as ProcessoMonitorado; this._processos.push(r); return r; }
  async updateProcessoMonitorado(id: string, data: Partial<InsertProcessoMonitorado>) { const i = this._processos.findIndex(x => x.id === id); if (i >= 0) { this._processos[i] = { ...this._processos[i], ...data, updatedAt: new Date() }; return this._processos[i]; } return undefined; }
  async deleteProcessoMonitorado(id: string) { this._processos = this._processos.filter(p => p.id !== id); }

  async getSetting(key: string): Promise<string | null> { return getLocalConfig(key as any) || null; }
  async setSetting(key: string, value: string): Promise<void> { if (isAiKey(key)) setLocalConfig(key as any, value); }

  async getTramitacaoPublicacoes(limit = 100) { return this._tramitacao.slice(0, limit); }
  async upsertTramitacaoPublicacao(data: any): Promise<TramitacaoPublicacao> {
    const existing = this._tramitacao.find(t => t.extId === data.extId);
    if (existing) return existing;
    const r = { id: uid(), lida: "nao", createdAt: new Date(), idempotencyKey: null, ...data } as TramitacaoPublicacao;
    this._tramitacao.push(r); return r;
  }
  async markPublicacaoLida(id: string, lida: string) { const t = this._tramitacao.find(x => x.id === id); if (t) t.lida = lida; }
}

let _dbAvailable: boolean | null = null;
let _backend: DatabaseStorage | MemoryStorage = new DatabaseStorage();

export async function checkDbAndInitStorage(): Promise<boolean> {
  if (_dbAvailable !== null) return _dbAvailable;
  try {
    const client = await pool.connect();
    client.release();
    _dbAvailable = true;
    console.log("[storage] PostgreSQL conectado");
  } catch (e: any) {
    _dbAvailable = false;
    _backend = new MemoryStorage();
    console.warn("[storage] Banco indisponível — usando memória");
  }
  return _dbAvailable;
}

export const storage: IStorage = new Proxy({} as any, {
  get(_t, prop) { return (_backend as any)[prop].bind(_backend); },
});
