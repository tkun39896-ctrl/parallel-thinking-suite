declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfResult {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  export default function pdfParse(buffer: Buffer): Promise<PdfResult>;
}
