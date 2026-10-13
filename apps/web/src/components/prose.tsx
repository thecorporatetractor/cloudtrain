import { Fragment, type ReactNode } from 'react';

/**
 * Minimal Markdown renderer for task text: paragraphs, bullet and numbered lists,
 * fenced code blocks, pipe tables, `code`, **bold**.
 * Deliberately small; task statements are authored content, not arbitrary HTML.
 */
export function Prose({ text, className }: { text: string; className?: string }) {
  return <div className={className ? `prose ${className}` : 'prose'}>{blocks(text).map(renderBlock)}</div>;
}

type Block = { kind: 'code'; lang: string; text: string } | { kind: 'text'; lines: string[] };

/** Splits on blank lines, except inside ``` fences (which may contain blank lines). */
function blocks(text: string): Block[] {
  const out: Block[] = [];
  let para: string[] = [];
  let fence: { lang: string; lines: string[] } | null = null;
  const flush = () => {
    if (para.length) out.push({ kind: 'text', lines: para });
    para = [];
  };
  for (const line of text.trim().split('\n')) {
    const m = /^\s*```\s*([\w-]*)\s*$/.exec(line);
    if (fence) {
      if (m) {
        out.push({ kind: 'code', lang: fence.lang, text: fence.lines.join('\n') });
        fence = null;
      } else fence.lines.push(line);
    } else if (m) {
      flush();
      fence = { lang: m[1] ?? '', lines: [] };
    } else if (!line.trim()) flush();
    else para.push(line);
  }
  if (fence) out.push({ kind: 'code', lang: fence.lang, text: fence.lines.join('\n') });
  flush();
  return out;
}

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

function renderBlock(b: Block, i: number): ReactNode {
  if (b.kind === 'code') {
    return (
      <pre key={i} className="prose-code" data-lang={b.lang || undefined}>
        <code>{b.text}</code>
      </pre>
    );
  }
  const lines = b.lines;
  if (lines.length >= 2 && lines.every((l) => /^\s*\|.*\|\s*$/.test(l)) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[1]!)) {
    const [head, , ...rows] = lines;
    return (
      <table key={i} className="prose-table">
        <thead>
          <tr>
            {cells(head!).map((c, j) => (
              <th key={j}>{inline(c)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, k) => (
            <tr key={k}>
              {cells(r).map((c, j) => (
                <td key={j}>{inline(c)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
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
}

function inline(s: string): ReactNode {
  const parts = s.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`')) return <code key={i}>{p.slice(1, -1)}</code>;
    if (p.startsWith('**') && p.endsWith('**')) return <strong key={i}>{p.slice(2, -2)}</strong>;
    return <Fragment key={i}>{p}</Fragment>;
  });
}
