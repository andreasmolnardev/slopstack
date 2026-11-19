import { describe, expect, it, vi } from 'vitest';
import { extractPdfText, PDF_LIMITS, PdfImportError } from './source-pdf';

function fakePdf(pages: string[]) {
  const destroy = vi.fn(async () => {});
  return {
    destroy,
    loader: vi.fn(async () => ({
      numPages: pages.length,
      getPage: async (number: number) => ({
        getTextContent: async () => ({ items: pages[number - 1].split(' ').map((str) => ({ str })) }),
      }),
      destroy,
    })),
  };
}

const pdfFile = (name = 'notes.pdf', type = 'application/pdf', size = 1) => new File([new Uint8Array(size)], name, { type });

describe('extractPdfText', () => {
  it('extracts page text into Markdown in page order and destroys the document', async () => {
    const pdf = fakePdf(['first page', 'second page']);
    await expect(extractPdfText(pdfFile(), pdf.loader)).resolves.toBe('## Page 1\n\nfirst page\n\n## Page 2\n\nsecond page');
    expect(pdf.destroy).toHaveBeenCalledOnce();
  });

  it('rejects non-PDF and oversized files before parsing', async () => {
    const loader = vi.fn();
    await expect(extractPdfText(pdfFile('notes.txt', 'text/plain'), loader)).rejects.toThrow('Choose a PDF');
    await expect(extractPdfText(pdfFile('large.pdf', 'application/pdf', PDF_LIMITS.fileBytes + 1), loader)).rejects.toThrow('10 MiB');
    expect(loader).not.toHaveBeenCalled();
  });

  it('rejects page counts and extracted text above their limits', async () => {
    const tooManyPages = fakePdf(Array.from({ length: PDF_LIMITS.pages + 1 }, () => 'text'));
    await expect(extractPdfText(pdfFile(), tooManyPages.loader)).rejects.toThrow('pages or fewer');
    const tooMuchText = fakePdf(['x'.repeat(PDF_LIMITS.textBytes + 1)]);
    await expect(extractPdfText(pdfFile(), tooMuchText.loader)).rejects.toThrow('1 MiB source limit');
    expect(tooMuchText.destroy).toHaveBeenCalledOnce();
  });

  it('explains when a scanned PDF has no selectable text', async () => {
    const scanned = fakePdf(['', '']);
    await expect(extractPdfText(pdfFile(), scanned.loader)).rejects.toBeInstanceOf(PdfImportError);
    await expect(extractPdfText(pdfFile(), scanned.loader)).rejects.toThrow('need OCR');
  });
});
