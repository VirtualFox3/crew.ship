"use client";

import { useState } from "react";
import { Button, Card, CardHeader, Field, Input } from "@/components/ui";
import type { Node } from "@/lib/types";

export function HostComputer({ initialNodes }: { initialNodes: Node[] }) {
  const [nodes, setNodes] = useState(initialNodes);
  const [config, setConfig] = useState<Record<string, string> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function register(form: FormData) {
    setLoading(true); setError(null);
    const response = await fetch("/api/nodes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      name: form.get("name"), agent_url: form.get("agent_url"), public_host: form.get("public_host"),
      max_servers: Number(form.get("max_servers")), max_memory_mb: Number(form.get("max_memory_mb")),
    }) });
    const body = await response.json();
    setLoading(false);
    if (!response.ok) return setError(body.error ?? "Could not register this computer.");
    setNodes((current) => [...current, body.node]); setConfig(body.config);
  }

  return <Card>
    <CardHeader title="Host computer" description="Your servers run on your computer, never somebody else's." />
    <div className="space-y-5 p-5">
      {nodes.map((node) => <div key={node.id} className="flex items-center justify-between border border-ink-700 p-3 text-sm">
        <span>{node.name}</span><span className={node.status === "online" ? "text-grass-400" : "text-amber-400"}>{node.status}</span>
      </div>)}
      {!config && <form action={register} className="grid gap-3 sm:grid-cols-2">
        <Field label="Computer name"><Input name="name" required defaultValue="My computer" /></Field>
        <Field label="Agent HTTPS URL" hint="Use a Cloudflare tunnel for the control API."><Input name="agent_url" type="url" required placeholder="https://agent.example.com" /></Field>
        <Field label="playit.gg address"><Input name="public_host" required placeholder="name.craft.playit.gg" /></Field>
        <Field label="Memory available (MB)"><Input name="max_memory_mb" type="number" min="2048" defaultValue="8192" /></Field>
        <Field label="Maximum servers"><Input name="max_servers" type="number" min="1" max="40" defaultValue="4" /></Field>
        <div className="flex items-end"><Button loading={loading} type="submit">Register computer</Button></div>
      </form>}
      {error && <p className="text-sm text-red-400">{error}</p>}
      {config && <div className="space-y-2">
        <p className="text-sm text-ink-300">Put these values in <code>agent/.env</code>. The credential is shown only now.</p>
        <pre className="overflow-auto border border-ink-700 bg-ink-950 p-3 text-xs text-grass-300">{Object.entries(config).map(([key,value]) => `${key}=${value}`).join("\n")}</pre>
      </div>}
    </div>
  </Card>;
}
