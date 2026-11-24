import { parse, type DefaultTreeAdapterTypes } from "parse5";

/** HTML tree building without starting image loads or creating browsing contexts. */
export function parseInertHtml(source: string): Document {
  const doc = document.implementation.createHTMLDocument("");
  doc.replaceChildren();
  function append(parent: Node, child: DefaultTreeAdapterTypes.ChildNode): void {
    if ("tagName" in child) {
      let node: Element;
      try { node = doc.createElementNS(child.namespaceURI, child.tagName); }
      catch { node = doc.createElement("span"); }
      for (const attr of child.attrs) {
        try {
          if (attr.namespace) node.setAttributeNS(attr.namespace, attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name, attr.value);
          else node.setAttribute(attr.name, attr.value);
        } catch { /* An invalid HTML attribute name cannot be represented in the DOM. */ }
      }
      const destination = node.localName === "template" && "content" in node ? (node as HTMLTemplateElement).content : node;
      for (const nested of "content" in child ? child.content.childNodes : child.childNodes) append(destination, nested);
      parent.appendChild(node);
    } else if ("publicId" in child) parent.appendChild(doc.implementation.createDocumentType(child.name, child.publicId, child.systemId));
    else if ("value" in child) parent.appendChild(doc.createTextNode(child.value));
    else if ("data" in child) parent.appendChild(doc.createComment(child.data));
  }
  for (const child of parse(source, { scriptingEnabled: false }).childNodes) append(doc, child);
  return doc;
}
