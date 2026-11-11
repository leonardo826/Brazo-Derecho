import { parseMarkdown, type MdInline } from "@/lib/chat/markdown";

function Inline({ nodes }: { nodes: MdInline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        const key = `${node.type}-${index}`;
        if (node.type === "break") return <br key={key} />;
        if (node.type === "strong") return <strong key={key}>{node.text}</strong>;
        if (node.type === "em") return <em key={key}>{node.text}</em>;
        if (node.type === "code") return <code key={key}>{node.text}</code>;
        if (node.type === "link") {
          const internal = node.href.startsWith("/");
          return (
            <a key={key} href={node.href} {...(internal ? {} : { rel: "noreferrer noopener", target: "_blank" })}>
              {node.text}
            </a>
          );
        }
        return <span key={key}>{node.text}</span>;
      })}
    </>
  );
}

export function ChatMarkdown({ text }: { text: string }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="md">
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        if (block.type === "heading") {
          if (block.level === 1) return <h3 key={key}><Inline nodes={block.children} /></h3>;
          if (block.level === 2) return <h3 key={key}><Inline nodes={block.children} /></h3>;
          return <h4 key={key}><Inline nodes={block.children} /></h4>;
        }
        if (block.type === "code") {
          return (
            <pre key={key}>
              <code>{block.text}</code>
            </pre>
          );
        }
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return (
            <List key={key}>
              {block.items.map((item, itemIndex) => (
                <li key={`${key}-${itemIndex}`}>
                  <Inline nodes={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={key}>
            <Inline nodes={block.children} />
          </p>
        );
      })}
    </div>
  );
}
