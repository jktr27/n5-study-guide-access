import { getStore } from "@netlify/blobs";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";


const WIDGET = '<script>(function(){var d=document,L=localStorage,r=5,b=d.createElement("button");b.textContent="\u{1F4AC} Feedback";b.style.cssText="position:fixed;right:14px;bottom:14px;z-index:99999;padding:12px 16px;border:0;border-radius:24px;background:#00b8c8;color:#fff;font:600 15px system-ui;box-shadow:0 2px 10px #0004";var m=d.createElement("div");m.style.cssText="display:none;position:fixed;inset:0;z-index:100000;background:#0008;align-items:center;justify-content:center;padding:16px";m.innerHTML=\'<div style="background:#fff;color:#222;border-radius:16px;padding:18px;max-width:380px;width:100%;font:15px system-ui"><b>Kumusta ang study guide?</b><div id="fbs" style="font-size:34px;margin:8px 0;cursor:pointer"></div><textarea id="fbt" maxlength="500" placeholder="Ano ang masasabi mo para sa susunod na bibili?" style="width:100%;height:90px;padding:10px;font:16px system-ui;box-sizing:border-box"></textarea><div id="fbm" style="margin:6px 0;color:#d33"></div><button id="fbg" style="width:100%;padding:12px;border:0;border-radius:10px;background:#00b8c8;color:#fff;font:600 16px system-ui">Ipadala</button><button id="fbc" style="width:100%;padding:10px;border:0;background:none;color:#666;font:15px system-ui">Isara</button></div>\';d.body.appendChild(b);d.body.appendChild(m);var $=function(i){return d.getElementById(i)};function draw(){$("fbs").innerHTML="";for(var i=1;i<=5;i++){(function(i){var x=d.createElement("span");x.textContent=i<=r?"\u2605":"\u2606";x.style.color="#f5a623";x.onclick=function(){r=i;draw()};$("fbs").appendChild(x)})(i)}}draw();b.onclick=function(){m.style.display="flex"};$("fbc").onclick=function(){m.style.display="none"};$("fbg").onclick=function(){fetch("/api/feedback",{method:"POST",body:JSON.stringify({key:L.getItem("key"),device:L.getItem("dev"),rating:r,text:$("fbt").value})}).then(function(x){return x.json()}).then(function(j){if(j.error){$("fbm").textContent=j.error}else{$("fbm").style.color="#080";$("fbm").textContent="Salamat sa feedback mo! \u{1F64F}";setTimeout(function(){m.style.display="none"},1500)}})}})()</script>';

export const config = { path: "/api/*" };

const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { "content-type": "application/json" } });
const rid = () => randomBytes(8).toString("hex");
const mkKey = () => {
  const c = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = ""; for (const x of randomBytes(12)) s += c[x % c.length];
  return s.match(/.{4}/g).join("-");
};

export default async (req) => {
  const s = getStore("n5gate");
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\//, "");
  const b = req.method === "POST" ? await req.json().catch(() => ({})) : {};

  if (route === "request") {
    const name = String(b.name || "").trim().slice(0, 80);
    const contact = String(b.contact || "").trim().slice(0, 120);
    const ref = String(b.ref || "").trim().slice(0, 60);
    if (!name || !contact || !ref) return json({ error: "Kumpletuhin ang lahat ng fields." }, 400);
    const id = rid();
    await s.setJSON(`req:${id}`, { id, name, contact, ref, status: "pending", created: Date.now() });
    return json({ id });
  }

  if (route === "status") {
    const r = await s.get(`req:${url.searchParams.get("id")}`, { type: "json" });
    if (!r) return json({ status: "unknown" }, 404);
    return json({ status: r.status, key: r.status === "approved" ? r.key : undefined });
  }

  if (route === "study") {
    const key = String(b.key || "").trim().toUpperCase();
    const device = String(b.device || "");
    if (!key || device.length < 16) return json({ error: "Invalid key." }, 400);
    const k = await s.get(`key:${key}`, { type: "json" });
    if (!k || k.revoked) return json({ error: "Invalid o na-revoke na ang key." }, 403);
    if (!k.device) { k.device = device; k.boundAt = Date.now(); await s.setJSON(`key:${key}`, k); }
    else if (k.device !== device) return json({ error: "Nakarehistro na ang key na ito sa ibang device." }, 403);
    const html = readFileSync(join(process.env.LAMBDA_TASK_ROOT || process.cwd(), "content", "study.html"), "utf8");
    const out = html.includes("</body>") ? html.replace(/<\/body>(?![\s\S]*<\/body>)/, WIDGET + "</body>") : html + WIDGET;
    return new Response(out, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
  }

  if (route === "reviews") {
    const { blobs } = await s.list({ prefix: "rev:" });
    const all = (await Promise.all(blobs.map((x) => s.get(x.key, { type: "json" })))).filter((v) => v && v.approved);
    return json(all.sort((a, z) => z.created - a.created).slice(0, 30).map((v) => ({ name: v.name, rating: v.rating, text: v.text, created: v.created })));
  }

  if (route === "feedback") {
    const key = String(b.key || "").trim().toUpperCase();
    const k = await s.get(`key:${key}`, { type: "json" });
    if (!k || k.revoked || !k.device || k.device !== String(b.device || "")) return json({ error: "Hindi ma-verify ang access mo." }, 403);
    const text = String(b.text || "").trim().slice(0, 500);
    const rating = Math.max(1, Math.min(5, parseInt(b.rating, 10) || 5));
    if (text.length < 3) return json({ error: "Magsulat muna ng kahit kaunting feedback." }, 400);
    const rq = await s.get(`req:${k.reqId}`, { type: "json" });
    const name = String(rq?.name || "Buyer").trim().split(/\s+/)[0].slice(0, 30);
    await s.setJSON(`rev:${key}`, { key, name, rating, text, approved: false, created: Date.now() });
    return json({ ok: true });
  }

  if (route.startsWith("admin/")) {
    if (!process.env.ADMIN_PASSWORD || b.password !== process.env.ADMIN_PASSWORD) return json({ error: "Mali ang password." }, 401);
    const act = route.slice(6);
    if (act === "list") {
      const { blobs } = await s.list({ prefix: "req:" });
      const reqs = (await Promise.all(blobs.map((x) => s.get(x.key, { type: "json" })))).filter(Boolean);
      for (const r of reqs) if (r.key) { const k = await s.get(`key:${r.key}`, { type: "json" }); r.bound = !!k?.device; r.revoked = !!k?.revoked; }
      return json(reqs.sort((a, z) => z.created - a.created));
    }
    if (act === "reviews") {
      const { blobs } = await s.list({ prefix: "rev:" });
      const all = (await Promise.all(blobs.map((x) => s.get(x.key, { type: "json" })))).filter(Boolean);
      return json(all.sort((a, z) => z.created - a.created));
    }
    if (act.startsWith("rev-")) {
      const v = await s.get(`rev:${b.key}`, { type: "json" });
      if (!v) return json({ error: "Not found" }, 404);
      if (act === "rev-show") { v.approved = true; await s.setJSON(`rev:${b.key}`, v); }
      else if (act === "rev-hide") { v.approved = false; await s.setJSON(`rev:${b.key}`, v); }
      else if (act === "rev-delete") { await s.delete(`rev:${b.key}`); }
      return json({ ok: true });
    }
    const r = await s.get(`req:${b.id}`, { type: "json" });
    if (!r) return json({ error: "Not found" }, 404);
    if (act === "approve" && r.status !== "approved") {
      const key = mkKey();
      await s.setJSON(`key:${key}`, { key, reqId: r.id, device: null, revoked: false });
      r.status = "approved"; r.key = key; await s.setJSON(`req:${r.id}`, r);
    } else if (act === "reject") { r.status = "rejected"; await s.setJSON(`req:${r.id}`, r); }
    else if (act === "reset" && r.key) { const k = await s.get(`key:${r.key}`, { type: "json" }); k.device = null; await s.setJSON(`key:${r.key}`, k); }
    else if (act === "revoke" && r.key) { const k = await s.get(`key:${r.key}`, { type: "json" }); k.revoked = true; await s.setJSON(`key:${r.key}`, k); }
    return json({ ok: true });
  }
  return json({ error: "Not found" }, 404);
};
