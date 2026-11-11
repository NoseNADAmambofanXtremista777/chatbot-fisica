import { useEffect, useRef } from "react";
import { marked } from "marked";
import renderMathInElement from "katex/contrib/auto-render";
import "katex/dist/katex.min.css";

export default function MessageBubble({ role, content, attachmentPreview }) {
  const botRef = useRef(null);

  useEffect(() => {
    if (role === "user" || !botRef.current) return;
    botRef.current.innerHTML = marked.parse(content || "");
    // Solo delimitadores con "$": "\( \)" y "\[ \]" no sobreviven al parseo de
    // Markdown, que consume la barra invertida como escape antes de llegar aqui.
    renderMathInElement(botRef.current, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  }, [content, role]);

  if (role === "user") {
    return (
      <div className="message user-message">
        {attachmentPreview && (
          <img className="attachment-thumb" src={attachmentPreview} alt="Imagen adjunta" />
        )}
        {content}
      </div>
    );
  }

  return <div className="message bot-message" ref={botRef} />;
}
