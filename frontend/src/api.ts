export type Obj = Record<string, any>;

let csrf = "";

export function setCsrf(token: string) {
  csrf = token;
}

export async function api(
  path: string,
  body?: any,
  method?: string,
): Promise<any> {
  const isForm = body instanceof FormData;
  const r = await fetch("/api" + path, {
    method: method || (body === undefined ? "GET" : "POST"),
    headers: {
      ...(body !== undefined && !isForm
        ? { "Content-Type": "application/json" }
        : {}),
      "X-CSRF-Token": csrf,
    },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) {
    throw new Error(
      value.message +
        (value.details ? " · " + JSON.stringify(value.details) : ""),
    );
  }
  return value;
}

export const clone = <T,>(v: T): T => structuredClone(v);

export const numberExpr = (n = 0) => ({ kind: "number", value: n });

export const fmt = (v: any) =>
  v === null || v === undefined
    ? "无"
    : typeof v === "number"
      ? Number(v.toPrecision(9)).toString()
      : String(v);

export const when = (n: number) =>
  new Date(n * 1000).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    hour12: false,
  });

export function downloadJson(name: string, content: string) {
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
