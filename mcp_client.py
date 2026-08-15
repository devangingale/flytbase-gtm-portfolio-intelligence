"""
MCP client for the FlytBase GTM hackathon read-only data source.

Transport: MCP Streamable HTTP (JSON-RPC 2.0 over a single POST endpoint,
responses may come back as plain JSON or as an SSE stream of one or more
`data:` events terminating in a JSON-RPC response).

Usage:
    python mcp_client.py discover      # list tools, write schema.json
    python mcp_client.py call <tool> '{"json": "args"}'
    python mcp_client.py snapshot      # pull everything, write raw payloads to snapshots/

Env:
    MCP_TOKEN     bearer token (required)
    MCP_ENDPOINT  defaults to https://flytbase-gtm-hackathon.lovable.app/api/mcp
"""

import os
import sys
import json
import hashlib
import pathlib
import itertools
from datetime import datetime, timezone

import httpx

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

ENDPOINT = os.environ.get("MCP_ENDPOINT", "https://flytbase-gtm-hackathon.lovable.app/api/mcp")
TOKEN = os.environ.get("MCP_TOKEN")

_id_counter = itertools.count(1)


class McpError(RuntimeError):
    pass


class McpClient:
    """Minimal MCP JSON-RPC client over Streamable HTTP with session support."""

    def __init__(self, endpoint=None, token=None):
        self.endpoint = endpoint or ENDPOINT
        self.token = token or TOKEN
        if not self.token:
            raise McpError("MCP_TOKEN is not set (env var or .env)")
        self.session_id = None
        self._client = httpx.Client(timeout=60.0)

    def _headers(self):
        headers = {
            "Authorization": f"Bearer {self.token}",
            "Content-Type": "application/json",
            "Accept": "application/json, text/event-stream",
        }
        if self.session_id:
            headers["Mcp-Session-Id"] = self.session_id
        return headers

    def _post(self, payload):
        resp = self._client.post(self.endpoint, headers=self._headers(), json=payload)
        sid = resp.headers.get("Mcp-Session-Id") or resp.headers.get("mcp-session-id")
        if sid:
            self.session_id = sid
        resp.raise_for_status()
        content_type = resp.headers.get("content-type", "")
        if "text/event-stream" in content_type:
            return self._parse_sse(resp.text)
        text = resp.text.strip()
        if not text:
            return None
        return json.loads(text)

    @staticmethod
    def _parse_sse(raw_text):
        """Parse an SSE body, return the last JSON-RPC message found."""
        last = None
        data_lines = []
        for line in raw_text.splitlines():
            if line.startswith("data:"):
                data_lines.append(line[len("data:"):].strip())
            elif line.strip() == "" and data_lines:
                chunk = "\n".join(data_lines)
                data_lines = []
                try:
                    last = json.loads(chunk)
                except json.JSONDecodeError:
                    pass
        if data_lines:
            chunk = "\n".join(data_lines)
            try:
                last = json.loads(chunk)
            except json.JSONDecodeError:
                pass
        return last

    def _rpc(self, method, params=None):
        payload = {
            "jsonrpc": "2.0",
            "id": next(_id_counter),
            "method": method,
        }
        if params is not None:
            payload["params"] = params
        result = self._post(payload)
        if result is None:
            raise McpError(f"empty response for method={method}")
        if "error" in result:
            raise McpError(f"RPC error for {method}: {result['error']}")
        return result.get("result")

    def initialize(self):
        result = self._rpc(
            "initialize",
            {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "flytbase-gtm-sync", "version": "0.1.0"},
            },
        )
        # notifications/initialized has no response expected, fire and forget
        try:
            self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        except Exception:
            pass
        return result

    def list_tools(self):
        result = self._rpc("tools/list")
        return result.get("tools", []) if result else []

    def call_tool(self, name, arguments=None):
        result = self._rpc("tools/call", {"name": name, "arguments": arguments or {}})
        return result

    def list_resources(self):
        try:
            result = self._rpc("resources/list")
            return result.get("resources", []) if result else []
        except McpError:
            return []

    def close(self):
        self._client.close()


def content_hash(payload) -> str:
    blob = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(blob).hexdigest()


def cmd_discover():
    client = McpClient()
    init_result = client.initialize()
    tools = client.list_tools()
    resources = client.list_resources()
    schema = {
        "discovered_at": datetime.now(timezone.utc).isoformat(),
        "endpoint": client.endpoint,
        "initialize_result": init_result,
        "tools": tools,
        "resources": resources,
    }
    out_path = pathlib.Path("schema.json")
    out_path.write_text(json.dumps(schema, indent=2), encoding="utf-8")
    print(f"wrote {out_path} ({len(tools)} tools, {len(resources)} resources)")
    for t in tools:
        print(f"  - {t.get('name')}: {t.get('description', '')[:80]}")
    client.close()


def cmd_call(tool_name, args_json):
    args = json.loads(args_json) if args_json else {}
    client = McpClient()
    client.initialize()
    result = client.call_tool(tool_name, args)
    print(json.dumps(result, indent=2))
    client.close()


def cmd_snapshot():
    """Best-effort full pull. Real tool names get wired in after `discover`."""
    schema_path = pathlib.Path("schema.json")
    if not schema_path.exists():
        raise SystemExit("run `python mcp_client.py discover` first")
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    tools = schema.get("tools", [])
    if not tools:
        raise SystemExit("no tools discovered, check schema.json")

    out_dir = pathlib.Path("snapshots")
    out_dir.mkdir(exist_ok=True)

    client = McpClient()
    client.initialize()

    manifest = []
    for tool in tools:
        name = tool.get("name")
        try:
            result = client.call_tool(name, {})
        except McpError as e:
            print(f"  ! {name} failed: {e}")
            continue
        h = content_hash(result)
        fname = out_dir / f"{name}.json"
        fname.write_text(json.dumps(result, indent=2, default=str), encoding="utf-8")
        manifest.append({
            "tool": name,
            "content_hash": h,
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "file": str(fname),
        })
        print(f"  - {name}: hash={h[:12]} -> {fname}")

    (out_dir / "_manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    client.close()


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        raise SystemExit(1)
    cmd = sys.argv[1]
    if cmd == "discover":
        cmd_discover()
    elif cmd == "call":
        if len(sys.argv) < 3:
            raise SystemExit("usage: mcp_client.py call <tool> ['{json}']")
        tool = sys.argv[2]
        args_json = sys.argv[3] if len(sys.argv) > 3 else None
        cmd_call(tool, args_json)
    elif cmd == "snapshot":
        cmd_snapshot()
    else:
        print(__doc__)
        raise SystemExit(1)


if __name__ == "__main__":
    main()
