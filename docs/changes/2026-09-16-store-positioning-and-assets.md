# 商店定位、字段和截图重写

## 只读审计结论

| 问题 | 严重性 / 位置 | 实际行为及影响 | 统一方案 / 阻断 |
| --- | --- | --- | --- |
| 首屏技术语言多、受众不清 | 中 / README.md、docs/release/app-store-connect-config.template.md | 递归、MVP、模型配置先于阅读价值，Mac 商品描述提到 Windows | 以原文锚定、逐层追问、回溯理解路径为主线；中英本地化；阻断本轮文案验收 |
| 缺完整英文字段与自动限制检查 | 中 / 配置模板 | 无英文描述、副标题及 UTF-8 字节验证 | 单一 metadata.json 驱动字段、纯文本导出和模板；负向验证溢出和不同步 |
| 图片含工程测试素材 | 高 / store-assets/macos/zh-CN | PDF 结构测试、SMOK 节点、空回答；首图是模型列表 | 用原创阅读示例通过真实文档/Tip API 和真实 UI 重新捕获；旧图不再作为推荐图 |
| 尺寸检查冒充 Mac 截图验证 | 高 / scripts/test-release-readiness.mjs | PNG 数量/尺寸被报告为 macScreenshots，未验证平台、构建和内容 | 分开 Windows 真实 UI 展示稿与 Mac 提交素材；草稿不得通过提交 gate |
| 文案存在过度承诺风险 | 高 / 用户建议中的本地模型与隐私措辞 | 在线 API 会发送相关上下文；模型权重需下载；Mac 沙箱尚未实机验证 | 明确本地优先不等于所有模型调用不出设备，不承诺准确率/全部模型/无限上下文；Mac 复拍及签名仍阻断上架 |

## 方案、不变量和非目标

先失败回归，后写文案和捕获脚本。只改说明、素材及其验证脚本，不改业务功能；保留上一轮未提交的隐私功能文件，不混入本次 Git 提交。GitHub 更新仅提交本轮相关文件，不上传安装包或凭据，不提交 App Store 审核。

宣传顺序：原文锚定 Tip → 回答内继续追问 → Tip Tree 定位与命名 → PDF 原版式及 OCR → 本地优先 / 自选模型。典型受众为研究生、研究人员、课程学习者、技术与政策资料读者。5 MB 配额放在使用条件，Python 与 RAG 翻译成用户可理解的辅助能力，不挤占定位首句。

图片使用真实客户端渲染及公开可复现的原创示例资料。演示回答是明确声明的受控示例，不是准确率证据；不使用生成式图片伪造 UI。加入中英文标题与构图，草稿标明待 Mac 复拍。保留未改动原始捕获及哈希来源清单；照片像素不手工改字。正式提交 gate 必须拒绝 win32、草稿、缺来源或哈希不符的图片。

## 外部依据（2026-09-16 核查）

- https://developer.apple.com/help/app-store-connect/reference/app-information/app-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/platform-version-information
- https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications
- https://developer.apple.com/app-store/review/guidelines/ （2.3 Accurate Metadata）

名称/副标题 30 字符，描述 4000 字符纯文本，关键词 100 UTF-8 bytes；Mac 截图 16:10，采用 2880×1800。推广文本最多 170 字符，仅在后台提供该字段时使用；首次版本不填写更新说明。

## 验证记录

本轮先运行新回归，因缺少验证模块/图片来源清单明确失败，再实现并转绿。

- 中文：名称 13、副标题 16、描述 1156、推广文字 89 字符，关键词 85 UTF-8 bytes。
- 英文：名称 22、副标题 30、描述 3124、推广文字 146 字符，关键词 85 UTF-8 bytes。
- `node scripts/test-store-metadata.mjs` 通过：包含过长名称、副标题、正文、推广文本、多字节关键词溢出、HTML 正文、缺来源、非 Mac/草稿不能提交等负向断言。
- `node scripts/test-store-assets.mjs` 通过：8 张图的尺寸、来源、原图/成图 SHA-256 与当前文案一致。
- `node scripts/test-store-assets.mjs --submission` 按预期失败，原因是 win32 受控演示草稿，不是 Mac 签名候选实拍；这是正确阻断，不是上架已通过。
- `pnpm skills:test` 全量退出码 0；`node scripts/test-release-readiness.mjs` 不再把 PNG 尺寸数量报告为 Mac 实拍验收。
- 中英文原创 PDF 经 pypdf 文字层检查和 Poppler 可视化复核；图像排版由代码原生 HTML/CSS 围绕未改动的实际 UI 截图生成，2880×1800。未使用生成图伪造产品界面。

## 复拍中发现的业务问题（本轮不修改业务代码）

1. 初次在中文样例观察到：打开根 Tip、PDF 宽度变化后，选中文字为首行短语，但高亮移到后续行；后续英文材料也复现，不能归因于中文编码。记录为待独立诊断，不能由现有 PDF fixture 测试转绿推定已修复。正式 Mac 截图及发布前须解决。保留两份样例 PDF 便于复现；最终展示草稿使用实际可编辑文档锚定路线，以中英文 Markdown 阅读样例分别拍摄，不手动改动 PDF 坐标或移动图标。
2. 英文模型目录仍显示 GPU 字段“无需”，属于现存本地化遗漏；未修图把它替换成英文，正式英文提交图前须修复并复拍。

本次只验收说明文案、可复现展示草稿和正确的发布阻断，所有素材均是 COMPONENT_CAPABILITY，不是 INDEPENDENT_EVALUATION，也不授予 Mac 正式发布资格。
