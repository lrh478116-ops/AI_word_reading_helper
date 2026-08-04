process.env.AI_TIP_EMBEDDED = "1";

const { runPythonCalculation } = await import("../dist-electron/server.cjs");
const decimal = await runPythonCalculation("decimal.Decimal('0.1') + decimal.Decimal('0.2')");
const statistics = await runPythonCalculation("statistics.mean([1, 2, 3, 10])");
let blocked = false;
try { await runPythonCalculation("import os\nos.listdir('.')"); } catch { blocked = true; }

if (!decimal.includes("0.3")) throw new Error(`Decimal 精度测试失败：${decimal}`);
if (!statistics.includes("4")) throw new Error(`Statistics 测试失败：${statistics}`);
if (!blocked) throw new Error("Python 沙箱未阻止文件系统访问");
console.log(JSON.stringify({ decimal, statistics, sandboxBlocked: blocked }));
