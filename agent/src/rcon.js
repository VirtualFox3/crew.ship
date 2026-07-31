import net from "node:net";

/**
 * Minimal Source RCON client.
 *
 * Minecraft speaks RCON over TCP. The framing is ~80 lines, so this avoids a
 * dependency. One connection per command keeps the agent stateless — commands
 * are rare and the handshake is cheap.
 */

const AUTH = 3;
const AUTH_RESPONSE = 2;
const EXEC = 2;
const RESPONSE = 0;

function encode(id, type, body) {
  const payload = Buffer.from(body, "utf8");
  const buffer = Buffer.alloc(payload.length + 14);
  buffer.writeInt32LE(payload.length + 10, 0);
  buffer.writeInt32LE(id, 4);
  buffer.writeInt32LE(type, 8);
  payload.copy(buffer, 12);
  buffer.writeInt16LE(0, payload.length + 12);
  return buffer;
}

export function rconCommand(host, port, password, command, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let buffer = Buffer.alloc(0);
    let authed = false;
    let output = "";
    let settled = false;

    const finish = (err, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      err ? reject(err) : resolve(value);
    };

    const timer = setTimeout(
      () => finish(new Error("RCON timed out")),
      timeoutMs,
    );

    socket.on("error", (err) => finish(err));
    socket.on("close", () => finish(null, output.trim()));

    socket.on("connect", () => socket.write(encode(1, AUTH, password)));

    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);

      // Packets are length-prefixed and can arrive coalesced or split.
      while (buffer.length >= 4) {
        const size = buffer.readInt32LE(0);
        if (buffer.length < size + 4) break;

        const id = buffer.readInt32LE(4);
        const type = buffer.readInt32LE(8);
        const body = buffer.subarray(12, size + 2).toString("utf8");
        buffer = buffer.subarray(size + 4);

        if (type === AUTH_RESPONSE) {
          if (id === -1) return finish(new Error("RCON authentication failed"));
          authed = true;
          socket.write(encode(2, EXEC, command));
          continue;
        }

        if (type === RESPONSE && authed) {
          output += body;
          // Minecraft answers a single EXEC with one packet for normal
          // commands; give a beat for multi-packet replies then resolve.
          clearTimeout(timer);
          setTimeout(() => finish(null, output.trim()), 60);
        }
      }
    });
  });
}

/** Parses `list` output into a player count and the names, when present. */
export function parsePlayerList(text) {
  const match = /There are (\d+)(?:\s*\/\s*|\s+of a max(?:imum)? of\s+)(\d+)/i.exec(text);
  const count = match ? Number(match[1]) : 0;
  const max = match ? Number(match[2]) : 0;

  const namesPart = text.split(":").slice(1).join(":").trim();
  const names = namesPart
    ? namesPart
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean)
    : [];

  return { count, max, names };
}
