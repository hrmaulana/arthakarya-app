"""
Mail merge + PDF generator untuk SPPD.
Usage: python generate-pdf.py <template.docx> <data.json> <output.pdf>
Menggunakan Microsoft Word COM automation (harus ada Word terinstall di Windows).
"""
import json, sys, os, tempfile, shutil
from docxtpl import DocxTemplate

def fill_template(template_path: str, data: dict, output_pdf: str) -> str:
    """Isi template docx dengan data, lalu convert ke PDF via Word COM."""

    # 1. Isi template
    doc = DocxTemplate(template_path)
    doc.render(data)

    # 2. Simpan docx sementara
    tmp_docx = output_pdf.replace(".pdf", "_filled.docx")
    doc.save(tmp_docx)

    # 3. Convert ke PDF via Word COM
    try:
        import win32com.client as win32
        word = win32.Dispatch("Word.Application")
        word.Visible = False
        doc_obj = word.Documents.Open(os.path.abspath(tmp_docx))
        doc_obj.SaveAs(os.path.abspath(output_pdf), FileFormat=17)  # 17 = PDF
        doc_obj.Close()
        word.Quit()
        print(f"PDF saved: {output_pdf}")
    except Exception as e:
        print(f"Word COM error: {e}")
        print(f"Filled docx saved: {tmp_docx}")
        # Fallback: simpan docx saja
        shutil.copy(tmp_docx, output_pdf.replace(".pdf", ".docx"))

    # Cleanup temp
    if os.path.exists(tmp_docx):
        os.remove(tmp_docx)

    return output_pdf

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python generate-pdf.py <template.docx> <data.json> <output.pdf>")
        sys.exit(1)

    template = sys.argv[1]
    data_file = sys.argv[2]
    output = sys.argv[3]

    with open(data_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    fill_template(template, data, output)
