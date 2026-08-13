"""Generate a deterministic image-only PDF fixture for offline OCR tests."""

from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "fixtures" / "scanned-pdf.pdf.base64"
FONT = Path(r"C:\Windows\Fonts\msyh.ttc")


def main() -> None:
    title_font = ImageFont.truetype(str(FONT), 78)
    body_font = ImageFont.truetype(str(FONT), 58)
    pdf = io.BytesIO()
    page_size = landscape(A4)
    canvas = Canvas(pdf, pagesize=page_size, pageCompression=1)
    for page_number in range(1, 5):
        image = Image.new("RGB", (1600, 900), "white")
        draw = ImageDraw.Draw(image)
        draw.text((110, 100), f"AI TIP OCR TEST - PAGE {page_number}", fill="black", font=title_font)
        draw.text((110, 280), "OCR Test 12345", fill="black", font=body_font)
        draw.text((110, 405), "扫描文字测试", fill="black", font=body_font)
        draw.text((110, 530), "Original layout stays unchanged.", fill="black", font=body_font)
        png = io.BytesIO()
        image.save(png, format="PNG", optimize=True)
        canvas.drawImage(ImageReader(io.BytesIO(png.getvalue())), 0, 0, width=page_size[0], height=page_size[1])
        canvas.showPage()
    canvas.save()
    OUTPUT.write_text(base64.b64encode(pdf.getvalue()).decode("ascii"), encoding="ascii")
    print(f"Wrote {OUTPUT} ({len(pdf.getvalue())} PDF bytes)")


if __name__ == "__main__":
    main()
