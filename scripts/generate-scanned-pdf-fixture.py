"""Generate a deterministic image-only PDF fixture for offline OCR tests."""

from __future__ import annotations

import base64
import io
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen.canvas import Canvas


ROOT = Path(__file__).resolve().parent
OUTPUT = ROOT / "fixtures" / "scanned-pdf.pdf.base64"
FONT = Path(r"C:\Windows\Fonts\msyh.ttc")


def main() -> None:
    image = Image.new("RGB", (1240, 1754), "white")
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.truetype(str(FONT), 78)
    body_font = ImageFont.truetype(str(FONT), 58)
    draw.text((105, 160), "AI TIP OCR TEST", fill="black", font=title_font)
    draw.text((105, 330), "OCR Test 12345", fill="black", font=body_font)
    draw.text((105, 450), "扫描文字测试", fill="black", font=body_font)
    draw.text((105, 570), "Original layout stays unchanged.", fill="black", font=body_font)

    png = io.BytesIO()
    image.save(png, format="PNG", optimize=True)
    pdf = io.BytesIO()
    canvas = Canvas(pdf, pagesize=A4, pageCompression=1)
    canvas.drawImage(ImageReader(io.BytesIO(png.getvalue())), 0, 0, width=A4[0], height=A4[1])
    canvas.showPage()
    canvas.save()
    OUTPUT.write_text(base64.b64encode(pdf.getvalue()).decode("ascii"), encoding="ascii")
    print(f"Wrote {OUTPUT} ({len(pdf.getvalue())} PDF bytes)")


if __name__ == "__main__":
    main()
