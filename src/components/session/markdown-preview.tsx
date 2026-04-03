"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

// Import highlight.js dark theme (same as the existing markdown renderer)
import "highlight.js/styles/github-dark.css";

interface MarkdownPreviewProps {
  content: string;
  className?: string;
}

export function MarkdownPreview({ content, className }: MarkdownPreviewProps) {
  return (
    <ScrollArea className={cn("flex-1 h-full", className)}>
      <div className="px-6 py-4">
        <article className="prose-weave prose-sm max-w-none text-foreground">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              // Style headings
              h1: ({ children }) => (
                <h1 className="mb-4 mt-6 text-xl font-bold text-foreground first:mt-0">
                  {children}
                </h1>
              ),
              h2: ({ children }) => (
                <h2 className="mb-3 mt-5 text-lg font-semibold text-foreground first:mt-0">
                  {children}
                </h2>
              ),
              h3: ({ children }) => (
                <h3 className="mb-2 mt-4 text-base font-semibold text-foreground first:mt-0">
                  {children}
                </h3>
              ),
              // Paragraphs
              p: ({ children }) => (
                <p className="mb-3 text-sm leading-relaxed text-foreground last:mb-0">
                  {children}
                </p>
              ),
              // Code blocks
              pre: ({ children }) => (
                <pre className="mb-4 overflow-x-auto rounded-md bg-card p-3 text-xs leading-relaxed">
                  {children}
                </pre>
              ),
              code: ({ inline, children, ...props }: React.ComponentPropsWithoutRef<"code"> & { inline?: boolean }) =>
                inline ? (
                  <code
                    className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-foreground"
                    {...props}
                  >
                    {children}
                  </code>
                ) : (
                  <code className="font-mono text-xs" {...props}>
                    {children}
                  </code>
                ),
              // Lists
              ul: ({ children }) => (
                <ul className="mb-3 list-disc pl-5 text-sm text-foreground">
                  {children}
                </ul>
              ),
              ol: ({ children }) => (
                <ol className="mb-3 list-decimal pl-5 text-sm text-foreground">
                  {children}
                </ol>
              ),
              li: ({ children }) => (
                <li className="mb-1 leading-relaxed">{children}</li>
              ),
              // Blockquote
              blockquote: ({ children }) => (
                <blockquote className="mb-3 border-l-2 border-muted-foreground/30 pl-4 text-sm italic text-muted-foreground">
                  {children}
                </blockquote>
              ),
              // Links
              a: ({ children, href }) => (
                <a
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline hover:text-primary/80"
                >
                  {children}
                </a>
              ),
              // Tables
              table: ({ children }) => (
                <div className="mb-4 overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    {children}
                  </table>
                </div>
              ),
              th: ({ children }) => (
                <th className="border border-border/50 bg-muted px-3 py-1.5 text-left text-xs font-semibold text-foreground">
                  {children}
                </th>
              ),
              td: ({ children }) => (
                <td className="border border-border/50 px-3 py-1.5 text-xs text-foreground">
                  {children}
                </td>
              ),
              // Horizontal rule
              hr: () => <hr className="my-4 border-border/50" />,
            }}
          >
            {content}
          </ReactMarkdown>
        </article>
      </div>
    </ScrollArea>
  );
}
