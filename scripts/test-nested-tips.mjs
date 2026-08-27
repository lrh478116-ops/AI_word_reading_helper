import { buildTipForest, buildTipPath, collectTipSubtreeIds, httpLinkRanges, plainMessageContent, visibleTipLayout } from "../src/tip-tree.ts";

const stamp = "2026-08-12T00:00:00.000Z";
const makeTip = (id, parentTipId) => ({
  id, userId: "u1", documentId: "d1", blockId: "b1", anchorType: parentTipId ? "message" : "document",
  parentTipId, anchorMessageId: parentTipId ? `m-${parentTipId}` : undefined,
  selectedText: id, startOffset: 0, endOffset: id.length, prefixText: "", suffixText: "", selectedTextHash: id,
  title: `对话 ${id}`, summary: "", status: "open", anchorStatus: "valid", memoryEnabled: true, messages: [], createdAt: stamp, updatedAt: stamp
});

const tips = [makeTip("root"), makeTip("child", "root"), makeTip("grandchild", "child"), makeTip("sibling", "root")];
if (plainMessageContent("第一行 **重要内容**\r\n第二行") !== "第一行 重要内容\n第二行") throw new Error("聊天消息规范化文本与可见文本不一致");
const linkText = "中文百科：https://zh.wikipedia.org/w/index.php?search=自注意力；危险协议：javascript:alert(1)";
const detectedLinks = httpLinkRanges(linkText);
if (detectedLinks.length !== 1 || linkText.slice(detectedLinks[0].start, detectedLinks[0].end) !== "https://zh.wikipedia.org/w/index.php?search=自注意力" || detectedLinks[0].url !== "https://zh.wikipedia.org/w/index.php?search=%E8%87%AA%E6%B3%A8%E6%84%8F%E5%8A%9B") throw new Error(`聊天正文没有只把安全 HTTP(S) 百科地址识别为可点击链接：${JSON.stringify(detectedLinks)}`);
if (JSON.stringify(buildTipPath(tips, "grandchild").map((tip) => tip.id)) !== JSON.stringify(["root", "child", "grandchild"])) throw new Error("Tip lineage 无法从根追溯到孙节点");
if (JSON.stringify(visibleTipLayout(tips, "root")) !== JSON.stringify({ left: { kind: "document" }, rightTipId: "root" })) throw new Error("根 Tip 双栏布局错误");
if (JSON.stringify(visibleTipLayout(tips, "child")) !== JSON.stringify({ left: { kind: "tip", tipId: "root" }, rightTipId: "child" })) throw new Error("子 Tip 没有用父聊天替换文档位置");
if (JSON.stringify(visibleTipLayout(tips, "grandchild")) !== JSON.stringify({ left: { kind: "tip", tipId: "child" }, rightTipId: "grandchild" })) throw new Error("孙 Tip 没有递归替换左右聊天位置");
const forest = buildTipForest(tips);
if (forest.length !== 1 || forest[0].children.length !== 2 || forest[0].children[0].children[0].tip.id !== "grandchild") throw new Error("Tip 树层级构建错误");
if (JSON.stringify([...collectTipSubtreeIds(tips, "child")].sort()) !== JSON.stringify(["child", "grandchild"])) throw new Error("级联删除子树计算错误");
const cyclic = [makeTip("a", "b"), makeTip("b", "a")];
if (buildTipPath(cyclic, "a").length !== 0 || buildTipForest(cyclic).length !== 0) throw new Error("循环父链没有被安全拒绝");
const orphan = [makeTip("orphan", "missing")];
if (buildTipPath(orphan, "orphan").length !== 0 || buildTipForest(orphan).length !== 0) throw new Error("孤儿 Tip 被错误展示成合法树节点");
const thirtyTwo = Array.from({ length: 32 }, (_, index) => makeTip(`deep-${index + 1}`, index ? `deep-${index}` : undefined));
if (buildTipPath(thirtyTwo, "deep-32").length !== 32) throw new Error("合法的 32 层 Tip 路径被错误拒绝");
const thirtyThree = [...thirtyTwo, makeTip("deep-33", "deep-32")];
if (buildTipPath(thirtyThree, "deep-33").length !== 0) throw new Error("超过 32 层的 Tip 路径没有被拒绝");

console.log(JSON.stringify({ nestedPath: true, recursiveLayout: true, tree: true, cascade: true, cycleBlocked: true, orphanBlocked: true, depthLimit: true, safeMessageLinks: true }));
