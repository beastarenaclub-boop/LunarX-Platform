import { expect, test } from "@playwright/test";
import { table } from "./lucky7-table-fixture";

for (const width of [360, 1366]) test(`dice leave the hand, grow toward the center and vary each round at ${width}px`, async ({page}, info) => {
  await page.setViewportSize({width,height:width===360?800:900});
  await page.addInitScript(()=>{
    (window as any).diceFrameCosts=[];
    const native=HTMLVideoElement.prototype.requestVideoFrameCallback;
    if(!native)return;
    HTMLVideoElement.prototype.requestVideoFrameCallback=function(callback){
      return native.call(this,(now,metadata)=>{
        const start=performance.now();callback(now,metadata);
        if(this.dataset.testid==="lucky7-dealer-action-video" && metadata.mediaTime>=3.875 && metadata.mediaTime<=6.25)
          (window as any).diceFrameCosts.push(performance.now()-start);
      });
    };
  });
  const round=await table(page,false,0,{bettingMs:60000});
  await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode","idle");
  const video=page.getByTestId("lucky7-dealer-action-video");
  await expect.poll(()=>video.evaluate(el=>(el as HTMLVideoElement).readyState)).toBeGreaterThanOrEqual(2);
  const bounds=await page.getByTestId("dice-table").boundingBox();
  const endpoints:string[]=[];
  for(let index=0;index<2;index++){
    if(index)round.nextBetting("different-center-throw",60000);
    await page.getByTestId("lucky7-table-dice").evaluate(svg=>{
      const samples:{x:number;y:number;size:number;time:number}[]=[];
      const first=svg.querySelector('[data-testid="static-die-1"]') as SVGGElement;
      const observer=new MutationObserver(()=>{
        if((svg as SVGElement).dataset.phase==="flight")samples.push({x:Number(first.dataset.x),y:Number(first.dataset.y),size:Number(first.dataset.size),time:Number((svg as SVGElement).dataset.mediaMs)/1000});
      });
      observer.observe(first,{attributes:true,attributeFilter:["transform"]});
      (window as any).centerFlight={samples,observer};
    });
    round.reveal();
    await expect(page.getByTestId("lucky7-dice")).toHaveAttribute("data-round-id",index?"different-center-throw":"dealer-test-round");
    await expect(page.getByTestId("lucky7-dice")).toHaveAttribute("data-motion","shake");
    await expect(page.getByTestId("lucky7-table-dice")).toHaveAttribute("data-phase","hand");
    await expect(page.locator("[data-felt-repair]")).toHaveCSS("visibility","hidden");
    if(index===0) await page.getByTestId("dice-table").screenshot({path:info.outputPath("center-hands.png")});
    if(index===0) {
      await page.waitForFunction(()=>document.querySelector('[data-testid="lucky7-table-dice"]')?.getAttribute("data-phase")==="flight");
      await page.getByTestId("dice-table").screenshot({path:info.outputPath("center-release.png")});
      await expect.poll(()=>video.evaluate(el=>(el as HTMLVideoElement).currentTime),{intervals:[30]}).toBeGreaterThanOrEqual(5.2);
      await page.getByTestId("dice-table").screenshot({path:info.outputPath("center-mid-flight.png")});
    }
    await expect(page.getByTestId("lucky7-dice")).toHaveAttribute("data-motion","rest");
    if(index===0) {
      await expect.poll(()=>video.evaluate(el=>(el as HTMLVideoElement).currentTime),{intervals:[50]}).toBeGreaterThanOrEqual(6.3);
      await page.getByTestId("dice-table").screenshot({path:info.outputPath("center-hands-after-land.png")});
    }
    const samples=await page.evaluate(()=>{
      const {samples,observer}=(window as any).centerFlight;observer.disconnect();
      return samples as {x:number;y:number;size:number;time:number}[];
    });
    expect(samples.length).toBeGreaterThan(6);
    expect(samples[0].x).toBeGreaterThan(890); // centered palms in the measured Naina take
    expect(samples[0].x).toBeLessThan(1000);
    expect(samples[0].time).toBeGreaterThanOrEqual(93/24);
    expect(samples.at(-1)!.x).toBeLessThan(940);
    expect(samples.at(-1)!.size).toBeGreaterThan(samples[0].size*1.25);
    for(let i=1;i<samples.length;i++)expect(samples[i].size).toBeGreaterThanOrEqual(samples[i-1].size);
    const dice=page.getByTestId("static-die-1");
    endpoints.push(await dice.getAttribute("transform") ?? "");
    for(const id of ["static-die-1","static-die-2"]){
      const box=await page.getByTestId(id).boundingBox();
      expect(box!.width).toBeGreaterThan(width===360?10:25);
      expect(box!.x).toBeGreaterThan(bounds!.x+bounds!.width*.35);
      expect(box!.x+box!.width).toBeLessThan(bounds!.x+bounds!.width*.65);
      expect(box!.y+box!.height).toBeLessThan(bounds!.y+bounds!.height);
    }
    expect(await page.getByTestId("dice-table").boundingBox()).toEqual(bounds);
    expect(await video.evaluate(el=>(el as HTMLVideoElement).playbackRate)).toBe(1);
    round.repeatResult();
    await expect(dice).toHaveAttribute("transform",endpoints[index]);
    await expect(page.getByTestId("lucky7-dealer-stage")).toHaveAttribute("data-mode","idle");
  }
  expect(endpoints[0]).not.toBe(endpoints[1]);
  await expect(page.locator("canvas")).toHaveCount(0);
  await info.attach("dice-frame-costs",{body:JSON.stringify(await page.evaluate(()=>(window as any).diceFrameCosts)),contentType:"application/json"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath("center-landing.png"),fullPage:true});
  await page.getByTestId("dice-table").screenshot({path:info.outputPath("center-table.png")});
});
