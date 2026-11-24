import { useEffect, useRef, useState } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import katex from "katex";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import "katex/dist/katex.min.css";

// Caracter del area de uso privado de Unicode: no aparece en texto real, asi
// que sirve como marcador inerte que ni Markdown ni DOMPurify van a tocar.
const PLACEHOLDER = "";

const FLASHCARD_PLACEHOLDER = "";
let flashcardDeckCounter = 0;

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

// Claude devuelve las flashcards en un bloque ```flashcards conteniendo un
// array JSON de {front, back}. Se extraen ANTES de Markdown (mismo motivo
// que las formulas: evitar que el parser toque el contenido) y se arma el
// mazo interactivo a mano, en vez de mostrarlas como bloque de codigo.
// El modelo a veces escribe una formula LaTeX dentro del JSON con un solo
// backslash (p.ej. "\mathcal{E}"), que no es un escape valido de JSON ("\m")
// y rompe el parseo entero. Se repara duplicando cualquier backslash que no
// sea ya parte de un escape JSON valido (\", \\, \/, \b, \f, \n, \r, \t, \uXXXX)
// antes de reintentar.
function parseFlashcardsJson(jsonStr) {
  try {
    return JSON.parse(jsonStr);
  } catch {
    try {
      const repaired = jsonStr.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, "\\\\");
      return JSON.parse(repaired);
    } catch {
      return null;
    }
  }
}

function extractFlashcards(text) {
  const decks = [];
  const normalized = text.replace(/```flashcards\n([\s\S]*?)```/g, (whole, jsonStr) => {
    const cards = parseFlashcardsJson(jsonStr);
    // Si ni siquiera la reparacion funciona, se reemplaza por un aviso en vez
    // de dejar el bloque tal cual: de lo contrario el JSON crudo (y cualquier
    // formula "$...$" que contenga) termina pasando por Markdown/KaTeX igual,
    // mostrando un texto a medio romper en vez de un error claro.
    if (!Array.isArray(cards) || cards.length === 0) {
      return "\n\n⚠️ *No se pudieron generar las tarjetas correctamente. Pídelas de nuevo.*\n\n";
    }
    const token = `${FLASHCARD_PLACEHOLDER}${decks.length}${FLASHCARD_PLACEHOLDER}`;
    decks.push(cards);
    return token;
  });
  return { text: normalized, decks };
}

// El front/back de las flashcards puede traer formulas con $...$/$$...$$
// (regla del system prompt), asi que se procesan igual que el resto del
// contenido: los tramos de formula se renderizan con KaTeX, y el texto
// plano alrededor se escapa (esto se inserta directo via innerHTML sin
// pasar por marked/DOMPurify, asi que el escapado hay que hacerlo a mano).
// Las formulas SIEMPRE se renderizan en linea (displayMode: false), nunca en
// bloque: a diferencia del chat, una tarjeta es un espacio chico, y KaTeX
// pone una formula en modo bloque ($$...$$) centrada y ocupando su propia
// linea entera -- eso parte el front/back en varios renglones sueltos (p.ej.
// "$$P$$, reactiva $$Q$$...") en vez de una sola oracion corrida.
// Red de seguridad adicional: a veces el modelo escribe la formula entera sin
// signos de dolar (p.ej. "e = -\Delta\Phi_B/\Delta t" a secas), y como no hay
// "$...$" que extraer, esa cadena quedaria mostrada tal cual (con los
// backslash de LaTeX a la vista). Si la tarjeta entera no tiene NINGUN "$" en
// ningun lado pero si tiene al menos un comando LaTeX ("\algo"), es casi
// seguro que es una formula sin delimitar: se renderiza como una sola formula
// en vez de como texto plano. No se aplica si ya hay un "$" en alguna parte,
// para no arriesgarse a romper una tarjeta que mezcla texto normal y formula.
function looksLikeBareLatex(str) {
  return !str.includes("$") && /\\[a-zA-Z]+/.test(str);
}

function renderCardText(str) {
  if (!str) return "";
  if (looksLikeBareLatex(str)) {
    return renderMath(str.trim(), false);
  }
  return str
    .split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g)
    .map((part) => {
      if (part.startsWith("$$") && part.endsWith("$$") && part.length > 3) {
        return renderMath(part.slice(2, -2).trim(), false);
      }
      if (part.startsWith("$") && part.endsWith("$") && part.length > 1) {
        return renderMath(part.slice(1, -1).trim(), false);
      }
      // "\n\n" (o "\n") en el texto separa la formula de la explicacion
      // (regla del system prompt): se convierte a <br> para que se vea
      // como parrafos/lineas distintas en vez de todo pegado.
      return escapeHtml(part).replace(/\n/g, "<br>");
    })
    .join("");
}

function renderFlashcardDeck(cards) {
  const deckId = `fc-deck-${flashcardDeckCounter++}`;
  const items = cards
    .map(
      (c, i) => `
      <div class="flashcard-item" style="display:${i === 0 ? "block" : "none"}">
        <div class="flashcard">
          <div class="flashcard-inner">
            <div class="flashcard-face flashcard-front">${renderCardText((c.front || "").replace(/\n+/g, " ").trim())}</div>
            <div class="flashcard-face flashcard-back">${renderCardText(c.back)}</div>
          </div>
        </div>
      </div>`
    )
    .join("");
  return `
    <div class="flashcard-deck" id="${deckId}">
      ${items}
      <div class="flashcard-controls">
        <button type="button" class="flashcard-nav flashcard-prev" aria-label="Tarjeta anterior">◀</button>
        <span class="flashcard-counter">1 / ${cards.length}</span>
        <button type="button" class="flashcard-nav flashcard-next" aria-label="Tarjeta siguiente">▶</button>
      </div>
      <div class="flashcard-hint">Toca la tarjeta para ver la respuesta</div>
    </div>`;
}

// Cablea clic-para-voltear y los botones de navegacion. Se hace a mano con
// addEventListener (no hay JSX aca: este HTML se arma e inserta como string
// via innerHTML, igual que el resto del contenido del mensaje).
function wireFlashcardDecks(container) {
  container.querySelectorAll(".flashcard-deck").forEach((deck) => {
    const items = Array.from(deck.querySelectorAll(".flashcard-item"));
    const counter = deck.querySelector(".flashcard-counter");
    let index = 0;
    function show(i) {
      items.forEach((item, idx) => {
        item.style.display = idx === i ? "block" : "none";
        item.querySelector(".flashcard").classList.remove("flipped");
      });
      counter.textContent = `${i + 1} / ${items.length}`;
    }
    deck.querySelector(".flashcard-prev").addEventListener("click", () => {
      index = (index - 1 + items.length) % items.length;
      show(index);
    });
    deck.querySelector(".flashcard-next").addEventListener("click", () => {
      index = (index + 1) % items.length;
      show(index);
    });
    items.forEach((item) => {
      item.querySelector(".flashcard").addEventListener("click", (e) => {
        e.currentTarget.classList.toggle("flipped");
      });
    });
  });
}

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

// Cuando el usuario pide un simulacro de examen "en PDF", el modelo (regla
// 10 del system prompt) manda el simulacro completo (con respuestas) en un
// bloque ```simulacro_pdf aparte, para que NUNCA se muestre en el chat --
// solo se usa para armar el PDF descargable. Se extrae antes de Markdown,
// igual que flashcards/formulas.
function extractExamPdf(text) {
  const t = text || "";
  // Greedy y anclado al final del texto: el bloque simulacro_pdf es siempre
  // lo ultimo que manda el modelo (regla 10), asi que esto toma TODO hasta el
  // ULTIMO ``` de la respuesta. Un match no-greedy se cortaria en el primer
  // ``` que encuentre, y a veces el modelo mete sin querer un bloque de
  // codigo anidado (p.ej. ```svg ... ```) adentro del simulacro, dejando el
  // resto del examen (incluidas las respuestas) afuera, visible en el chat
  // como texto crudo.
  let match = t.match(/```simulacro_pdf\n([\s\S]*)```\s*$/);
  if (!match) {
    // El modelo a veces se olvida de la ``` de cierre al final de la
    // respuesta (el examen entero queda bien escrito, pero sin ese ultimo
    // marcador). En ese caso no hay un "ultimo ```" al cual anclarse, asi que
    // se toma todo lo que sigue a la apertura del bloque como el examen, en
    // vez de dejar todo el bloque sin extraer (visible como texto crudo).
    match = t.match(/```simulacro_pdf\n([\s\S]*)$/);
  }
  if (!match) return { text: t, examMarkdown: null };
  // Por si el modelo igual anido un bloque de codigo de mas (p.ej. para el
  // SVG): se sacan las lineas de ``` sueltas que hayan quedado adentro, para
  // que no se rendericen como un bloque de codigo anidado en el PDF.
  const examMarkdown = match[1].trim().replace(/^```[a-z]*\s*$/gim, "");
  return { text: t.slice(0, match.index).trim(), examMarkdown };
}

// Pipeline compartido de render (Markdown + formulas + flashcards + sanitizado)
// -- lo usan tanto el mensaje visible en el chat como el contenido oculto del
// simulacro en PDF.
function renderMessageHtml(rawText) {
  const { text: withoutFlashcards, decks } = extractFlashcards(rawText || "");
  const { text: withPlaceholders, blocks } = extractMath(withoutFlashcards);
  let html = marked.parse(withPlaceholders);
  // Se habilita el perfil svg ademas de html/mathMl: los simulacros de examen
  // (regla 9) pueden traer diagramas <svg> simples (circuitos, vectores,
  // graficos) inline en la respuesta.
  html = DOMPurify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true, svg: true, svgFilters: true } });
  blocks.forEach((mathHtml, i) => {
    html = html.split(`${PLACEHOLDER}${i}${PLACEHOLDER}`).join(mathHtml);
  });
  decks.forEach((cards, i) => {
    html = html.split(`${FLASHCARD_PLACEHOLDER}${i}${FLASHCARD_PLACEHOLDER}`).join(renderFlashcardDeck(cards));
  });
  return html;
}

function pdfFileName(content) {
  const firstLine = (content || "")
    .split("\n")
    .find((l) => l.trim().length > 0) || "finx-respuesta";
  const slug = firstLine
    .replace(/[#*$_`]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9áéíóúñ\s-]/gi, "")
    .replace(/\s+/g, "-")
    .slice(0, 60);
  return `${slug || "finx-respuesta"}.pdf`;
}

// Genera el PDF renderizando el contenido adentro de un iframe propio,
// aislado del documento principal, en vez de insertar el clon directo en
// document.body. Es necesario: html2canvas siempre clona el documento
// ENTERO donde vive el elemento que se le pasa (no solo el elemento), y
// cuando ese documento es la app real, clonar y re-ejecutar sus <script>
// dentro del clon (parte del comportamiento normal de html2canvas al
// preservar el documento) llegaba a disparar una segunda instancia de la
// app React, que leia el localStorage de sesiones y terminaba duplicando
// la conversacion actual en la barra lateral. Con un iframe en blanco,
// "todo el documento" que html2canvas clona es solamente ese iframe chico,
// sin ningun script de la app -- no hay nada que pueda re-ejecutarse ni
// nada que pueda tocar el estado real.
//
// Las hojas de estilo del documento principal (index.css con las
// variables del tema, y katex.min.css) se copian al <head> del iframe para
// que el contenido clonado se vea igual que en el chat -- ya en cache del
// navegador, se aplican casi al instante.
function waitForStylesheets(idoc) {
  const links = Array.from(idoc.querySelectorAll('link[rel="stylesheet"]'));
  return Promise.all(
    links.map(
      (link) =>
        new Promise((resolve) => {
          if (link.sheet) return resolve();
          link.addEventListener("load", resolve, { once: true });
          link.addEventListener("error", resolve, { once: true });
        })
    )
  );
}

async function downloadAsPdf(sourceEl, filename, setBusy, extraClass) {
  setBusy(true);
  const iframe = document.createElement("iframe");
  iframe.style.cssText = "position:fixed;left:0;top:0;width:650px;height:50px;z-index:-1;border:0;";
  document.body.appendChild(iframe);
  const idoc = iframe.contentDocument;
  idoc.open();
  idoc.write("<!doctype html><html><head></head><body></body></html>");
  idoc.close();

  document.querySelectorAll('link[rel="stylesheet"], style').forEach((node) => {
    idoc.head.appendChild(node.cloneNode(true));
  });

  // El clon SI lleva las clases "message bot-message": asi las reglas de
  // titulos/tablas/codigo del tema ya definidas en index.css se aplican
  // solas, y solo hace falta pisar las variables de color por un tema
  // claro (un PDF oscuro es dificil de leer e imprimir).
  const container = idoc.createElement("div");
  container.className = extraClass ? `message bot-message ${extraClass}` : "message bot-message";
  container.innerHTML = sourceEl.innerHTML;
  container.style.cssText =
    "width:650px;padding:28px;box-sizing:border-box;max-width:none;" +
    "--text:#15192e;--muted:#51597a;--void:#ffffff;--panel:#f3f5fb;" +
    "--panel-2:#e7eaf5;--line:rgba(30,40,90,0.18);--plasma:#1c3fa8;" +
    "background:#ffffff;";
  idoc.body.style.cssText = "margin:0;background:#ffffff;";
  idoc.body.appendChild(container);

  try {
    await waitForStylesheets(idoc);
    // Si las fuentes de KaTeX (simbolos como ~=, pi, etc.) todavia no
    // terminaron de cargar, html2canvas las reemplaza por una fuente
    // generica y salen glifos incorrectos.
    await idoc.fonts.ready;
    const canvas = await html2canvas(container, { backgroundColor: "#ffffff", scale: 2 });
    const pdfWidth = container.offsetWidth;
    const pdfHeight = (canvas.height / canvas.width) * pdfWidth;
    const pdf = new jsPDF({ unit: "pt", format: [pdfWidth, pdfHeight] });
    pdf.addImage(canvas.toDataURL("image/png"), "PNG", 0, 0, pdfWidth, pdfHeight);
    pdf.save(filename);
  } finally {
    document.body.removeChild(iframe);
    setBusy(false);
  }
}

export default function MessageBubble({ role, content, attachmentPreview, wantsPdf }) {
  const botRef = useRef(null);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [examMarkdown, setExamMarkdown] = useState(null);

  useEffect(() => {
    if (role === "user" || !botRef.current) return;
    // El contenido viene del modelo (y, de rebote, del material del curso via
    // RAG): nunca es HTML de confianza, asi que se sanitiza antes de insertarlo
    // (ver renderMessageHtml).
    const { text: visibleText, examMarkdown: extractedExam } = extractExamPdf(content);
    setExamMarkdown(extractedExam);
    botRef.current.innerHTML = renderMessageHtml(visibleText);
    wireFlashcardDecks(botRef.current);
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

  async function handleDownloadExamPdf() {
    const hidden = document.createElement("div");
    hidden.innerHTML = renderMessageHtml(examMarkdown);
    // Clase aparte (ver index.css): deja mas espacio en blanco entre
    // preguntas para que el simulacro se pueda imprimir y resolver ahi mismo.
    await downloadAsPdf(hidden, pdfFileName(examMarkdown), setGeneratingPdf, "exam-pdf-print");
  }

  // Si el simulacro vino en su propio bloque (regla 10), ese es el unico
  // boton de descarga -- se ignora el "wantsPdf" generico aunque el mensaje
  // visible mencione la palabra "pdf", para no mostrar dos botones.
  const showPdfButton = !examMarkdown && Boolean(wantsPdf) && (content || "").trim().length > 40;

  return (
    <div className="message bot-message">
      <div ref={botRef} />
      {examMarkdown && (
        <button
          type="button"
          className="pdf-download-btn"
          disabled={generatingPdf}
          onClick={handleDownloadExamPdf}
        >
          {generatingPdf ? "Generando PDF..." : "📝 Descargar simulacro en PDF"}
        </button>
      )}
      {showPdfButton && (
        <button
          type="button"
          className="pdf-download-btn"
          disabled={generatingPdf}
          onClick={() => downloadAsPdf(botRef.current, pdfFileName(content), setGeneratingPdf)}
        >
          {generatingPdf ? "Generando PDF..." : "⬇ Descargar como PDF"}
        </button>
      )}
    </div>
  );
}
