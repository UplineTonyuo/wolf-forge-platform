import { Fragment, type ReactNode } from "react";
import {
  parseTeamInlineFormatting,
  type TeamInlineToken,
} from "../../domain/team/formatting";
import styles from "./team-messages.module.css";

function renderInlineTokens(tokens: TeamInlineToken[], keyPrefix: string): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    if (token.type === "text") return token.value;
    if (token.type === "strong") {
      return <strong key={key}>{renderInlineTokens(token.children, key)}</strong>;
    }
    if (token.type === "emphasis") {
      return <em key={key}>{renderInlineTokens(token.children, key)}</em>;
    }

    const label = renderInlineTokens(token.children, key);
    if (!token.href) return <Fragment key={key}>{label}</Fragment>;
    if (token.href.startsWith("mention:")) return <span key={key} className={styles.messageMention}>{label}</span>;
    return (
      <a
        key={key}
        href={token.href}
        target={token.href.startsWith("mailto:") ? undefined : "_blank"}
        rel={token.href.startsWith("mailto:") ? undefined : "noopener noreferrer"}
      >
        {label}
      </a>
    );
  });
}

function inlineNodes(value: string, keyPrefix: string): ReactNode[] {
  return renderInlineTokens(parseTeamInlineFormatting(value), keyPrefix);
}

export function TeamFormattedMessage({ body }: { body: string }) {
  const lines = body.split("\n");
  const blocks: ReactNode[] = [];
  for (let index = 0; index < lines.length;) {
    const bullet = /^\s*[-*]\s+(.+)$/.exec(lines[index]!);
    const numbered = /^\s*\d+\.\s+(.+)$/.exec(lines[index]!);
    if (bullet || numbered) {
      const ordered = Boolean(numbered);
      const items: ReactNode[] = [];
      while (index < lines.length) {
        const item = (ordered ? /^\s*\d+\.\s+(.+)$/ : /^\s*[-*]\s+(.+)$/).exec(lines[index]!);
        if (!item) break;
        items.push(<li key={index}>{inlineNodes(item[1]!, `li-${index}`)}</li>);
        index += 1;
      }
      blocks.push(
        ordered ? <ol key={`o-${index}`}>{items}</ol> : <ul key={`u-${index}`}>{items}</ul>,
      );
      continue;
    }
    blocks.push(
      <span key={`p-${index}`}>
        {inlineNodes(lines[index]!, `p-${index}`)}
        {index < lines.length - 1 ? <br /> : null}
      </span>,
    );
    index += 1;
  }
  return <div className={styles.formattedMessage}>{blocks}</div>;
}
