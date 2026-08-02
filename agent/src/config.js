import { randomUUID } from "node:crypto";

function env(name, fallback) {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
}

function required(name) {
  const value = env(name);
  if (!value) {
    console.error(`[config] ${name} is required. Copy .env.example and fill it in.`);
    process.exit(1);
  }
  return value;
}

export const config = {
  nodeId: required("NODE_ID"),
  nodeName: env("NODE_NAME", `node-${randomUUID().slice(0, 8)}`),
  secret: required("AGENT_SHARED_SECRET"),
  panelUrl: env("PANEL_URL", "").replace(/\/$/, ""),

  port: Number(env("PORT", 8080)),
  portRange: {
    start: Number(env("PORT_RANGE_START", 25600)),
    end: Number(env("PORT_RANGE_END", 25999)),
  },

  maxServers: Number(env("MAX_SERVERS", 40)),
  maxMemoryMb: Number(env("MAX_MEMORY_MB", 32768)),

  dataDir: env("DATA_DIR", "/var/lib/howlhost"),

  images: {
    java: env("JAVA_IMAGE", "itzg/minecraft-server:latest"),
    bedrock: env("BEDROCK_IMAGE", "itzg/minecraft-bedrock-server:latest"),
  },

  heartbeatMs: 20_000,
  idleCheckMs: 60_000,
};
