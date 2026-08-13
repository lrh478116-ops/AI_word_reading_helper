from __future__ import annotations

import base64
from io import BytesIO
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, Table, TableStyle


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "scripts" / "fixtures" / "semantic-pdf.pdf.base64"
FONT_PATH = Path(r"C:\Windows\Fonts\msyh.ttc")
FONT_NAME = "SemanticChinese"


def build_fixture() -> bytes:
    if not FONT_PATH.exists():
        raise FileNotFoundError(f"Required fixture font is missing: {FONT_PATH}")
    pdfmetrics.registerFont(TTFont(FONT_NAME, str(FONT_PATH)))

    image = Image.new("RGB", (640, 180), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle((12, 18, 176, 162), fill="#ff554d")
    draw.ellipse((205, 18, 349, 162), fill="#2bb673")
    image_font = ImageFont.truetype(str(FONT_PATH), 44)
    draw.text((376, 55), "独立图片对象", font=image_font, fill="#142033")
    image_buffer = BytesIO()
    image.save(image_buffer, format="PNG", optimize=False)
    image_buffer.seek(0)

    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4, invariant=1, pageCompression=0)
    pdf.setTitle("PDF 语义结构测试")
    pdf.setAuthor("AI Tip Regression")
    width, height = A4

    pdf.setFont(FONT_NAME, 24)
    pdf.drawString(56, height - 72, "PDF 文本、表格与图片结构测试")
    pdf.setFont(FONT_NAME, 13)
    pdf.drawString(56, height - 108, "这是一段可选择、可检索并可创建 Tip 的中文正文。")
    pdf.drawString(56, height - 132, "两列普通文字：左侧说明                  右侧补充（不得误判为表格）")

    paragraph_style = ParagraphStyle("table", fontName=FONT_NAME, fontSize=11, leading=14, textColor=colors.HexColor("#142033"))
    rows = [
        [Paragraph("指标", paragraph_style), Paragraph("2025", paragraph_style), Paragraph("2026", paragraph_style)],
        [Paragraph("准确率", paragraph_style), Paragraph("91.2%", paragraph_style), Paragraph("93.8%", paragraph_style)],
        [Paragraph("样本数", paragraph_style), Paragraph("120", paragraph_style), Paragraph("160", paragraph_style)],
    ]
    table = Table(rows, colWidths=[190, 105, 105], rowHeights=[34, 34, 34])
    table.setStyle(TableStyle([
        ("GRID", (0, 0), (-1, -1), 1, colors.HexColor("#1769d2")),
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e6f2ff")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    table.wrapOn(pdf, width, height)
    table.drawOn(pdf, 56, height - 280)

    pdf.drawImage(ImageReader(image_buffer), 56, height - 485, width=480, height=135, preserveAspectRatio=True, mask="auto")
    pdf.setFont(FONT_NAME, 11)
    pdf.drawString(56, height - 508, "图 1：上方必须在结构化视图中保留为独立图片对象。")
    pdf.showPage()

    pdf.setFont(FONT_NAME, 20)
    pdf.drawString(56, height - 72, "第二页：文本仍然是文本")
    pdf.setFont(FONT_NAME, 13)
    pdf.drawString(56, height - 108, "结构提取必须保留页码、阅读顺序和来源坐标。")
    pdf.save()
    return output.getvalue()


if __name__ == "__main__":
    encoded = base64.b64encode(build_fixture()).decode("ascii")
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text("\n".join(encoded[index:index + 96] for index in range(0, len(encoded), 96)) + "\n", encoding="ascii")
    print(f"wrote {OUTPUT} ({len(base64.b64decode(encoded))} bytes)")
