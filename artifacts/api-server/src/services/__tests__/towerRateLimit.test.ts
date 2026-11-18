import assert from "node:assert/strict";
import {test} from "node:test";
import express from "express";
import {bettingRateLimiter,towerMoveRateLimiter,towerMoveIpRateLimiter} from "../../middlewares/rateLimit";

test("Tower move budget permits 35 floors plus cashout without increasing placement limits", async () => {
  const app=express();
  app.use((req,_res,next)=>{req.user={id:String(req.headers["x-fixture-user"]??"one")} as typeof req.user;next();});
  app.post("/place",bettingRateLimiter,(_req,res)=>{res.sendStatus(200);});
  app.post("/move",towerMoveIpRateLimiter,towerMoveRateLimiter,(_req,res)=>{res.sendStatus(200);});
  const server=app.listen(0,"127.0.0.1");await new Promise<void>(resolve=>server.once("listening",resolve));
  const port=(server.address() as {port:number}).port;
  const post=async(path:string,user="one")=>{const r=await fetch(`http://127.0.0.1:${port}${path}`,{method:"POST",headers:{"x-fixture-user":user}});await r.text();return r.status;};
  try {
    for(let n=0;n<30;n++)assert.equal(await post("/place"),200);
    assert.equal(await post("/place"),429);
    for(let n=0;n<36;n++)assert.equal(await post("/move"),200);
    for(let n=36;n<120;n++)assert.equal(await post("/move"),200);
    assert.equal(await post("/move"),429);
    assert.equal(await post("/move","two"),200);
    assert.equal(await post("/place","two"),200);
  }finally{server.closeAllConnections();await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
});
