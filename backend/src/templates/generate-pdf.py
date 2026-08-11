"""
Mail merge + PDF generator untuk SPPD (Linux).
Usage: python3 generate-pdf.py <template.docx> <data.json> <output.pdf>

Mengisi template DOCX dengan data JSON, lalu konversi ke PDF via LibreOffice headless.
"""
import json
import sys
import os
import subprocess
from docxtpl import DocxTemplate


def fill_template(template_path: str, data: dict, output_pdf: str) -> str:
    """Isi template docx dengan data, lalu convert ke PDF via LibreOffice."""

    # 1. Isi template
    doc = DocxTemplate(template_path)
    doc.render(data)

    # 2. Simpan docx sementara
    tmp_docx = output_pdf.replace(".pdf", "_filled.docx")
    doc.save(tmp_docx)

    # 3. Convert ke PDF via LibreOffice headless
    tmp_dir = os.path.dirname(os.path.abspath(tmp_docx))
    try:
        subprocess.run(
            [
                "libreoffice",
                "--headless",
                "--norestore",
                "--convert-to", "pdf",
                "--outdir", tmp_dir,
                tmp_docx,
            ],
            check=True,
            timeout=30,
        )
        print(f"PDF saved: {output_pdf}")
    except subprocess.CalledProcessError as e:
        print(f"LibreOffice error: {e}", file=sys.stderr)
        raise
    finally:
        # Cleanup temp docx
        if os.path.exists(tmp_docx):
            os.remove(tmp_docx)

    return output_pdf


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python3 generate-pdf.py <template.docx> <data.json> <output.pdf>")
        sys.exit(1)

    template = sys.argv[1]
    data_file = sys.argv[2]
    output = sys.argv[3]

    with open(data_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    fill_template(template, data, output)
