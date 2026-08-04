import { parentPort } from "node:worker_threads";
import { loadPyodide } from "pyodide";

let runtimePromise;
const runtime = () => (runtimePromise ||= loadPyodide({ stdout: () => {}, stderr: () => {} }));

async function symbolic(payload) {
  const expression = String(payload.expression || "").trim().slice(0, 2000);
  const operation = ["simplify", "solve", "diff", "integrate", "factor", "expand"].includes(payload.operation) ? payload.operation : "simplify";
  const variable = /^[A-Za-z][A-Za-z0-9]*$/.test(String(payload.variable || "x")) ? String(payload.variable || "x") : "x";
  if (!expression || /__|import|eval|exec|open|lambda|;|\{|\}/i.test(expression) || !/^[A-Za-z0-9_+\-*/^().,=<>\s\[\]]+$/.test(expression)) throw new Error("符号表达式包含不安全内容");
  const pyodide = await runtime();
  await pyodide.loadPackage("sympy");
  return String(await pyodide.runPythonAsync(`
import sympy as sp
_text = ${JSON.stringify(expression)}
_op = ${JSON.stringify(operation)}
_var = sp.Symbol(${JSON.stringify(variable)})
if "=" in _text:
    _left, _right = _text.split("=", 1)
    _expr = sp.Eq(sp.sympify(_left), sp.sympify(_right))
else:
    _expr = sp.sympify(_text)
if _op == "solve": _result = sp.solve(_expr, _var)
elif _op == "diff": _result = sp.diff(_expr, _var)
elif _op == "integrate": _result = sp.integrate(_expr, _var)
elif _op == "factor": _result = sp.factor(_expr)
elif _op == "expand": _result = sp.expand(_expr)
else: _result = sp.simplify(_expr)
str(_result)
`));
}

async function codeTest(payload) {
  const code = String(payload.code || "").slice(0, 8000);
  const tests = String(payload.tests || "").slice(0, 5000);
  if (!code.trim() || !tests.trim()) throw new Error("代码或测试为空");
  const pyodide = await runtime();
  return String(await pyodide.runPythonAsync(`
import ast, contextlib, io, json, math, statistics
_code = ${JSON.stringify(code)}
_tests = ${JSON.stringify(tests)}
_tree = ast.parse(_code + "\\n" + _tests, mode="exec")
if len(list(ast.walk(_tree))) > 1600: raise ValueError("代码过于复杂")
_blocked = (ast.Import, ast.ImportFrom, ast.While, ast.AsyncFor, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda, ast.With, ast.AsyncWith, ast.Try, ast.Delete, ast.Global, ast.Nonlocal)
for _node in ast.walk(_tree):
    if isinstance(_node, _blocked): raise ValueError(f"不允许的语法: {type(_node).__name__}")
    if isinstance(_node, ast.Name) and _node.id.startswith("_"): raise ValueError("不允许访问私有名称")
    if isinstance(_node, ast.Attribute) and _node.attr.startswith("_"): raise ValueError("不允许访问私有属性")
    if isinstance(_node, ast.Call) and isinstance(_node.func, ast.Name) and _node.func.id == "range":
        for _arg in _node.args:
            if isinstance(_arg, ast.Constant) and isinstance(_arg.value, int) and abs(_arg.value) > 1000000: raise ValueError("range 范围过大")
    if isinstance(_node, ast.BinOp) and isinstance(_node.op, ast.Pow) and isinstance(_node.right, ast.Constant) and isinstance(_node.right.value, (int, float)) and abs(_node.right.value) > 10000: raise ValueError("指数过大")
_safe = {"abs":abs,"round":round,"min":min,"max":max,"sum":sum,"len":len,"sorted":sorted,"range":range,"enumerate":enumerate,"zip":zip,"map":map,"filter":filter,"all":all,"any":any,"print":print,"float":float,"int":int,"str":str,"bool":bool,"list":list,"tuple":tuple,"dict":dict,"set":set,"AssertionError":AssertionError,"ValueError":ValueError,"TypeError":TypeError}
_env = {"__builtins__":_safe,"math":math,"statistics":statistics}
_out = io.StringIO()
with contextlib.redirect_stdout(_out): exec(compile(_tree,"<ai-tip-test>","exec"),_env,_env)
json.dumps({"passed":True,"output":_out.getvalue()[-4000:]},ensure_ascii=False)
`));
}

async function dataAnalysis(payload) {
  const csv = String(payload.csv || "").slice(0, 100000);
  if (!csv.trim()) throw new Error("CSV 数据为空");
  const pyodide = await runtime();
  await pyodide.loadPackage("pandas");
  return String(await pyodide.runPythonAsync(`
import io, json, pandas as pd
_csv = ${JSON.stringify(csv)}
_df = pd.read_csv(io.StringIO(_csv))
if len(_df) > 10000 or len(_df.columns) > 100: raise ValueError("数据规模超过安全限制")
_numeric = _df.select_dtypes(include="number")
_payload = {
  "rows": int(len(_df)), "columns": [str(x) for x in _df.columns],
  "missing": {str(k):int(v) for k,v in _df.isna().sum().items() if int(v)},
  "describe": _df.describe(include="all").fillna("").astype(str).to_dict(),
  "correlations": _numeric.corr().round(6).fillna("").to_dict() if len(_numeric.columns) > 1 else {}
}
json.dumps(_payload,ensure_ascii=False)[:12000]
`));
}

async function uncertainty(payload) {
  const terms = Array.isArray(payload.terms) ? payload.terms.slice(0, 100) : [];
  if (!terms.length) throw new Error("缺少不确定性项");
  const cleaned = terms.map((item) => ({ value: Number(item.value), uncertainty: Math.abs(Number(item.uncertainty)), coefficient: Number(item.coefficient ?? 1) }));
  if (cleaned.some((item) => !Number.isFinite(item.value) || !Number.isFinite(item.uncertainty) || !Number.isFinite(item.coefficient))) throw new Error("不确定性参数无效");
  const pyodide = await runtime();
  return String(await pyodide.runPythonAsync(`
import json, math
_terms = json.loads(${JSON.stringify(JSON.stringify(cleaned))})
_value = sum(x["coefficient"]*x["value"] for x in _terms)
_u = math.sqrt(sum((x["coefficient"]*x["uncertainty"])**2 for x in _terms))
json.dumps({"value":_value,"standard_uncertainty":_u,"relative_uncertainty":abs(_u/_value) if _value else None},ensure_ascii=False)
`));
}

parentPort.on("message", async ({ id, mode, payload }) => {
  try {
    const result = mode === "symbolic" ? await symbolic(payload) : mode === "code_test" ? await codeTest(payload) : mode === "data_analysis" ? await dataAnalysis(payload) : mode === "uncertainty" ? await uncertainty(payload) : (() => { throw new Error("未知 Python 工作模式"); })();
    parentPort.postMessage({ id, ok: true, result });
  } catch (error) {
    parentPort.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
