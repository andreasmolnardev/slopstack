export const PDF_LIMITS = {
  fileBytes: 10 * 1024 * 1024,
  pages: 200,
  textBytes: 1024 * 1024,
} as const;

export class PdfImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PdfImportError';
  }
}

type PdfTextItem = { str?: string };
type PdfDocument = {
  numPages: number;
  getPage(pageNumber: number): Promise<{
    getTextContent(): Promise<{ items: PdfTextItem[] }>;
  }>;
  destroy(): Promise<void>;
};
type PdfLoader = (data: Uint8Array) => Promise<PdfDocument>;

async function loadPdf(data: Uint8Array): Promise<PdfDocument> {
  const [{ getDocument, GlobalWorkerOptions }, workerUrl] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ]);
  GlobalWorkerOptions.workerSrc = workerUrl.default;
  return getDocument({ data, stopAtErrors: true, useWorkerFetch: false }).promise as unknown as Promise<PdfDocument>;
}

export async function extractPdfText(file: File, loader: PdfLoader = loadPdf): Promise<string> {
  if (file.type !== 'application/pdf' && !file.name.toLocaleLowerCase().endsWith('.pdf')) {
    throw new PdfImportError('Choose a PDF file.');
  }
  if (file.size === 0) throw new PdfImportError('The selected PDF is empty.');
  if (file.size > PDF_LIMITS.fileBytes) throw new PdfImportError('PDF files must be 10 MiB or smaller.');

  let document: PdfDocument | undefined;
  try {
    document = await loader(new Uint8Array(await file.arrayBuffer()));
    if (!Number.isInteger(document.numPages) || document.numPages < 1) {
      throw new PdfImportError('This PDF has no readable pages.');
    }
    if (document.numPages > PDF_LIMITS.pages) {
      throw new PdfImportError(`PDFs must have ${PDF_LIMITS.pages} pages or fewer.`);
    }

    const encoder = new TextEncoder();
    let result = '';
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const text = (await page.getTextContent()).items
        .map((item) => item.str ?? '')
        .filter(Boolean)
        .join(' ')
        .replace(/[ \t]+/g, ' ')
        .trim();
      if (!text) continue;
      const pageMarkdown = `${result ? '\n\n' : ''}## Page ${pageNumber}\n\n${text}`;
      if (encoder.encode(result + pageMarkdown).byteLength > PDF_LIMITS.textBytes) {
        throw new PdfImportError('Extracted text exceeds the 1 MiB source limit.');
      }
      result += pageMarkdown;
    }
    if (!result.trim()) throw new PdfImportError('No selectable text was found. Scanned PDFs need OCR before import.');
    return result;
  } catch (error) {
    if (error instanceof PdfImportError) throw error;
    throw new PdfImportError('Could not read this PDF. Check that it is a valid, unencrypted PDF.');
  } finally {
    if (document) await document.destroy();
  }
}
