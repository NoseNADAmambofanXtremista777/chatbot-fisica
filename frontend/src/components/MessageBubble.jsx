import { useEffect, useRef } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";
import "katex/dist/katex.min.css";

// Caracter del area de uso privado de Unicode: no aparece en texto real, asi
// que sirve como marcador inerte que ni Markdown ni DOMPurify van a tocar.
const PLACEHOLDER = "";

function renderMath(expr, displayMode) {
  try {
    return katex.renderToString(expr, { displayMode, throwOnError: false });
  } catch {
    return displayMode ? `$$${expr}$$` : `$${expr}$`;
  }
}

// Saca las formulas del texto ANTES de que Markdown las vea. Es necesario:
// Markdown interpreta "\," o "\;" (comandos de espaciado de LaTeX) como una
// "escape de puntuacion" y se come la barra invertida, y "_{12}" puede
// disparar las reglas de enfasis (_cursiva_) de Markdown. Si el LaTeX pasa
// por el parser de Markdown antes de llegar a KaTeX, sale corrupto. Por eso
// cada formula se reemplaza por un marcador, se renderiza aparte con KaTeX,
// y se reinserta recien en el HTML ya generado por Markdown.
function extractMath(text) {
  const blocks = [];
  // Delimitadores \( \) / \[ \] (que a veces usa Claude en vez de $ $) se
  // normalizan primero a $ / $$.
  let normalized = text
    .replace(/\\\[([\s\S]*?)\\\]/g, (_, expr) => `$$${expr}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_, expr) => `$${expr}$`);

  normalized = normalized.replace(/\$\$([\s\S]+?)\$\$/g, (_, expr) => {
    const token = `${PLACEHOLDER}${blocks.length}${PLACEHOLDER}`;
    blocks.push(renderMath(expr.trim(), true));
    return token;
  });
  normalized = normalized.replace(/\$([^$\n]+?)\$/g, (_, expr) => {
    const token = `${PLACEHOLDER}${blocks.length}${PLACEHOLDER}`;
    blocks.push(renderMath(expr.trim(), false));
    return token;
  });

  return { text: normalized, blocks };
}

export default function MessageBubble({ role, content, attachmentPreview }) {
  const botRef = useRef(null);

  useEffect(() => {
    if (role === "user" || !botRef.current) return;
    const { text: withPlaceholders, blocks } = extractMath(content || "");
    // El contenido viene del modelo (y, de rebote, del material del curso via
    // RAG): nunca es HTML de confianza, asi que se sanitiza antes de insertarlo.
    // Se habilita el perfil mathMl para que DOMPurify no borre el <math>
    // de respaldo que genera KaTeX para accesibilidad.
    let html = marked.parse(withPlaceholders);
    html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true } });
    blocks.forEach((mathHtml, i) => {
      html = html.split(`${PLACEHOLDER}${i}${PLACEHOLDER}`).join(mathHtml);
    });
    botRef.current.innerHTML = html;
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
