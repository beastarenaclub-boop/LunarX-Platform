import { test, expect, type Page, type Locator } from "@playwright/test";

async function setup(page: Page, guest = false) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => localStorage.setItem("aviator:v1", JSON.stringify({settings:{onboarded:true,sound:false}})));
  await page.routeWebSocket("**/ws", socket => socket.onMessage(() => {}));
  let authenticated = !guest;
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const user = { id:"mobile-user",displayName:"Mobile Player",email:"mobile-player-with-a-long-address@example.test",role:"player",status:"active" };
    if(path === "/api/auth/logout") { authenticated = false; return route.fulfill({status:204}); }
    if(path === "/api/auth/me") return route.fulfill({status:authenticated?200:401,json:authenticated?user:{error:"Unauthorized"}});
    if(path === "/api/profile") return route.fulfill({json:user});
    if(path === "/api/wallet/balance") return route.fulfill({json:{balance:"12345678900",scope:"lunar",currency:"INR"}});
    if(path === "/api/wallet/balances") return route.fulfill({json:{balances:{lunar:"12345678900"}}});
    if(path === "/api/kyc") return route.fulfill({contentType:"application/json",body:"null"});
    if(path.endsWith("transactions") || path === "/api/bets") return route.fulfill({json:{entries:[],nextCursor:null}});
    if(path.endsWith("-limits")) return route.fulfill({json:{minAmountPaise:"10000",maxAmountPaise:"10000000"}});
    if(path.endsWith("deposit-settings")) return route.fulfill({json:{manualEnabled:true,autoEnabled:false}});
    if(path.includes("free-bets")) return route.fulfill({json:{count:0,totalStake:"0",grants:[]}});
    if(path.includes("rain")) return route.fulfill({contentType:"application/json",body:"null"});
    return route.fulfill({json:[]});
  });
  return errors;
}
async function fits(page: Page) {
  expect(await page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth)).toBeLessThanOrEqual(1);
}
async function tappable(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeInViewport({ratio:.99});
  const size=await control.boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  await control.click({trial:true});
}

for(const width of [320,390,768]) test(`lobby search, favourites and navigation work at ${width}px`, async({page})=>{
  const errors=await setup(page);
  await page.setViewportSize({width,height:844});
  await page.goto("/");
  const nav=page.getByRole("navigation",{name:"Mobile navigation"});
  await expect(nav).toBeVisible();
  await fits(page);
  await page.getByTestId("btn-category-instant").click();
  const card=page.getByTestId("card-game-jetx");
  await expect(card).toBeVisible();
  expect((await card.boundingBox())!.width).toBeGreaterThanOrEqual(130);
  const save=page.getByRole("button",{name:"Save JetX to favourites",exact:true});
  await tappable(save);await save.click();
  await nav.getByRole("button",{name:"Favourites",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("JetX");
  await tappable(page.getByRole("dialog").getByRole("button",{name:"Close",exact:true}));
  await page.keyboard.press("Escape");
  if(width>540) await page.getByRole("button",{name:"Search games",exact:true}).click();
  const search=page.getByRole("searchbox",{name:"Search games or providers"});
  await search.fill("Coin Flip");
  await expect(page.getByTestId("card-game-coin-flip")).toBeVisible();
  await expect(card).toHaveCount(0);
  await expect(nav).toBeHidden();
  await search.press("Tab");
  await expect(nav).toBeVisible();
  await nav.getByRole("link",{name:"Account",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Profile & KYC",exact:true})).toBeVisible();
  await fits(page);
  await expect(nav.getByRole("link",{name:"Account",exact:true})).toHaveAttribute("aria-current","page");
  await nav.getByRole("link",{name:"Favourites",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("JetX");
  expect(errors).toEqual([]);
});

test("mobile menus, account sign-out and keyboard-sized forms remain reachable",async({page})=>{
  const errors=await setup(page);
  await page.setViewportSize({width:320,height:568});
  await page.goto("/");
  await page.getByTestId("btn-menu").click();
  await page.setViewportSize({width:844,height:390});
  await tappable(page.getByRole("dialog").getByRole("link",{name:"Help & support"}));
  await page.keyboard.press("Escape");
  await page.goto("/profile");
  const signOut=page.locator(".site-mobile-signout");
  await tappable(signOut);await signOut.click();
  await expect(page).toHaveURL(/\/login$/);
  await page.setViewportSize({width:390,height:300});
  const email=page.getByTestId("input-login-email");
  await email.fill("mobile@example.test");
  expect(await email.evaluate(el=>getComputedStyle(el).fontSize)).toBe("16px");
  await page.getByTestId("input-login-password").fill("mobile-test-password");
  await tappable(page.getByTestId("btn-login-submit"));
  await fits(page);expect(errors).toEqual([]);
});

for(const path of ["/login","/signup","/forgot","/reset"]) test(`${path}: phone forms appear before artwork and fit landscape`,async({page})=>{
  const errors=await setup(page,true);
  await page.setViewportSize({width:320,height:568});await page.goto(path);
  const form=page.locator(".site-auth-form"), story=page.locator(".site-auth-story");
  await expect(form).toBeVisible();
  expect((await form.boundingBox())!.y).toBeLessThan((await story.boundingBox())!.y);
  await fits(page);
  await page.setViewportSize({width:844,height:390});
  await expect(story).toBeHidden();await fits(page);expect(errors).toEqual([]);
});
