import test from "node:test";
import assert from "node:assert/strict";

process.env.NODE_ID ??= "test-node";
process.env.AGENT_SHARED_SECRET ??= "test-secret";
process.env.DATA_DIR ??= "/tmp/packhost-test";

const { javaEnv, bedrockEnv, portConfig, stripDockerFraming } = await import("../src/docker.js");
const { parsePlayerList } = await import("../src/rcon.js");

/**
 * These cover the translation layer between the panel's server row and the
 * itzg image's environment — the part with no type checking, no runtime
 * feedback until a container actually boots, and the most ways to be subtly
 * wrong. A typo here means a server that starts with the wrong gamemode or
 * silently ignores the player's settings.
 */

const spec = (over = {}) => ({
  id: "s1",
  edition: "java",
  type: "PAPER",
  version: "1.21.4",
  memoryMb: 4096,
  cpuCores: 2,
  javaPort: 25601,
  bedrockPort: null,
  crossplay: false,
  javaFlags: null,
  build: null,
  properties: {
    motd: "Hello",
    "max-players": "100",
    gamemode: "creative",
    difficulty: "hard",
    pvp: "false",
    "online-mode": "true",
    "white-list": "true",
    "enable-command-block": "true",
    "allow-flight": "true",
    "view-distance": "12",
    "simulation-distance": "8",
    hardcore: "false",
    "spawn-protection": "0",
    "level-type": "minecraft:flat",
    "level-seed": "",
  },
  ...over,
});

test("java env carries the panel's gameplay settings through", () => {
  const env = javaEnv(spec(), "pw");

  assert.equal(env.EULA, "TRUE");
  assert.equal(env.TYPE, "PAPER");
  assert.equal(env.VERSION, "1.21.4");
  assert.equal(env.MAX_MEMORY, "4096M");
  assert.equal(env.INIT_MEMORY, "4096M");
  assert.equal(env.RCON_PASSWORD, "pw");
  assert.equal(env.ENABLE_RCON, "true");

  // The image uses its own names, so these mappings are easy to get wrong.
  assert.equal(env.MODE, "creative", "gamemode -> MODE");
  assert.equal(env.DIFFICULTY, "hard");
  assert.equal(env.PVP, "false");
  assert.equal(env.ENABLE_WHITELIST, "true", "white-list -> ENABLE_WHITELIST");
  assert.equal(env.ALLOW_FLIGHT, "true");
  assert.equal(env.VIEW_DISTANCE, "12");
  assert.equal(env.SIMULATION_DISTANCE, "8");
  assert.equal(env.LEVEL_TYPE, "minecraft:flat");
  assert.equal(env.MAX_PLAYERS, "100");
  assert.equal(env.MOTD, "Hello");
});

test("aikar flags are used only when the user has not supplied their own", () => {
  assert.equal(javaEnv(spec(), "pw").USE_AIKAR_FLAGS, "true");

  const custom = javaEnv(spec({ javaFlags: "-XX:+UseZGC" }), "pw");
  assert.equal(custom.USE_AIKAR_FLAGS, "false");
  assert.equal(custom.JVM_XX_OPTS, "-XX:+UseZGC");
});

test("an empty seed is omitted rather than pinning every world to seed ''", () => {
  assert.equal(javaEnv(spec(), "pw").SEED, undefined);

  const seeded = javaEnv(spec({ properties: { ...spec().properties, "level-seed": "12345" } }), "pw");
  assert.equal(seeded.SEED, "12345");
});

test("crossplay pulls in geyser and floodgate with their dependencies", () => {
  const off = javaEnv(spec(), "pw");
  assert.equal(off.MODRINTH_PROJECTS, undefined);

  const on = javaEnv(spec({ crossplay: true }), "pw");
  assert.equal(on.MODRINTH_PROJECTS, "geyser,floodgate");
  assert.equal(on.MODRINTH_DOWNLOAD_DEPENDENCIES, "required");
});

test("bedrock env uses the bedrock image's own option names", () => {
  const env = bedrockEnv(spec({ edition: "bedrock" }));
  assert.equal(env.EULA, "TRUE");
  assert.equal(env.GAMEMODE, "creative");
  assert.equal(env.DIFFICULTY, "hard");
  assert.equal(env.MAX_PLAYERS, "100");
  assert.equal(env.SERVER_NAME, "Hello");
});

test("java server publishes only tcp 25565", () => {
  const { exposed, bindings } = portConfig(spec());
  assert.deepEqual(Object.keys(exposed), ["25565/tcp"]);
  assert.equal(bindings["25565/tcp"][0].HostPort, "25601");
});

test("crossplay additionally publishes udp 19132 for bedrock clients", () => {
  const { exposed, bindings } = portConfig(spec({ crossplay: true, bedrockPort: 25602 }));
  assert.deepEqual(Object.keys(exposed).sort(), ["19132/udp", "25565/tcp"]);
  assert.equal(bindings["25565/tcp"][0].HostPort, "25601");
  assert.equal(bindings["19132/udp"][0].HostPort, "25602");
});

test("native bedrock publishes udp only, never a java tcp port", () => {
  const { exposed, bindings } = portConfig(spec({ edition: "bedrock", bedrockPort: 25603 }));
  assert.deepEqual(Object.keys(exposed), ["19132/udp"]);
  assert.equal(bindings["19132/udp"][0].HostPort, "25603");
  assert.equal(bindings["25565/tcp"], undefined);
});

test("player list parses both formats minecraft has shipped", () => {
  const modern = parsePlayerList("There are 2 of a max of 20 players online: Alex, Steve");
  assert.equal(modern.count, 2);
  assert.equal(modern.max, 20);
  assert.deepEqual(modern.names, ["Alex", "Steve"]);

  const empty = parsePlayerList("There are 0/100 players online:");
  assert.equal(empty.count, 0);
  assert.deepEqual(empty.names, []);
});

test("docker log framing is stripped without mangling tty output", () => {
  const body = Buffer.from("server started\n");
  const header = Buffer.alloc(8);
  header[0] = 1;
  header.writeUInt32BE(body.length, 4);

  assert.equal(stripDockerFraming(Buffer.concat([header, body])), "server started\n");
  assert.equal(stripDockerFraming(Buffer.from("plain line\n")), "plain line\n");
});
