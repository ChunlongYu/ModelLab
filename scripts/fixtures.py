import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def num(x):
    return {"kind": "number", "value": x}


def var(x, indices=[]):
    return {"kind": "var", "id": x, "indices": indices}


def mul(a, b):
    return {"kind": "mul", "left": a, "right": b}


def add(*args):
    return {"kind": "add", "args": list(args)}


def decl(id, domain="integer", lower=0, upper=None, sets=[]):
    return dict(id=id, domain=domain, lower=lower, upper=upper, sets=sets)


def constraint(id, lhs, sense, rhs, **extra):
    return dict(id=id, lhs=lhs, sense=sense, rhs=rhs, **extra)


m = dict(
    schema_version="1.0",
    variables=[decl("x"), decl("y")],
    objective=dict(
        id="profit", sense="max", expr=add(mul(num(3), var("x")), mul(num(5), var("y")))
    ),
    constraints=[
        constraint("capacity_a", add(mul(num(2), var("x")), var("y")), "le", num(4)),
        constraint("capacity_b", add(var("x"), mul(num(2), var("y"))), "le", num(4)),
    ],
)


def save(name, obj):
    (ROOT / "fixtures" / f"{name}.json").write_text(
        json.dumps(obj, ensure_ascii=False, indent=2)
    )


save("production", m)
m["variables"] = [decl("x", "continuous"), decl("y", "continuous")]
save("production_lp", m)
m = dict(
    variables=[decl("x", "continuous", None, None)],
    objective=dict(id="obj", sense="min", expr=var("x")),
    constraints=[constraint("floor", var("x"), "ge", num(-3))],
)
save("free_variable", m)
m["constraints"] = []
save("unbounded", m)
m["constraints"] = [
    constraint("lo", var("x"), "ge", num(2)),
    constraint("hi", var("x"), "le", num(1)),
]
save("infeasible", m)
i = {"kind": "index", "name": "i"}
j = {"kind": "index", "name": "j"}
summ = lambda index, set, body: dict(kind="sum", index=index, set=set, body=body)
x = var("x", [i, j])
p = dict(kind="param", id="cost", indices=[i, j])
a = dict(
    sets=[dict(id="I", members=["A", "B", "C"]), dict(id="J", members=["P", "Q", "R"])],
    parameters=[dict(id="cost", sets=["I", "J"], data_key="cost")],
    variables=[decl("x", "binary", 0, 1, ["I", "J"])],
    objective=dict(
        id="obj", sense="min", expr=summ("i", "I", summ("j", "J", mul(p, x)))
    ),
    constraints=[
        constraint(
            "one_job",
            summ("j", "J", x),
            "eq",
            num(1),
            for_each=[dict(index="i", set="I")],
        ),
        constraint(
            "one_worker",
            summ("i", "I", x),
            "eq",
            num(1),
            for_each=[dict(index="j", set="J")],
        ),
    ],
)
save("assignment", a)
save(
    "assignment_data",
    dict(
        cost=[
            dict(indices=[r, c], value=[[9, 2, 7], [6, 4, 3], [5, 8, 1]][ri][ci])
            for ri, r in enumerate(["A", "B", "C"])
            for ci, c in enumerate(["P", "Q", "R"])
        ]
    ),
)
save("data_template", dict(cost=[dict(indices=["A", "P"], value=9)]))
