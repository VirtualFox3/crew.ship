import test from "node:test";
import assert from "node:assert/strict";
import { resolveAddress } from "../lib/address.ts";

const srv = (o: any = {}) => ({
  subdomain: "myserver", custom_domain: null,
  java_port: 25601, bedrock_port: null, edition: "java", ...o,
});
const node = (o: any = {}) => ({
  public_host: "203.0.113.5", tunnel_host: null, tunnel_ports: {}, ...o,
});

test("playit tunnel: uses the RELAY port, never the local one", () => {
  const a = resolveAddress(
    srv(),
    node({ tunnel_host: "abc.craft.playit.gg", tunnel_ports: { "25601": 41234 } }),
    "howl.host",
  );
  assert.equal(a.java, "abc.craft.playit.gg:41234");
  assert.equal(a.via, "tunnel");
});

test("tunnel without a mapping for this port falls through, not a broken address", () => {
  const a = resolveAddress(
    srv(),
    node({ tunnel_host: "abc.craft.playit.gg", tunnel_ports: { "25999": 41234 } }),
    "howl.host",
  );
  assert.equal(a.java, "203.0.113.5:25601");
  assert.equal(a.via, "node-host");
});

test("the placeholder domain is never shown -- it would not resolve", () => {
  const a = resolveAddress(srv(), node(), "howl.host");
  assert.equal(a.java, "203.0.113.5:25601");
  assert.equal(a.via, "node-host");
});

test("a real configured domain is used", () => {
  const a = resolveAddress(srv(), node(), "mc.example.com");
  assert.equal(a.java, "myserver.mc.example.com:25601");
  assert.equal(a.via, "wildcard");
});

test("custom domain beats everything", () => {
  const a = resolveAddress(
    srv({ custom_domain: "play.mine.gg", java_port: 25565 }),
    node({ tunnel_host: "abc.craft.playit.gg", tunnel_ports: { "25565": 41234 } }),
    "mc.example.com",
  );
  assert.equal(a.java, "play.mine.gg", "port 25565 hidden on a custom domain");
  assert.equal(a.via, "custom-domain");
});

test("crossplay exposes both java and bedrock through the tunnel", () => {
  const a = resolveAddress(
    srv({ edition: "hybrid", bedrock_port: 25602 }),
    node({ tunnel_host: "abc.craft.playit.gg", tunnel_ports: { "25601": 41234, "25602": 41235 } }),
    "howl.host",
  );
  assert.equal(a.java, "abc.craft.playit.gg:41234");
  assert.equal(a.bedrock, "abc.craft.playit.gg:41235");
});

test("a java-only server never advertises a bedrock address", () => {
  const a = resolveAddress(srv({ bedrock_port: 25602 }), node(), "mc.example.com");
  assert.equal(a.bedrock, null);
});

test("no node yet means no address, rather than a fake one", () => {
  const a = resolveAddress(srv({ java_port: null }), null, "howl.host");
  assert.equal(a.java, null);
  assert.equal(a.via, "unassigned");
});
