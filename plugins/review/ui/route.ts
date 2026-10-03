export type Route = { name: "criteria" } | { name: "criterion"; id: string } | { name: "notFound" };

function decode(segment: string): string | null {
  try {
    const value = decodeURIComponent(segment);
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

/** context.location(pathname+search+hash)에서 search/hash를 떼고 Plugin 경로 2종으로 해석한다. */
export function parseRoute(location: string): Route {
  const pathname = location.split(/[?#]/, 1)[0] ?? "";
  const trimmed = pathname.length > 1 ? pathname.replace(/\/$/, "") : pathname;
  if (trimmed === "/" || trimmed === "") return { name: "criteria" };
  const segments = trimmed.split("/");
  // ["", "criteria", id]
  if (segments.length === 3 && segments[0] === "" && segments[1] === "criteria") {
    const id = decode(segments[2] ?? "");
    if (id !== null) return { name: "criterion", id };
  }
  return { name: "notFound" };
}

export const criterionPath = (id: string) => `/criteria/${encodeURIComponent(id)}`;
