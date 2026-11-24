import React, { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
// Runtime data is validated by the backend. Generated schema types accompany this renderer.
export type Expr = { kind: string; [key: string]: any };

const escape = (s: string) =>
  String(s).replace(/[\\{}_$%&#^~]/g, (x) => `\\${x}`);

function wrapIfAdd(e: Expr, tex: string): string {
  return e.kind === "add" || e.kind === "neg"
    ? `\\left(${tex}\\right)`
    : tex;
}

export function formula(e: Expr, model?: Record<string, any>): string {
  if (!e) return "?";
  const f = (child: Expr) => formula(child, model);
  switch (e.kind) {
    case "number":
      return String(e.value);
    case "var":
    case "param": {
      const sym =
        model?.variables?.find((v: any) => v.id === e.id)?.symbol ||
        model?.parameters?.find((v: any) => v.id === e.id)?.symbol ||
        e.id;
      return (
        `\\mathrm{${escape(sym)}}` +
        (e.indices?.length
          ? `_{${e.indices.map((i: any) => escape(i.kind === "index" ? i.name : String(i.value))).join(",")}}`
          : "")
      );
    }
    case "add": {
      if (!e.args?.length) return "0";
      return e.args
        .map((arg: Expr, idx: number) => {
          if (idx > 0 && arg.kind === "neg") {
            return ` - ${wrapIfAdd(arg.arg, f(arg.arg))}`;
          }
          if (idx > 0 && arg.kind === "number" && arg.value < 0) {
            return ` - ${Math.abs(arg.value)}`;
          }
          return (idx > 0 ? " + " : "") + f(arg);
        })
        .join("");
    }
    case "neg":
      return `-${wrapIfAdd(e.arg, f(e.arg))}`;
    case "mul": {
      const l = wrapIfAdd(e.left, f(e.left));
      const r = wrapIfAdd(e.right, f(e.right));
      return `${l}\\,${r}`;
    }
    case "div":
      return `\\frac{${f(e.numerator)}}{${f(e.denominator)}}`;
    case "sum": {
      const setIdx = e.set_index
        ? `_{${escape(e.set_index.kind === "index" ? e.set_index.name : String(e.set_index.value))}}`
        : "";
      return `\\sum_{${escape(e.index)}\\in\\mathrm{${escape(e.set)}}${setIdx}} ${wrapIfAdd(e.body, f(e.body))}`;
    }
    default:
      return "?";
  }
}

function wrapTextIfAdd(e: Expr, text: string): string {
  return e.kind === "add" || e.kind === "neg" ? `(${text})` : text;
}

export function notation(e: Expr): string {
  if (!e) return "0";
  switch (e.kind) {
    case "number":
      return String(e.value);
    case "var":
    case "param":
      return (
        e.id +
        (e.indices?.length
          ? "[" +
            e.indices
              .map((i: any) =>
                i.kind === "index" ? i.name : JSON.stringify(i.value),
              )
              .join(", ") +
            "]"
          : "")
      );
    case "add": {
      if (!e.args?.length) return "0";
      return e.args
        .map((arg: Expr, idx: number) => {
          if (idx > 0 && arg.kind === "neg") {
            return ` - ${wrapTextIfAdd(arg.arg, notation(arg.arg))}`;
          }
          if (idx > 0 && arg.kind === "number" && arg.value < 0) {
            return ` - ${Math.abs(arg.value)}`;
          }
          return (idx > 0 ? " + " : "") + notation(arg);
        })
        .join("");
    }
    case "neg":
      return "-" + wrapTextIfAdd(e.arg, notation(e.arg));
    case "mul":
      return `${wrapTextIfAdd(e.left, notation(e.left))} * ${wrapTextIfAdd(e.right, notation(e.right))}`;
    case "div":
      return `${wrapTextIfAdd(e.numerator, notation(e.numerator))} / ${wrapTextIfAdd(e.denominator, notation(e.denominator))}`;
    case "sum": {
      const setPart = e.set_index
        ? `${e.set}[${e.set_index.kind === "index" ? e.set_index.name : JSON.stringify(e.set_index.value)}]`
        : e.set;
      return `sum(${e.index}, ${setPart}, ${notation(e.body)})`;
    }
    default:
      return "0";
  }
}

export function formatWhereTex(raw: string): string {
  const s = (raw || "").trim();
  if (!s) return "";
  return escape(s)
    .replace(/!=/g, "\\ne ")
    .replace(/<=/g, "\\le ")
    .replace(/>=/g, "\\ge ")
    .replace(/==/g, "=")
    .replace(/\band\b/g, "\\land ")
    .replace(/\bor\b/g, "\\lor ")
    .replace(/\bnot\b/g, "\\neg ");
}

export const MathView = React.memo(function MathView({
  tex,
  displayMode = false,
}: {
  tex: string;
  displayMode?: boolean;
}) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, {
        throwOnError: false,
        trust: false,
        strict: "warn",
        maxExpand: 100,
        displayMode,
        output: "htmlAndMathml",
      });
    } catch {
      return "公式无法显示";
    }
  }, [tex, displayMode]);
  return <div className="math" dangerouslySetInnerHTML={{ __html: html }} />;
});
