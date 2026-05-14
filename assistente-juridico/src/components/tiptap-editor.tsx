import { useEditor, EditorContent, Extension } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Paragraph from "@tiptap/extension-paragraph";
import { Heading } from "@tiptap/extension-heading";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import Link from "@tiptap/extension-link";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableCell } from "@tiptap/extension-table-cell";
import { TableHeader } from "@tiptap/extension-table-header";
import { useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import {
  Bold, Italic, Underline as UnderlineIcon, AlignLeft, AlignCenter,
  AlignRight, AlignJustify, Link as LinkIcon, Highlighter, Type,
  Table as TableIcon, Plus, Trash2, ChevronDown,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Toggle } from "@/components/ui/toggle";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

// ── Custom FontSize extension ──────────────────────────────────────────────────
const FontSize = Extension.create({
  name: "fontSize",
  addGlobalAttributes() {
    return [
      {
        types: ["textStyle"],
        attributes: {
          fontSize: {
            default: null,
            parseHTML: el => el.style.fontSize || null,
            renderHTML: attrs => {
              if (!attrs.fontSize) return {};
              return { style: `font-size: ${attrs.fontSize}` };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      setFontSize:
        (size: string) =>
        ({ chain }: any) =>
          chain().setMark("textStyle", { fontSize: size }).run(),
      unsetFontSize:
        () =>
        ({ chain }: any) =>
          chain().setMark("textStyle", { fontSize: null }).removeEmptyTextStyle().run(),
    } as any;
  },
});

// ── StyledParagraph — preserva atributo style (formatação ABNT) ────────────────
const StyledParagraph = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("style") || null,
        renderHTML: (attrs: any) => (attrs.style ? { style: attrs.style } : {}),
      },
      class: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("class") || null,
        renderHTML: (attrs: any) => (attrs.class ? { class: attrs.class } : {}),
      },
    };
  },
});

// ── StyledHeading — preserva atributo style em títulos ────────────────────────
const StyledHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("style") || null,
        renderHTML: (attrs: any) => (attrs.style ? { style: attrs.style } : {}),
      },
      class: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("class") || null,
        renderHTML: (attrs: any) => (attrs.class ? { class: attrs.class } : {}),
      },
    };
  },
});

interface TipTapEditorProps {
  content?: string;
  initialData?: string;
  onChange?: (html: string) => void;
  onReady?: (editor: any) => void;
  className?: string;
  placeholder?: string;
  readOnly?: boolean;
}

export function TipTapEditor({
  content = "",
  initialData,
  onChange,
  onReady,
  className,
  placeholder = "Comece a digitar o documento jurídico...",
  readOnly = false,
}: TipTapEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const effectiveContent = content || initialData || "";

  // Previne que onChange dispare durante setContent programático
  const settingRef = useRef(false);
  // Rastreia se o usuário já editou — evita sobrescrever edições com atualização externa
  const userEditedRef = useRef(false);
  // Última versão de conteúdo externo recebida
  const prevContentRef = useRef<string>("");

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // Desabilita paragraph e heading padrão para usar versões com style preservado
        paragraph: false,
        heading: false,
        hardBreak: { keepMarks: true },
      }),
      StyledParagraph,
      StyledHeading.configure({ levels: [1, 2, 3] }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      FontSize,
      Underline,
      Highlight.configure({ multicolor: true }),
      Link.configure({ openOnClick: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: "",
    editable: !readOnly,
    onUpdate({ editor }) {
      if (!settingRef.current) {
        userEditedRef.current = true;
        onChangeRef.current?.(editor.getHTML());
      }
    },
    onCreate({ editor }) {
      onReady?.(editor);
    },
  });

  // Atualiza editable quando readOnly muda
  useEffect(() => {
    if (editor) editor.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Define conteúdo externo (gerado pela IA) — não sobrescreve edições do usuário
  useEffect(() => {
    if (!editor || !effectiveContent) return;
    // Mesmo conteúdo — ignorar
    if (effectiveContent === prevContentRef.current) return;
    prevContentRef.current = effectiveContent;
    // Não sobrescrever se usuário já editou (a não ser que venha nova geração de IA)
    // userEditedRef é resetado quando chega conteúdo NOVO (diferente do que foi editado)
    settingRef.current = true;
    // Em v3, setContent emite onUpdate mas settingRef.current bloqueia o propagate
    (editor.commands as any).setContent(effectiveContent, false);
    settingRef.current = false;
    // Resetar flag de edição pois agora temos conteúdo externo novo
    userEditedRef.current = false;
  }, [editor, effectiveContent]);

  const setLink = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("URL do link:");
    if (url === null) return;
    if (url === "") { editor.chain().focus().unsetLink().run(); return; }
    editor.chain().focus().setLink({ href: url }).run();
  }, [editor]);

  const insertTable = useCallback(() => {
    if (!editor) return;
    editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
  }, [editor]);

  if (!editor) return null;

  const FONT_SIZES = ["10px", "11px", "12px", "13px", "14px", "16px", "18px", "20px", "24px", "28px", "32px", "36px", "48px"];

  return (
    <div className={cn("tiptap-editor-content flex flex-col border border-border rounded-lg overflow-hidden bg-white dark:bg-zinc-900", className)}>
      {/* Toolbar */}
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 px-2 py-1.5 border-b border-border bg-muted/40 dark:bg-zinc-800/60">
          {/* Negrito / Itálico / Sublinhado / Realce */}
          <Toggle size="sm" pressed={editor.isActive("bold")}
            onPressedChange={() => editor.chain().focus().toggleBold().run()} title="Negrito (Ctrl+B)">
            <Bold className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle size="sm" pressed={editor.isActive("italic")}
            onPressedChange={() => editor.chain().focus().toggleItalic().run()} title="Itálico (Ctrl+I)">
            <Italic className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle size="sm" pressed={editor.isActive("underline")}
            onPressedChange={() => editor.chain().focus().toggleUnderline().run()} title="Sublinhado (Ctrl+U)">
            <UnderlineIcon className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle size="sm" pressed={editor.isActive("highlight")}
            onPressedChange={() => editor.chain().focus().toggleHighlight().run()} title="Realçar texto">
            <Highlighter className="h-3.5 w-3.5" />
          </Toggle>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Tamanho de fonte */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 px-2 gap-1 text-xs" title="Tamanho da fonte">
                <Type className="h-3.5 w-3.5" />
                <ChevronDown className="h-2.5 w-2.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[80px]">
              <DropdownMenuItem onClick={() => (editor.chain().focus() as any).unsetFontSize?.().run()} className="text-xs">
                Padrão
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {FONT_SIZES.map(size => (
                <DropdownMenuItem
                  key={size}
                  onClick={() => (editor.chain().focus() as any).setFontSize?.(size).run()}
                  className="text-xs"
                  style={{ fontSize: size }}
                >
                  {size.replace("px", "")}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Alinhamento */}
          <Toggle size="sm" pressed={editor.isActive({ textAlign: "left" })}
            onPressedChange={() => editor.chain().focus().setTextAlign("left").run()} title="Alinhar à esquerda">
            <AlignLeft className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle size="sm" pressed={editor.isActive({ textAlign: "center" })}
            onPressedChange={() => editor.chain().focus().setTextAlign("center").run()} title="Centralizar">
            <AlignCenter className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle size="sm" pressed={editor.isActive({ textAlign: "right" })}
            onPressedChange={() => editor.chain().focus().setTextAlign("right").run()} title="Alinhar à direita">
            <AlignRight className="h-3.5 w-3.5" />
          </Toggle>
          <Toggle size="sm" pressed={editor.isActive({ textAlign: "justify" })}
            onPressedChange={() => editor.chain().focus().setTextAlign("justify").run()} title="Justificar">
            <AlignJustify className="h-3.5 w-3.5" />
          </Toggle>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Títulos */}
          <Toggle size="sm" pressed={editor.isActive("heading", { level: 1 })}
            onPressedChange={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Título 1">
            <Type className="h-3.5 w-3.5" /><span className="text-xs ml-0.5">1</span>
          </Toggle>
          <Toggle size="sm" pressed={editor.isActive("heading", { level: 2 })}
            onPressedChange={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Título 2">
            <Type className="h-3.5 w-3.5" /><span className="text-xs ml-0.5">2</span>
          </Toggle>
          <Toggle size="sm" pressed={editor.isActive("heading", { level: 3 })}
            onPressedChange={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Título 3">
            <Type className="h-3.5 w-3.5" /><span className="text-xs ml-0.5">3</span>
          </Toggle>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Tabela */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm"
                className={cn("h-7 px-2 gap-1", editor.isActive("table") && "bg-accent")} title="Tabela">
                <TableIcon className="h-3.5 w-3.5" />
                <ChevronDown className="h-2.5 w-2.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onClick={insertTable} className="text-xs gap-2">
                <Plus className="h-3 w-3" /> Inserir tabela (3×3)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => editor.chain().focus().addRowAfter().run()}
                disabled={!editor.isActive("table")} className="text-xs gap-2">
                <Plus className="h-3 w-3" /> Adicionar linha abaixo
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().addColumnAfter().run()}
                disabled={!editor.isActive("table")} className="text-xs gap-2">
                <Plus className="h-3 w-3" /> Adicionar coluna à direita
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => editor.chain().focus().deleteRow().run()}
                disabled={!editor.isActive("table")} className="text-xs gap-2 text-destructive">
                <Trash2 className="h-3 w-3" /> Remover linha
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().deleteColumn().run()}
                disabled={!editor.isActive("table")} className="text-xs gap-2 text-destructive">
                <Trash2 className="h-3 w-3" /> Remover coluna
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => editor.chain().focus().deleteTable().run()}
                disabled={!editor.isActive("table")} className="text-xs gap-2 text-destructive">
                <Trash2 className="h-3 w-3" /> Remover tabela
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <div className="w-px h-4 bg-border mx-1" />

          {/* Link */}
          <Button variant="ghost" size="sm" onClick={setLink}
            className={cn("h-7 px-2", editor.isActive("link") && "bg-accent")} title="Inserir link">
            <LinkIcon className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Área de edição */}
      <div
        className="flex-1 overflow-y-auto bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100"
        data-placeholder={placeholder}
        onClick={() => editor.commands.focus()}
      >
        <EditorContent
          editor={editor}
          className="min-h-full cursor-text prose prose-sm dark:prose-invert max-w-none
            [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-full
            [&_.ProseMirror]:p-4 [&_.ProseMirror]:leading-relaxed
            [&_.ProseMirror_p]:my-1 [&_.ProseMirror_h1]:text-xl [&_.ProseMirror_h1]:font-bold
            [&_.ProseMirror_h2]:text-lg [&_.ProseMirror_h2]:font-bold
            [&_.ProseMirror_h3]:text-base [&_.ProseMirror_h3]:font-semibold
            [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_td]:border [&_.ProseMirror_th]:border
            [&_.ProseMirror_td]:p-2 [&_.ProseMirror_th]:p-2 [&_.ProseMirror_th]:bg-muted/50"
        />
      </div>
    </div>
  );
}

export default TipTapEditor;
