export async function calculateInRuntime(pyodide: any, code: string) {
  const source = code.trim().slice(0, 2500);
  if (!source) throw new Error("Python 代码为空");
  const wrapper = `
import ast, contextlib, io, json, math, statistics, decimal, fractions
_source = ${JSON.stringify(source)}
_tree = ast.parse(_source, mode="exec")
if len(list(ast.walk(_tree))) > 400:
    raise ValueError("计算表达式过于复杂")
_blocked = (ast.Import, ast.ImportFrom, ast.While, ast.For, ast.AsyncFor, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp, ast.With, ast.AsyncWith, ast.Try, ast.Raise, ast.Delete, ast.Global, ast.Nonlocal)
_allowed_calls = {"abs", "round", "min", "max", "sum", "len", "sorted", "pow", "print", "float", "int", "complex", "list", "tuple"}
_allowed_modules = {"math", "statistics", "decimal", "fractions"}
for _node in ast.walk(_tree):
    if isinstance(_node, _blocked):
        raise ValueError(f"不允许的 Python 语法: {type(_node).__name__}")
    if isinstance(_node, ast.Name) and _node.id.startswith("_"):
        raise ValueError("不允许访问私有名称")
    if isinstance(_node, ast.Attribute):
        if _node.attr.startswith("_") or not isinstance(_node.value, ast.Name) or _node.value.id not in _allowed_modules:
            raise ValueError("只允许调用 math/statistics/decimal/fractions 的公开函数")
    if isinstance(_node, ast.Call):
        if isinstance(_node.func, ast.Name) and _node.func.id not in _allowed_calls:
            raise ValueError(f"不允许调用函数: {_node.func.id}")
        if not isinstance(_node.func, (ast.Name, ast.Attribute)):
            raise ValueError("不允许的函数调用")
    if isinstance(_node, ast.BinOp) and isinstance(_node.op, ast.Pow) and isinstance(_node.right, ast.Constant) and isinstance(_node.right.value, (int, float)) and abs(_node.right.value) > 10000:
        raise ValueError("指数过大")
if _tree.body and isinstance(_tree.body[-1], ast.Expr):
    _tree.body[-1] = ast.Assign(targets=[ast.Name(id="result", ctx=ast.Store())], value=_tree.body[-1].value)
    ast.fix_missing_locations(_tree)
_safe_builtins = {"abs": abs, "round": round, "min": min, "max": max, "sum": sum, "len": len, "sorted": sorted, "pow": pow, "print": print, "float": float, "int": int, "complex": complex, "list": list, "tuple": tuple}
_env = {"__builtins__": _safe_builtins, "math": math, "statistics": statistics, "decimal": decimal, "fractions": fractions}
_stdout = io.StringIO()
with contextlib.redirect_stdout(_stdout):
    exec(compile(_tree, "<ai-tip-calculation>", "exec"), _env, _env)
_value = _env.get("result", None)
json.dumps({"stdout": _stdout.getvalue()[-3000:], "result": repr(_value)[:3000] if _value is not None else ""}, ensure_ascii=False)
`;
  const raw = await pyodide.runPythonAsync(wrapper);
  const parsed = JSON.parse(String(raw)) as { stdout: string; result: string };
  return [parsed.stdout.trim(), parsed.result ? `结果: ${parsed.result}` : ""].filter(Boolean).join("\n") || "计算已完成";
}
