import random
import itertools
import pytest
from modellab.compiler import compile_model, ModelError
from modellab.parser import parse_expression
from modellab.solver_template import solve
from modellab.validation import validate_result


def model(objective, sense="min", constraints=(), bounds=(-3, 3)):
    m = {
        "variables": [
            dict(id="x", domain="integer", lower=bounds[0], upper=bounds[1]),
            dict(id="y", domain="integer", lower=bounds[0], upper=bounds[1]),
            dict(id="z", domain="binary", lower=0, upper=1),
        ],
        "objective": dict(id="obj", sense=sense, expr=None),
        "constraints": [],
    }
    m["objective"]["expr"] = parse_expression(objective, m)
    for i, (lhs, op, rhs) in enumerate(constraints):
        m["constraints"].append(
            dict(
                id=f"c{i}",
                lhs=parse_expression(lhs, m),
                sense=op,
                rhs=parse_expression(rhs, m),
            )
        )
    return m


def brute(objective, sense, constraints, lo=-3, hi=3):
    best = None
    ops = dict(le=lambda a, b: a <= b, ge=lambda a, b: a >= b, eq=lambda a, b: a == b)
    for x, y, z in itertools.product(range(lo, hi + 1), range(lo, hi + 1), (0, 1)):
        env = dict(x=x, y=y, z=z)
        if all(ops[op](eval(l, env), eval(r, env)) for l, op, r in constraints):
            v = eval(objective, env)
            if best is None or (v < best if sense == "min" else v > best):
                best = v
    return best


def lin(rng):
    return f"({rng.randint(-3, 3)}*x + {rng.randint(-3, 3)}*y + {rng.randint(-4, 4)})"


def atom(rng):
    kind = rng.choice(["abs", "max", "min", "prod", "lin"])
    if kind == "abs":
        return f"abs({lin(rng)})"
    if kind in ("max", "min"):
        return f"{kind}({lin(rng)}, {lin(rng)}, {lin(rng)})"
    if kind == "prod":
        return rng.choice([f"z*{lin(rng)}", f"{lin(rng)}*z", f"(1 - z)*{lin(rng)}"])
    return lin(rng)


def random_case(seed):
    rng = random.Random(seed)
    objective = " + ".join(
        f"{rng.choice([-2, -1, 1, 2])}*{atom(rng)}" for _ in range(rng.randint(1, 3))
    )
    constraints = [
        (atom(rng), rng.choice(["le", "ge", "eq"]), str(rng.randint(-4, 6)))
        for _ in range(rng.randint(0, 2))
    ]
    return objective, rng.choice(["min", "max"]), constraints


@pytest.mark.parametrize("seed", range(150))
def test_linearization_matches_brute_force(seed):
    objective, sense, constraints = random_case(seed)
    expected = brute(objective, sense, constraints)
    ir = compile_model(model(objective, sense, constraints))
    result = solve(ir)
    if expected is None:
        assert result["termination"] == "infeasible"
        return
    assert result["termination"] == "optimal", (objective, sense, constraints)
    assert result["objective_value"] == pytest.approx(expected, abs=1e-6)
    assert validate_result(ir, result)["passed"]


def aux_domains(ir):
    return [v["domain"] for v in ir["variables"] if v.get("auxiliary")]


def test_convex_direction_needs_no_binaries():
    ir = compile_model(model("abs(x - 1) + max(x, y)", "min"))
    assert aux_domains(ir) and set(aux_domains(ir)) == {"continuous"}
    assert solve(ir)["objective_value"] == pytest.approx(1)


def test_nonconvex_direction_uses_binaries():
    ir = compile_model(model("abs(x)", "max"))
    assert "binary" in aux_domains(ir)
    assert solve(ir)["objective_value"] == 3


def test_sign_known_abs_is_not_linearized():
    m = model("abs(x)", "min", bounds=(1, 3))
    assert not any(v.get("auxiliary") for v in compile_model(m)["variables"])


def test_unbounded_exact_linearization_rejected():
    m = model("abs(x)", "max")
    m["variables"][0].update(lower=None, upper=None)
    with pytest.raises(ModelError) as e:
        compile_model(m)
    assert e.value.code == "UNBOUNDED_LINEARIZATION"


def test_general_variable_product_still_rejected():
    with pytest.raises(ModelError) as e:
        compile_model(model("x*y"))
    assert e.value.code == "UNSUPPORTED_NONLINEAR"


def test_parser_arity():
    for text in ("abs(x, y)", "max(x)", "min()"):
        with pytest.raises(ModelError):
            parse_expression(text, model("x"))
