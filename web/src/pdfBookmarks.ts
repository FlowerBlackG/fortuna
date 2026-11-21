// SPDX-License-Identifier: MulanPSL-2.0
import type { jsPDF } from "jspdf";

export interface PdfBookmark {
  title: string;
  page: number;
  y: number;
  children?: PdfBookmark[];
}

function pdfTitle(text: string) {
  let hex = "FEFF";
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, "0");
  return `<${hex}>`;
}

// jsPDF's outline.add targets the top of a page. Groups can start at different heights on the same page.
export function addPdfBookmarks(doc: jsPDF, bookmarks: PdfBookmark[]) {
  if (!bookmarks.length) return;
  const pdf = doc.internal as typeof doc.internal & {
    newAdditionalObject(): { objId: number; content: string };
    write(value: string): void;
  };
  let rootId: number;
  pdf.events.subscribe("putAdditionalObjects", () => {
    const root = pdf.newAdditionalObject();
    rootId = root.objId;
    function children(parent: number, items: PdfBookmark[]): { links: string; count: number } {
      if (!items.length) return { links: "", count: 0 };
      const nodes = items.map(() => pdf.newAdditionalObject());
      let count = items.length;
      items.forEach((item, i) => {
        const node = nodes[i];
        const nested = children(node.objId, item.children ?? []);
        count += nested.count;
        node.content = [
          "<<",
          `/Title ${pdfTitle(item.title)}`,
          `/Parent ${parent} 0 R`,
          `/Dest [${doc.getPageInfo(item.page).objId} 0 R /XYZ null ${item.y.toFixed(2)} null]`,
          i > 0 ? `/Prev ${nodes[i - 1].objId} 0 R` : "",
          i + 1 < nodes.length ? `/Next ${nodes[i + 1].objId} 0 R` : "",
          nested.links,
          ">>",
        ].join("\n");
      });
      return {
        links: `/First ${nodes[0].objId} 0 R /Last ${nodes[nodes.length - 1].objId} 0 R /Count ${count}`,
        count,
      };
    }
    root.content = `<< /Type /Outlines ${children(rootId, bookmarks).links} >>`;
  });
  pdf.events.subscribe("putCatalog", () => pdf.write(`/Outlines ${rootId} 0 R`));
  doc.setDisplayMode(undefined, undefined, "UseOutlines");
}
