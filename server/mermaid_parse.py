"""Lightweight Mermaid flowchart parser (flowchart/graph TD|LR).

Supports node shapes, chained links (A --> B --> C), link labels, dotted/thick links and
subgraphs (mapped to groups). Returns None for syntax it cannot handle so the caller can fall
back to the LLM.
"""

from __future__ import annotations

import re
from typing import Any

ID = r"[A-Za-z_][\w-]*"

# (regex, shape, kind-hint). Order matters: longer / more specific openers first.
SHAPES: list[tuple[re.Pattern[str], str, str | None]] = [
    (re.compile(r"\(\[\s*(.+?)\s*\]\)"), "terminator", "start-end"),  # ([stadium])
    (re.compile(r"\[\(\s*(.+?)\s*\)\]"), "data", "database"),  # [(cylinder)]
    (re.compile(r"\(\(\(\s*(.+?)\s*\)\)\)"), "terminator", "start-end"),  # (((double)))
    (re.compile(r"\(\(\s*(.+?)\s*\)\)"), "terminator", "start-end"),  # ((circle))
    (re.compile(r"\{\{\s*(.+?)\s*\}\}"), "process", None),  # {{hexagon}}
    (re.compile(r"\[/\s*(.+?)\s*/\]"), "io", "input-output"),  # [/parallelogram/]
    (re.compile(r"\[\\\s*(.+?)\s*\\\]"), "io", "input-output"),  # [\parallelogram\]
    (re.compile(r"\[\[\s*(.+?)\s*\]\]"), "process", None),  # [[subroutine]]
    (re.compile(r"\[\s*(.+?)\s*\]"), "process", None),  # [rect]
    (re.compile(r"\(\s*(.+?)\s*\)"), "process", None),  # (round)
    (re.compile(r"\{\s*(.+?)\s*\}"), "decision", "decision"),  # {diamond}
    (re.compile(r">\s*(.+?)\s*\]"), "io", "input-output"),  # >asymmetric]
]

LINK = re.compile(
    r"\s*(?:"
    r"(?P<tl>--|==)\s+(?P<tlabel>[^-=|>][^|]*?)\s+(?P<tarrow>-->|==>|---)"  # -- text -->
    r"|"
    r"(?P<arrow><?(?:-\.+->|-\.+-|--+>|==+>|--+o|--+x|---+|===+))"  # plain link
    r"(?:\s*\|\s*(?P<label>[^|]*?)\s*\|)?"  # |label|
    r")\s*"
)

NODE_ID = re.compile(rf"({ID})")
SUBGRAPH = re.compile(rf"^subgraph\s+(?:({ID})\s*\[\s*\"?(.+?)\"?\s*\]|\"?(.+?)\"?)\s*$", re.IGNORECASE)
IGNORED = ("style ", "classdef ", "class ", "linkstyle ", "click ", "accTitle", "accDescr")

ICON_HINTS: list[tuple[tuple[str, ...], str]] = [
    (("api gateway", "gateway"), "api-gateway"),
    (("load balancer", "balancer", "alb", "nlb"), "load-balancer"),
    (("cache", "redis", "memcache"), "cache"),
    (("queue", "sqs", "kafka", "rabbit"), "queue"),
    (("database", "postgres", "mysql", "mongo", "rds"), "database"),
    (("server", "service", "backend"), "server"),
    (("browser", "web app", "frontend"), "browser"),
    (("mobile", "ios", "android"), "mobile"),
    (("user", "person", "customer", "actor", "admin"), "person"),
    (("firewall", "waf"), "firewall"),
    (("cdn", "cloudfront"), "cloudfront"),
]


def _clean_label(raw: str) -> str:
    text = raw.strip().strip('"').strip("'")
    text = re.sub(r"<br\s*/?>", " ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    return " ".join(text.split())


def _icon_for(label: str) -> str | None:
    low = label.lower()
    for needles, kind in ICON_HINTS:
        if any(n in low for n in needles):
            return kind
    return None


def _resolve(label: str, shape: str, kind_hint: str | None) -> tuple[str, str]:
    """Return (shape, kind) for a parsed node."""
    low = label.lower()
    if shape == "process":
        icon = _icon_for(label)
        if icon == "person":
            return "person", "person"
        if icon == "database":
            return "data", "database"
        if icon:
            return "service", icon
        if low in {"start", "end", "begin", "stop", "finish"}:
            return "terminator", "start-end"
        return "process", "process"
    if shape == "terminator" and _icon_for(label) == "person":
        return "person", "person"
    return shape, kind_hint or "process"


def _parse_node(text: str, pos: int) -> tuple[dict[str, str] | None, int]:
    m = NODE_ID.match(text, pos)
    if not m:
        return None, pos
    nid = m.group(1)
    end = m.end()
    label: str | None = None
    shape = "process"
    kind_hint: str | None = None
    for pattern, shp, kind in SHAPES:
        sm = pattern.match(text, end)
        if sm:
            label = _clean_label(sm.group(1))
            shape, kind_hint = shp, kind
            end = sm.end()
            break
    node: dict[str, str] = {"id": nid}
    if label is not None:
        node["label"] = label
        node["shape"], node["kind"] = _resolve(label, shape, kind_hint)
    return node, end


def parse_mermaid_flowchart(source: str) -> dict[str, Any] | None:
    lines: list[str] = []
    for raw in source.splitlines():
        line = raw.strip()
        if not line or line.startswith("%%"):
            continue
        if "%%" in line:
            line = line.split("%%", 1)[0].strip()
        if line:
            lines.extend(part.strip() for part in line.split(";") if part.strip())

    if not lines:
        return None

    header = lines[0].lower()
    if not (header.startswith("flowchart") or header.startswith("graph")):
        return None

    direction = "TB"
    tokens = header.split()
    if "lr" in tokens or "rl" in tokens:
        direction = "LR"

    nodes: dict[str, dict[str, str]] = {}
    edges: list[dict[str, str]] = []
    groups: dict[str, dict[str, str]] = {}
    stack: list[str] = []

    def register(node: dict[str, str]) -> None:
        nid = node["id"]
        current = nodes.get(nid)
        if current is None:
            current = {"id": nid, "label": node.get("label", nid), "kind": "process", "shape": "process"}
            if "label" not in node:
                current["_implicit"] = "1"
            nodes[nid] = current
        if "label" in node:
            current["label"] = node["label"]
            current["shape"] = node["shape"]
            current["kind"] = node["kind"]
            current.pop("_implicit", None)
        if stack and "group" not in current:
            current["group"] = stack[-1]

    for line in lines[1:]:
        low = line.lower()
        if low.startswith(IGNORED):
            continue
        if low.startswith("direction "):
            continue
        sg = SUBGRAPH.match(line)
        if sg:
            gid = sg.group(1) or re.sub(r"\W+", "_", (sg.group(3) or "group").strip()) or "group"
            title = _clean_label(sg.group(2) or sg.group(3) or gid)
            base, n = gid, 1
            while gid in groups or gid in nodes:
                n += 1
                gid = f"{base}_{n}"
            groups[gid] = {"id": gid, "label": title}
            stack.append(gid)
            continue
        if low == "end":
            if stack:
                stack.pop()
            continue

        # A line is: node (link node)*
        pos = 0
        node, pos = _parse_node(line, pos)
        if node is None:
            return None
        register(node)
        prev = node["id"]
        while pos < len(line):
            lm = LINK.match(line, pos)
            if not lm:
                return None
            pos = lm.end()
            arrow = lm.group("arrow") or lm.group("tarrow") or ""
            label = _clean_label(lm.group("label") or lm.group("tlabel") or "")
            nxt, pos = _parse_node(line, pos)
            if nxt is None:
                return None
            register(nxt)
            edge: dict[str, str] = {"from": prev, "to": nxt["id"]}
            if label:
                edge["label"] = label
            if "." in arrow:
                edge["kind"] = "async"
            edges.append(edge)
            prev = nxt["id"]

    if not nodes:
        return None

    out_nodes: list[dict[str, str]] = []
    for node in list(nodes.values())[:40]:
        node.pop("_implicit", None)
        out_nodes.append(node)

    return {
        "direction": direction,
        "nodes": out_nodes,
        "edges": edges,
        "groups": list(groups.values()),
    }
