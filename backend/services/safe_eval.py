"""
services/safe_eval.py — Run an LLM-written pandas expression safely.

The old code did eval(code, {"df": df, "pd": pd}), which still exposes all of
Python's builtins: an expression such as __import__('os').system('...') ran
on the server. A prompt injection hidden inside an uploaded spreadsheet could
trigger that. Here the expression is parsed first and only a small, read-only
subset of Python/pandas is allowed.
"""
import ast

import numpy as np
import pandas as pd

SAFE_BUILTINS = {
    "len": len, "round": round, "abs": abs, "min": min, "max": max, "sum": sum,
    "sorted": sorted, "list": list, "dict": dict, "tuple": tuple, "set": set,
    "str": str, "int": int, "float": float, "bool": bool, "range": range,
    "zip": zip, "enumerate": enumerate, "any": any, "all": all,
}

ALLOWED_PD_ATTRS = {
    "to_datetime", "to_numeric", "Grouper", "NamedAgg", "DataFrame", "Series", "cut", "qcut",
    "concat", "merge", "crosstab", "pivot_table", "Timestamp", "Timedelta", "DateOffset",
    "isna", "notna", "isnull", "notnull", "date_range", "offsets", "MonthEnd", "MonthBegin", "NA", "NaT",
}
ALLOWED_NP_ATTRS = {"nan", "inf", "mean", "median", "sum", "std", "round", "abs", "where", "percentile", "number"}

# Methods that write files, read files, run code, or reach the network.
BLOCKED_ATTRS = {
    "to_csv", "to_excel", "to_pickle", "to_parquet", "to_json", "to_sql", "to_hdf", "to_feather",
    "to_html", "to_latex", "to_markdown", "to_clipboard", "to_stata", "to_orc", "to_xml", "to_gbq",
    "eval", "query", "pipe", "read_csv", "read_excel", "read_pickle", "read_sql", "read_json",
    "read_html", "read_parquet", "read_clipboard", "read_table", "read_fwf", "read_xml", "io", "api",
    "options", "set_option", "plot", "style", "load", "save", "tofile", "fromfile", "system", "popen",
}

_ALLOWED_NODES = (
    ast.Expression, ast.Expr, ast.Name, ast.Load, ast.Attribute, ast.Subscript, ast.Slice,
    ast.Call, ast.keyword, ast.Constant, ast.Tuple, ast.List,
    ast.Dict, ast.Set, ast.BinOp, ast.UnaryOp, ast.BoolOp, ast.Compare, ast.IfExp, ast.Lambda,
    ast.arguments, ast.arg, ast.ListComp, ast.DictComp, ast.SetComp, ast.GeneratorExp, ast.comprehension,
    ast.Store, ast.operator, ast.unaryop, ast.boolop, ast.cmpop, ast.expr_context, ast.Starred,
    ast.JoinedStr, ast.FormattedValue,
)


class UnsafeExpression(ValueError):
    pass


def clean_code(text: str) -> str:
    """Strip markdown fences / 'python' tags; keep the last line that parses as an expression."""
    t = (text or "").replace("```python", "```").replace("```py", "```")
    if "```" in t:
        parts = t.split("```")
        t = parts[1] if len(parts) >= 3 else t.replace("```", "")
    t = t.strip()
    try:
        ast.parse(t, mode="eval")
        return t
    except SyntaxError:
        pass
    for line in reversed([ln.strip() for ln in t.splitlines() if ln.strip()]):
        line = line.removeprefix("result =").removeprefix("result=").strip()
        try:
            ast.parse(line, mode="eval")
            return line
        except SyntaxError:
            continue
    return t


def validate(code: str) -> ast.Expression:
    try:
        tree = ast.parse(code, mode="eval")
    except SyntaxError as e:
        raise UnsafeExpression(f"Not a valid expression: {e.msg}")
    lambda_args = {a.arg for n in ast.walk(tree) if isinstance(n, ast.Lambda) for a in n.args.args}
    comp_names = {t.id for n in ast.walk(tree) if isinstance(n, ast.comprehension)
                  for t in ast.walk(n.target) if isinstance(t, ast.Name)}
    allowed_names = {"df", "pd", "np", "True", "False", "None"} | set(SAFE_BUILTINS) | lambda_args | comp_names
    for node in ast.walk(tree):
        if not isinstance(node, _ALLOWED_NODES):
            raise UnsafeExpression(f"'{type(node).__name__}' is not allowed")
        if isinstance(node, ast.Name) and node.id not in allowed_names:
            raise UnsafeExpression(f"name '{node.id}' is not allowed")
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("_") or node.attr in BLOCKED_ATTRS:
                raise UnsafeExpression(f"attribute '{node.attr}' is not allowed")
            if isinstance(node.value, ast.Name) and node.value.id == "pd" and node.attr not in ALLOWED_PD_ATTRS:
                raise UnsafeExpression(f"pd.{node.attr} is not allowed")
            if isinstance(node.value, ast.Name) and node.value.id == "np" and node.attr not in ALLOWED_NP_ATTRS:
                raise UnsafeExpression(f"np.{node.attr} is not allowed")
    return tree


def safe_eval(code: str, df: pd.DataFrame):
    tree = validate(code)
    return eval(compile(tree, "<llm-pandas>", "eval"),
                {"__builtins__": SAFE_BUILTINS, "df": df, "pd": pd, "np": np})


def result_to_text(result, max_rows: int = 40) -> str:
    if isinstance(result, pd.DataFrame):
        return result.head(max_rows).to_string() + (f"\n... ({len(result)} rows total)" if len(result) > max_rows else "")
    if isinstance(result, pd.Series):
        return result.head(max_rows).to_string() + (f"\n... ({len(result)} items total)" if len(result) > max_rows else "")
    if isinstance(result, (float, np.floating)):
        return f"{float(result):,.4f}".rstrip("0").rstrip(".")
    return str(result)
