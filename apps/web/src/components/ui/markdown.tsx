import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Rendert LLM-Text als Markdown. Bewusst OHNE rehype-raw — react-markdown
 * ignoriert Roh-HTML per Default, daher XSS-sicher für Agenten-Ausgaben.
 * Kompakte Abstände, damit es in die schmalen Transcript-Bubbles passt.
 */
const components: Components = {
  p: ({ className, ...props }) => (
    <p className={cn("my-2 first:mt-0 last:mb-0 leading-relaxed", className)} {...props} />
  ),
  ul: ({ className, ...props }) => (
    <ul className={cn("my-2 ml-4 list-disc space-y-1 first:mt-0 last:mb-0", className)} {...props} />
  ),
  ol: ({ className, ...props }) => (
    <ol className={cn("my-2 ml-4 list-decimal space-y-1 first:mt-0 last:mb-0", className)} {...props} />
  ),
  li: ({ className, ...props }) => <li className={cn("leading-relaxed", className)} {...props} />,
  strong: ({ className, ...props }) => (
    <strong className={cn("font-semibold", className)} {...props} />
  ),
  em: ({ className, ...props }) => <em className={cn("italic", className)} {...props} />,
  a: ({ className, ...props }) => (
    <a
      className={cn("font-medium text-primary underline underline-offset-2", className)}
      target="_blank"
      rel="noreferrer noopener"
      {...props}
    />
  ),
  h1: ({ className, ...props }) => (
    <h1 className={cn("mt-3 mb-1.5 text-base font-semibold first:mt-0", className)} {...props} />
  ),
  h2: ({ className, ...props }) => (
    <h2 className={cn("mt-3 mb-1.5 text-sm font-semibold first:mt-0", className)} {...props} />
  ),
  h3: ({ className, ...props }) => (
    <h3 className={cn("mt-3 mb-1 text-sm font-semibold first:mt-0", className)} {...props} />
  ),
  blockquote: ({ className, ...props }) => (
    <blockquote
      className={cn("my-2 border-l-2 border-border pl-3 text-muted-foreground", className)}
      {...props}
    />
  ),
  hr: ({ className, ...props }) => <hr className={cn("my-3 border-border", className)} {...props} />,
  code: ({ className, children, ...props }: ComponentPropsWithoutRef<"code">) => {
    // Inline-Code hat keinen Zeilenumbruch; Block-Code steckt in <pre>.
    const isBlock = String(children).includes("\n");
    return (
      <code
        className={cn(
          isBlock
            ? "block"
            : "rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ className, ...props }) => (
    <pre
      className={cn(
        "my-2 overflow-x-auto rounded-md bg-muted p-2.5 font-mono text-xs first:mt-0 last:mb-0",
        className,
      )}
      {...props}
    />
  ),
  table: ({ className, ...props }) => (
    <div className="my-2 overflow-x-auto">
      <table className={cn("w-full border-collapse text-xs", className)} {...props} />
    </div>
  ),
  th: ({ className, ...props }) => (
    <th
      className={cn("border border-border bg-muted/50 px-2 py-1 text-left font-medium", className)}
      {...props}
    />
  ),
  td: ({ className, ...props }) => (
    <td className={cn("border border-border px-2 py-1 align-top", className)} {...props} />
  ),
};

export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("break-words", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
