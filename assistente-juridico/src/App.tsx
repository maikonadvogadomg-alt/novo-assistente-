import { useState, useEffect, Component, lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { Loader2 } from "lucide-react";

class ErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: string }
> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: "" };
  }
  static getDerivedStateFromError(error: any) {
    return { hasError: true, error: error?.message || "Erro desconhecido" };
  }
  componentDidCatch(error: any, info: any) {
    console.error("App crash:", error, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", background: "#0f172a", color: "#f1f5f9", fontFamily: "system-ui", padding: "2rem", textAlign: "center" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>⚠️</div>
          <h2 style={{ fontSize: "1.5rem", fontWeight: "bold", marginBottom: "0.5rem" }}>Algo deu errado</h2>
          <p style={{ color: "#94a3b8", marginBottom: "0.25rem", fontSize: "0.875rem" }}>{this.state.error}</p>
          <p style={{ color: "#64748b", marginBottom: "1.5rem", fontSize: "0.75rem" }}>Seu trabalho foi salvo automaticamente.</p>
          <button onClick={() => { this.setState({ hasError: false, error: "" }); }} style={{ background: "#3b82f6", color: "white", border: "none", padding: "0.75rem 2rem", borderRadius: "0.5rem", fontSize: "1rem", cursor: "pointer", fontWeight: "bold", marginBottom: "0.5rem" }}>Tentar novamente</button>
          <button onClick={() => window.location.reload()} style={{ background: "transparent", color: "#94a3b8", border: "1px solid #334155", padding: "0.5rem 1.5rem", borderRadius: "0.5rem", fontSize: "0.875rem", cursor: "pointer" }}>Recarregar página</button>
        </div>
      );
    }
    return this.props.children;
  }
}

function PageLoader() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
  );
}

const NotFound = lazy(() => import("@/pages/not-found"));
const Playground = lazy(() => import("@/pages/playground"));
const LegalAssistant = lazy(() => import("@/pages/legal-assistant"));
const TokenGenerator = lazy(() => import("@/pages/token-generator"));
const ComparadorJuridico = lazy(() => import("@/pages/comparador-juridico"));
const AuditoriaFinanceira = lazy(() => import("@/pages/auditoria-financeira"));
const ConsultaProcessual = lazy(() => import("@/pages/consulta-processual"));
const PainelProcessos = lazy(() => import("@/pages/painel-processos"));
const ConsultaCorporativo = lazy(() => import("@/pages/consulta-corporativo"));
const ConsultaPdpj = lazy(() => import("@/pages/consulta-pdpj"));
const TramitacaoPage = lazy(() => import("@/pages/tramitacao"));
const FiltradorJuridico = lazy(() => import("@/pages/filtrador"));
const PrevidenciarioPage = lazy(() => import("@/pages/previdenciario"));
const RoboDjenPage = lazy(() => import("@/pages/robo-djen"));
const LoginPage = lazy(() => import("@/pages/login"));
const Jurisprudencia = lazy(() => import("@/pages/jurisprudencia"));
const Codigo = lazy(() => import("@/pages/codigo"));
const ComunicacoesCnj = lazy(() => import("@/pages/comunicacoes-cnj"));
const Configuracoes = lazy(() => import("@/pages/configuracoes"));
const Ementas = lazy(() => import("@/pages/ementas"));
const Historico = lazy(() => import("@/pages/historico"));
const Admin = lazy(() => import("@/pages/admin"));

function Router() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Switch>
        <Route path="/" component={LegalAssistant} />
        <Route path="/jurisprudencia" component={Jurisprudencia} />
        <Route path="/assistente">{() => <Redirect to="/" />}</Route>
        <Route path="/playground" component={Playground} />
        <Route path="/token" component={TokenGenerator} />
        <Route path="/comparador" component={ComparadorJuridico} />
        <Route path="/auditoria" component={AuditoriaFinanceira} />
        <Route path="/consulta" component={ConsultaProcessual} />
        <Route path="/painel" component={PainelProcessos} />
        <Route path="/corporativo" component={ConsultaCorporativo} />
        <Route path="/pdpj" component={ConsultaPdpj} />
        <Route path="/tramitacao" component={TramitacaoPage} />
        <Route path="/filtrador" component={FiltradorJuridico} />
        <Route path="/previdenciario" component={PrevidenciarioPage} />
        <Route path="/robo-djen" component={RoboDjenPage} />
        <Route path="/codigo" component={Codigo} />
        <Route path="/comunicacoes" component={ComunicacoesCnj} />
        <Route path="/configuracoes" component={Configuracoes} />
        <Route path="/settings" component={Configuracoes} />
        <Route path="/ementas" component={Ementas} />
        <Route path="/historico" component={Historico} />
        <Route path="/admin" component={Admin} />
        <Route component={NotFound} />
      </Switch>
    </Suspense>
  );
}

function App() {
  const [authState, setAuthState] = useState<"loading" | "login" | "authenticated">("loading");

  useEffect(() => {
    fetch("/api/auth/check")
      .then(res => res.json())
      .then(data => {
        if (data.authenticated || !data.passwordRequired) {
          setAuthState("authenticated");
        } else {
          setAuthState("login");
        }
      })
      .catch(() => setAuthState("authenticated"));
  }, []);

  if (authState === "loading") {
    return (
      <ThemeProvider>
        <div className="min-h-screen flex items-center justify-center bg-background">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ThemeProvider>
    );
  }

  if (authState === "login") {
    return (
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider>
            <Toaster />
            <Suspense fallback={<PageLoader />}>
              <LoginPage onLogin={() => setAuthState("authenticated")} />
            </Suspense>
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <ErrorBoundary>
            <Router />
          </ErrorBoundary>
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
