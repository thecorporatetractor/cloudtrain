import { Fragment, type ReactNode } from 'react';

/**
 * Minimal Markdown renderer for task text: paragraphs, bullet lists, `code`, **bold**.
 * Deliberately small; task statements are authored content, not arbitrary HTML.
 */
export function Prose({ text, className }: { text: string; className?: string }) {
  const blocks = text.trim().split(/\n\s*\n/);
  return (
    <div className={className ? `prose ${className}` : 'prose'}>
      {blocks.map((b, i) => {
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*[-*]\s+/.test(l))) {
          return (
            <ul key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*]\s+/, ''))}</li>
              ))}
            </ul>
          );
        }
        if (lines.every((l) => /^\s*\d+\.\s+/.test(l))) {
          return (
            <ol key={i}>
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*\d+\.\s+/, ''))}</li>
              ))}
            </ol>
          );
        }
        return <p key={i}>{inline(lines.join(' '))}</p>;
      })}
    </div>
  );
}

function inline(s: string): ReactNode {
  const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
