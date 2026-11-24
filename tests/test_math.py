import copy
import itertools
import json
import subprocess
import sys
from pathlib import Path
import pytest
from pydantic import ValidationError
from modellab.compiler import compile_model, ModelError, Limits
from modellab.solver_template import solve
from modellab.validation import validate_result
from modellab.exporter import write_bundle, generate
from modellab.parser import parse_expression

ROOT = Path(__file__).resolve().parents[1]


def fixture(name):
    return json.loads((ROOT / "fixtures" / f"{name}.json").read_text())


@pytest.mark.parametrize(
    "name,status,obj",
    [
        ("production", "optimal", 10),
        ("production_lp", "optimal", 32 / 3),
        ("free_variable", "optimal", -3),
        ("unbounded", "unbounded", None),
        ("infeasible", "infeasible", None),
    ],
)
def test_real_highs(name, status, obj):
    ir = compile_model(fixture(name))
    r = solve(ir)
    assert r["termination"] == status
    if obj is None:
        assert (
            r["objective_value"] is None
            and r["variables"] is None
            and not r["has_incumbent"]
        )
    else:
        assert r["objective_value"] == pytest.approx(obj)
        assert validate_result(ir, r)["passed"]


def test_assignment_against_exhaustive():
    ir = compile_model(fixture("assignment"), fixture("assignment_data"))
    r = solve(ir)
    matrix = [[9, 2, 7], [6, 4, 3], [5, 8, 1]]
    optimum = min(
        sum(matrix[i][perm[i]] for i in range(3))
        for perm in itertools.permutations(range(3))
    )
    assert r["objective_value"] == optimum == 9
    assert len(ir["variables"]) == 9 and len(ir["constraints"]) == 6
    assert [t["coef"] for t in ir["objective"]["terms"]] == sum(matrix, [])
    assert validate_result(ir, r)["passed"]


@pytest.mark.parametrize("sense,expected", [("max", 17), ("min", 7)])
def test_objective_constant_direction(sense, expected):
    m = fixture("production")
    m["objective"]["sense"] = sense
    m["objective"]["expr"] = {
        "kind": "add",
        "args": [m["objective"]["expr"], {"kind": "number", "value": 7}],
    }
    ir = compile_model(m)
    r = solve(ir)
    assert r["objective_value"] == expected
    assert validate_result(ir, r)["passed"]


@pytest.mark.parametrize(
    "expression",
    [
        {
            "kind": "mul",
            "left": {"kind": "var", "id": "x"},
            "right": {"kind": "var", "id": "y"},
        },
        {
            "kind": "div",
            "numerator": {"kind": "number", "value": 1},
            "denominator": {"kind": "var", "id": "x"},
        },
        {
            "kind": "mul",
            "left": {
                "kind": "mul",
                "left": {"kind": "number", "value": 0},
                "right": {"kind": "var", "id": "x"},
            },
            "right": {"kind": "var", "id": "y"},
        },
    ],
)
def test_reject_nonlinear(expression):
    m = fixture("production")
    m["objective"]["expr"] = expression
    with pytest.raises(ModelError, match="决策变量"):
        compile_model(m)


def test_missing_bounds():
    m = fixture("production")
    del m["variables"][0]["lower"]
    with pytest.raises(ValidationError):
        compile_model(m)


def test_reversed_bound_infeasible():
    m = fixture("production")
    m["variables"][0].update(lower=2, upper=1)
    r = solve(compile_model(m))
    assert r["termination"] == "infeasible"
    assert r["conflict_sources"] == ["x"]


def test_integer_and_row_residuals():
    ir = compile_model(fixture("production"))
    r = solve(ir)
    r["variables"]["v_000000"] = 0.5
    r["variables"]["v_000001"] = 8
    check = validate_result(ir, r)
    assert not check["passed"]
    assert check["variables"][0]["integer_violation"] == 0.5
    assert any(x["violation"] > 0 for x in check["rows"])
    assert not check["objective"]["passed"]


@pytest.mark.parametrize(
    "mutation",
    [
        lambda m: m["variables"].append(copy.deepcopy(m["variables"][0])),
        lambda m: m["objective"].update(expr={"kind": "var", "id": "missing"}),
        lambda m: m["objective"].update(expr={"kind": "number", "value": float("nan")}),
    ],
)
def test_bad_model(mutation):
    m = fixture("production")
    mutation(m)
    with pytest.raises((ModelError, ValidationError)):
        compile_model(m)


def test_missing_parameters_and_wrong_scope():
    m = fixture("assignment")
    d = fixture("assignment_data")
    d["cost"].pop()
    with pytest.raises(ModelError, match="不完整"):
        compile_model(m, d)
    m["constraints"][0]["for_each"][0]["index"] = "k"
    with pytest.raises(ModelError, match="索引未声明"):
        compile_model(m, fixture("assignment_data"))


def test_empty_set_does_not_hide_bad_symbol():
    m = fixture("assignment")
    m["sets"][0]["members"] = []
    m["constraints"][0]["lhs"]["body"]["id"] = "oops"
    with pytest.raises(ModelError, match="未知符号"):
        compile_model(m, {"cost": []})


def test_limits():
    with pytest.raises(ModelError, match="变量超过"):
        compile_model(
            fixture("assignment"),
            fixture("assignment_data"),
            limits=Limits(variables=2),
        )
    with pytest.raises(ModelError, match="非零系数"):
        compile_model(fixture("production"), limits=Limits(nonzeros=2))
    m = fixture("production")
    for _ in range(35):
        m["objective"]["expr"] = {"kind": "neg", "arg": m["objective"]["expr"]}
    with pytest.raises(ModelError):
        compile_model(m)


@pytest.mark.parametrize(
    "text",
    [
        "__import__('os').system('id')",
        "x**2",
        "max(x)",
        "x.real",
        "[x for x in range(3)]",
    ],
)
def test_parser_never_executes(text):
    with pytest.raises(ModelError):
        parse_expression(text, fixture("production"))


def test_parser_nested():
    m = fixture("assignment")
    m["objective"]["expr"] = parse_expression("sum(i,I,sum(j,J,cost[i,j]*x[i,j]))", m)
    assert solve(compile_model(m, fixture("assignment_data")))["objective_value"] == 9


def test_export_executes_same_template(tmp_path):
    ir = compile_model(fixture("production"))
    a = write_bundle(ir, tmp_path)
    b = write_bundle(ir, tmp_path)
    assert a == b
    subprocess.run(
        [sys.executable, str(tmp_path / "solve.py")], check=True, capture_output=True
    )
    r = json.loads((tmp_path / "result.json").read_text())
    assert r["objective_value"] == 10
    assert validate_result(ir, r)["passed"]
    code, mapping = generate(ir)
    for sid, items in mapping.items():
        for item in items:
            assert "source_id=" + sid in code.splitlines()[item["code_line"] - 1]


def test_explicit_parameter_default_and_zero_divisor():
    m = fixture("assignment")
    m["parameters"][0]["default"] = 1
    assert solve(compile_model(m, {}))["objective_value"] == 3
    m = fixture("production")
    m["objective"]["expr"] = {
        "kind": "div",
        "numerator": {"kind": "var", "id": "x"},
        "denominator": {"kind": "number", "value": 0},
    }
    with pytest.raises(ModelError, match="分母为零"):
        compile_model(m)


def test_constant_false_and_binary_bounds():
    m = fixture("production")
    m["constraints"].append(
        {
            "id": "false_row",
            "lhs": {"kind": "number", "value": 2},
            "sense": "le",
            "rhs": {"kind": "number", "value": 1},
        }
    )
    r = solve(compile_model(m))
    assert r["termination"] == "infeasible"
    assert r["conflict_sources"] == ["false_row"]
    m = fixture("production")
    m["variables"][0].update(domain="binary", lower=2, upper=4)
    ir = compile_model(m)
    assert ir["variables"][0]["lower"] == 2
    assert ir["variables"][0]["upper"] == 1
    assert solve(ir)["termination"] == "infeasible"


@pytest.mark.parametrize(
    "raw,has_incumbent",
    [
        ("kTimeLimit", True),
        ("kTimeLimit", False),
        ("kIterationLimit", False),
        ("kInterrupt", False),
    ],
)
def test_adapter_limit_status_mapping(monkeypatch, raw, has_incumbent):
    # Adapter fixture responses only; not evidence of real time-limit performance.
    import types
    import highspy

    if not hasattr(highspy.HighsModelStatus, raw):
        pytest.skip("该版本无此状态")

    class Fake:
        def version(self):
            return "fixture"

        def getModelStatus(self):
            return getattr(highspy.HighsModelStatus, raw)

        def getInfo(self):
            return types.SimpleNamespace(
                primal_solution_status=highspy.SolutionStatus.kSolutionStatusFeasible
                if has_incumbent
                else highspy.SolutionStatus.kSolutionStatusNone,
                mip_dual_bound=12,
                mip_gap=0.2,
            )

        def getSolution(self):
            return types.SimpleNamespace(value_valid=has_incumbent, col_value=[0, 2])

        def getObjectiveValue(self):
            return 10

        def getRunTime(self):
            return 0.1

        def modelStatusToString(self, status):
            return status.name

        def __getattr__(self, name):
            return lambda *args: highspy.HighsStatus.kOk

    monkeypatch.setattr(highspy, "Highs", Fake)
    r = solve(compile_model(fixture("production")))
    assert (
        r["termination"]
        == {
            "kTimeLimit": "time_limit",
            "kIterationLimit": "iteration_limit",
            "kInterrupt": "cancelled",
        }[raw]
    )
    assert r["has_incumbent"] == has_incumbent
    assert not r["proven_optimal"]
    assert (
        (r["objective_value"] == 10)
        if has_incumbent
        else (r["objective_value"] is None)
    )


def test_constraint_where_filter():
    m = {
        "sets": [{"id": "I", "members": [1, 2, 3]}],
        "parameters": [
            {
                "id": "a",
                "sets": ["I", "I"],
                "entries": [
                    {"indices": [i, j], "value": 1 if i != j else 0}
                    for i in (1, 2, 3)
                    for j in (1, 2, 3)
                ],
            }
        ],
        "variables": [
            {
                "id": "x",
                "sets": ["I"],
                "domain": "continuous",
                "lower": 0,
                "upper": 10,
            }
        ],
        "objective": {
            "id": "obj",
            "sense": "max",
            "expr": {"kind": "var", "id": "x", "indices": [{"kind": "literal", "value": 1}]},
        },
        "constraints": [
            {
                "id": "off_diag",
                "for_each": [{"index": "i", "set": "I"}, {"index": "j", "set": "I"}],
                "where": "i != j and a[i, j] > 0",
                "lhs": {"kind": "var", "id": "x", "indices": [{"kind": "index", "name": "i"}]},
                "sense": "le",
                "rhs": {"kind": "number", "value": 5},
            },
            {
                "id": "after_first",
                "for_each": [{"index": "t", "set": "I"}],
                "where": "t > 1",
                "lhs": {"kind": "var", "id": "x", "indices": [{"kind": "index", "name": "t"}]},
                "sense": "le",
                "rhs": {"kind": "number", "value": 2},
            },
        ],
    }
    ir = compile_model(m)
    off_diag_rows = [r for r in ir["constraints"] if r["source_id"] == "off_diag"]
    after_first_rows = [r for r in ir["constraints"] if r["source_id"] == "after_first"]
    assert len(off_diag_rows) == 6
    assert all(r["indices"][0] != r["indices"][1] for r in off_diag_rows)
    assert [r["indices"][0] for r in after_first_rows] == [2, 3]

    m["constraints"][0]["where"] = "x[i] > 0"
    with pytest.raises(ModelError, match="不能引用决策变量"):
        compile_model(m)


def test_subset_and_indexed_sets():
    # 1. Subset SA <= S should be allowed to index variables/params declared on S
    m = {
        "sets": [
            {"id": "J", "members": ["A", "B"]},
            {"id": "S", "members": ["M1", "M2", "M3"]},
            {"id": "SA", "members": ["M1", "M2"]},
            {
                "id": "S_of",
                "index_set": "J",
                "indexed_members": [
                    {"index": "A", "members": ["M1", "M2"]},
                    {"index": "B", "members": ["M3"]},
                ],
            },
        ],
        "parameters": [
            {
                "id": "c",
                "sets": ["S"],
                "entries": [
                    {"indices": ["M1"], "value": 2},
                    {"indices": ["M2"], "value": 3},
                    {"indices": ["M3"], "value": 5},
                ],
            }
        ],
        "variables": [
            {
                "id": "x",
                "sets": ["J", "S"],
                "domain": "continuous",
                "lower": 0,
                "upper": 10,
            }
        ],
        "objective": {
            "id": "obj",
            "sense": "min",
            "expr": parse_expression(
                "sum(s, SA, c[s] * x['A', s]) + sum(s, S_of['B'], c[s] * x['B', s])",
                {
                    "variables": [{"id": "x"}],
                    "parameters": [{"id": "c"}],
                },
            ),
        },
        "constraints": [
            {
                "id": "demand",
                "for_each": [{"index": "j", "set": "J"}],
                "lhs": parse_expression(
                    "sum(s, S_of[j], x[j, s])",
                    {"variables": [{"id": "x"}], "parameters": []},
                ),
                "sense": "ge",
                "rhs": {"kind": "number", "value": 4},
            },
            {
                "id": "cap",
                "for_each": [
                    {"index": "j", "set": "J"},
                    {
                        "index": "s",
                        "set": "S_of",
                        "set_index": {"kind": "index", "name": "j"},
                    },
                ],
                "lhs": {
                    "kind": "var",
                    "id": "x",
                    "indices": [
                        {"kind": "index", "name": "j"},
                        {"kind": "index", "name": "s"},
                    ],
                },
                "sense": "le",
                "rhs": {"kind": "number", "value": 4},
            },
        ],
    }
    ir = compile_model(m)
    res = solve(ir)
    assert res["termination"] == "optimal"
    # A uses M1 (cost 2 * 4 = 8), B uses M3 (cost 5 * 4 = 20) => total 28
    assert res["objective_value"] == 28
    assert len([r for r in ir["constraints"] if r["source_id"] == "cap"]) == 3

    # 2. Non-subset should still be rejected
    m["sets"][2]["members"].append("UNKNOWN_M")
    with pytest.raises(ModelError, match="索引集合不匹配"):
        compile_model(m)
