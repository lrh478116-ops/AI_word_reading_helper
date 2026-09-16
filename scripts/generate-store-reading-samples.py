"""Original, explicitly illustrative reading material; no user documents or empirical claims."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.colors import HexColor
from pypdf import PdfReader
import os

root = Path(__file__).resolve().parents[1]
output = root / 'store-assets' / 'samples'
output.mkdir(parents=True, exist_ok=True)
font = os.environ.get('AI_TIP_SAMPLE_FONT', r'C:\Windows\Fonts\msyh.ttc')
pdfmetrics.registerFont(TTFont('Reading', font))
for locale in ['zh-CN', 'en']:
    zh = locale == 'zh-CN'
    target = output / f'reading-methods-{locale}.pdf'
    c = canvas.Canvas(str(target), pagesize=(595, 760), invariant=1)
    c.setTitle('阅读示例：怎样理解一项研究' if zh else 'Reading example: understanding a study')
    c.setAuthor('AI Tip - Original illustrative material')
    def text(x, y, value, size=12, color='#293c35'):
        c.setFillColor(HexColor(color)); c.setFont('Reading', size); c.drawString(x, y, value)
    c.setFillColor(HexColor('#eef2e8')); c.rect(0, 655, 595, 105, fill=1, stroke=0)
    text(42, 723, 'READING NOTES  /  01', 10, '#687859')
    text(42, 682, '怎样理解一项研究' if zh else 'Understanding a study', 26)
    text(42, 625, '原创阅读示例 · 非真实研究结论' if zh else 'Original reading example - not empirical findings', 10, '#687859')
    text(42, 588, '01  从结果追问条件' if zh else '01  Read beyond the headline result', 17)
    lines = ['看到更高的分数，并不等于证明方法一定更好。', '阅读时需要区分观测结果、实验条件与解释。', '把不理解的概念标出来，再沿着证据继续追问。'] if zh else ['A higher score alone does not prove a better method.', 'Separate the observation, the conditions and the explanation.', 'Mark an unfamiliar idea, then follow the evidence behind it.']
    for i, line in enumerate(lines): text(42, 551-i*24, line, 12)
    text(42, 450, '02  把问题拆成可以核对的部分' if zh else '02  Turn a claim into questions you can check', 17)
    rows = [('观察', '作者实际报告了什么？'), ('条件', '数据、对照与评价方法是否可比？'), ('不确定性', '结果在重复实验中是否稳定？'), ('边界', '结论可以适用于什么情形？')] if zh else [('Observation', 'What was actually reported?'), ('Conditions', 'Are the data and comparisons appropriate?'), ('Uncertainty', 'Is the result stable across repeated runs?'), ('Scope', 'Where would the conclusion apply?')]
    for i, (a,b) in enumerate(rows):
        y=408-i*43
        c.setFillColor(HexColor('#f3f5ef' if i%2==0 else '#ffffff')); c.rect(42,y-13,511,40,fill=1,stroke=0)
        text(54,y,a,11);text(185,y,b,11)
    text(42, 185, '03  留下可回访的理解路径' if zh else '03  Keep a route back to the source', 17)
    text(42, 150, '原文疑问  >  概念解释  >  条件与边界' if zh else 'Source question  >  Explanation  >  Conditions and limits', 12)
    text(42, 114, '示例仅用于展示阅读流程，不构成研究建议或工具效果评估。' if zh else 'Illustrates a reading workflow; not an evaluation of the app or a study.', 9, '#687859')
    c.setStrokeColor(HexColor('#cbd4c3')); c.line(42,72,553,72)
    text(42, 48, 'AI TIP  /  SOURCE-ANCHORED READING', 9, '#687859');text(540,48,'01',9)
    c.showPage();c.save()
    extracted = PdfReader(target).pages[0].extract_text()
    assert lines[0] in extracted, 'Text layer missing or garbled'
    print(target)
